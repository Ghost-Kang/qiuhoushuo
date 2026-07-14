import { getSupabaseService } from '@/lib/api/mode';
import type { ServerEventId } from '@/lib/api/tracker';

const SERVER_EVENTS: ServerEventId[] = [
  'E013',
  'E031', 'E032', 'E033',
  'E040', 'E041', 'E042', 'E043',
  'E044', 'E045', 'E046', 'E047',
  'E050', 'E051', 'E052', 'E053', 'E054',
  'E060', 'E061', 'E062', 'E063',
  'E064',
  'E070', 'E071', 'E072', 'E073', 'E074',
  'E090', 'E091', 'E092', 'E093',
  'E094', 'E095', 'E096',
];

type EventsClient = {
  from(table: string): {
    select(columns: string): {
      gte(column: string, value: string): PromiseLike<{ data: Array<{ event_id: string }> | null; error?: { message: string } | null }>;
    };
  };
};

export async function verifyEventsPipeline(client: EventsClient | null = getSupabaseService()) {
  if (!client) {
    console.log('[events] USE_DB=false, skip events pipeline verification');
    return { counts: {}, missing: SERVER_EVENTS };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from('events').select('event_id').gte('created_at', since);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
  const missing = SERVER_EVENTS.filter((eventId) => !counts[eventId]);
  console.log('[events] last_24h_counts', counts);
  console.log('[events] service_role_read', 'ok');
  if (missing.length) console.warn('[events] missing_event_ids', missing.join(','));
  return { counts, missing };
}

if (process.argv[1]?.endsWith('verify-events-pipeline.ts')) {
  void verifyEventsPipeline().catch((err) => {
    console.error('[events] verify failed:', (err as Error).message);
    process.exitCode = 1;
  });
}
