import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { ok, withZod } from '@/lib/api/respond';
import { trackServerEvent } from '@/lib/api/tracker';
import { withAdminGet } from '@/lib/api/with-admin';

const Query = z.object({ window_seconds: z.coerce.number().int().min(60).max(3600).default(300) }).strict();

export const GET = withAdminGet(async ({ req }) => {
  const parsed = withZod(Query, Object.fromEntries(new URL(req.url).searchParams));
  if ('error' in parsed) return parsed.error;
  const windowSeconds = parsed.data.window_seconds ?? 300;
  const db = getSupabaseService();
  if (!db) return ok({ window_seconds: windowSeconds, events: [], total: 0 });
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data: rows } = await db.from('events').select('event_id,event_name,created_at').gte('created_at', since).limit(10000);
  if ((rows ?? []).length === 10000) {
    console.warn('[api/admin/events-recent] truncated at 10000 rows');
  }
  const grouped = new Map<string, { event_id: string; event_name: string; count: number }>();
  for (const row of rows ?? []) {
    const key = `${row.event_id}:${row.event_name}`;
    const item = grouped.get(key) ?? { event_id: row.event_id, event_name: row.event_name, count: 0 };
    item.count += 1;
    grouped.set(key, item);
  }
  const events = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  const total = events.reduce((sum, item) => sum + item.count, 0);
  trackServerEvent(db, { eventId: 'E096', properties: { window_seconds: windowSeconds, total } });
  return ok({ window_seconds: windowSeconds, events, total });
});
