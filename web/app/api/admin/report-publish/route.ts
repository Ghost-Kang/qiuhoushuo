import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { ok } from '@/lib/api/respond';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';

const Scenario = z.enum(['home_wins', 'away_wins', 'tie']);
const Channel = z.enum(['wechat', 'miniprogram']);

const Body = z.object({
  match_id: z.string().uuid(),
  scenario: Scenario.optional(),
  channel: z.array(Channel).min(1).max(4),
}).strict();

type ReportRow = { id: string; tags?: string[] | null };

export const POST = withAdmin(Body, async ({ body }) => {
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  let query = db.from('reports').select('id,tags').eq('match_id', body.match_id);
  if (body.scenario) query = query.contains('tags', [`scenario:${body.scenario}`]);
  const { data } = await query;
  const rows = (data ?? []) as ReportRow[];
  if (!rows.length) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

  const publishedAt = new Date().toISOString();
  await Promise.all(rows.map((row) => db
    .from('reports')
    .update({ tags: withPublishedTag(row.tags ?? [], publishedAt), updated_at: publishedAt })
    .eq('id', row.id)));

  trackServerEventGlobal({
    eventId: 'E045',
    properties: {
      match_id: body.match_id,
      scenario: body.scenario ?? null,
      reports_published: rows.length,
      channels: body.channel,
    },
  });
  return ok({
    match_id: body.match_id,
    scenario: body.scenario ?? null,
    reports_published: rows.length,
    channels_notified: body.channel,
  });
}, { bodyLimitBytes: 4 * 1024 });

function withPublishedTag(tags: string[], publishedAt: string) {
  return [...tags.filter((tag) => !tag.startsWith('published:')), `published:${publishedAt}`];
}
