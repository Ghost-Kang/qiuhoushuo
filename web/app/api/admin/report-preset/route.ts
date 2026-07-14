import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { ok } from '@/lib/api/respond';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';

// 参 tasks/TASK-69 / F36+N1: match /api/report so preset operations share the same timeout envelope.
export const maxDuration = 60;

const Scenario = z.enum(['home_wins', 'away_wins', 'tie']);
const Style = z.enum(['hardcore', 'duanzi', 'emotion']);

const Body = z.object({
  match_id: z.string().uuid(),
  scenario: Scenario,
  report: z.object({
    style: Style,
    title: z.string().min(8).max(40),
    subtitle: z.string().max(80).optional(),
    lead: z.string().min(40).max(300),
    body: z.array(z.string().min(60).max(500)).min(1),
    ending: z.string().min(40).max(300),
    share_quote: z.string().min(8).max(40),
    tags: z.array(z.string().min(1).max(20)).min(1).max(6),
    is_premium: z.literal(true),
  }).strict(),
}).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  const scenarioTag = `scenario:${body.scenario}`;
  const { data: existing } = await db
    .from('reports')
    .select('id')
    .eq('match_id', body.match_id)
    .eq('style', body.report.style)
    .contains('tags', [scenarioTag])
    .maybeSingle();
  if (existing) return Response.json({ error: 'PRESET_EXISTS' }, { status: 409 });

  const tags = mergeTags(body.report.tags, scenarioTag);
  const row = {
    match_id: body.match_id,
    style: body.report.style,
    title: body.report.title,
    subtitle: body.report.subtitle ?? null,
    lead: body.report.lead,
    body: body.report.body,
    ending: body.report.ending,
    share_quote: body.report.share_quote,
    tags,
    prompt_version: 'manual-preset-v1',
    llm_provider: 'manual',
    llm_model: null,
    is_fallback: false,
    is_premium: true,
    human_reviewed: true,
  };
  const { data: inserted, error } = await db.from('reports').insert(row).select('id').maybeSingle();
  if (error) return Response.json({ error: 'PRESET_CREATE_FAILED', message: error.message }, { status: 500 });

  const reportId = inserted?.id;
  trackServerEventGlobal({
    eventId: 'E044',
    properties: { match_id: body.match_id, scenario: body.scenario, style: body.report.style, report_id: reportId },
  });
  return ok({ report_id: reportId, scenario: body.scenario, status: 'preset_ready' });
}, { bodyLimitBytes: 4 * 1024 });

function mergeTags(tags: string[], scenarioTag: string) {
  return [...tags.filter((tag) => !tag.startsWith('scenario:')).slice(0, 5), scenarioTag];
}
