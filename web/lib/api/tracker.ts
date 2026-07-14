import { getSupabaseService } from './mode';

export type ServerEventId =
  | 'E013'
  | 'E031'
  | 'E032'
  | 'E033'
  | 'E040'
  | 'E041'
  | 'E042'
  | 'E043'
  | 'E044'
  | 'E045'
  | 'E046'
  | 'E047'
  | 'E050'
  | 'E051'
  | 'E052'
  | 'E053'
  | 'E054'
  | 'E055'
  | 'E060'
  | 'E061'
  | 'E062'
  | 'E063'
  | 'E064'
  | 'E070'
  | 'E071'
  | 'E072'
  | 'E073'
  | 'E074'
  | 'E090'
  | 'E091'
  | 'E092'
  | 'E093'
  | 'E094'
  | 'E095'
  | 'E096'
  | 'E097';

export interface ServerEvent {
  eventId: ServerEventId;
  userId?: string | null;
  properties?: Record<string, unknown>;
}

export type ServerEventClient = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<unknown> | unknown;
  };
};

const EVENT_NAMES: Record<ServerEventId, string> = {
  E013: 'shortlink_resolved',
  E031: 'payment_triggered',
  E032: 'payment_succeeded',
  E033: 'payment_refunded',
  E040: 'report_generated',
  E041: 'report_fallback_triggered',
  E042: 'report_persist_failed',
  E043: 'report_safety_blocked',
  E044: 'report_preset_created',
  E045: 'report_publish_triggered',
  E046: 'report_human_overridden',
  E047: 'report_finals_degraded',
  E050: 'card_prerender_started',
  E051: 'card_prerender_succeeded',
  E052: 'card_prerender_failed',
  E053: 'card_realtime_rendered',
  E054: 'report_read_completed',
  E055: 'fan_avatar_generated',
  E060: 'llm_call_succeeded',
  E061: 'llm_call_failed',
  E062: 'llm_failover_to_backup',
  E063: 'llm_all_providers_down',
  E064: 'deepseek_empty_retry',
  E070: 'fixtures_api_call',
  E071: 'fixtures_sync_started',
  E072: 'fixtures_synced',
  E073: 'api_football_quota_check',
  E074: 'api_football_quota_alert',
  E090: 'schema_migration_event',
  E091: 'rate_limited_ip',
  E092: 'cost_cap_reached',
  E093: 'in_flight_overflow',
  E094: 'admin_ban_ip',
  E095: 'admin_cost_override',
  E096: 'admin_query_events',
  E097: 'laoli_video_generated',
};

export function trackServerEvent(client: ServerEventClient | null, event: ServerEvent): void {
  const row = {
    user_id: event.userId ?? null,
    session_id: '',
    event_id: event.eventId,
    event_name: EVENT_NAMES[event.eventId],
    properties: event.properties ?? {},
  };
  if (!client) {
    console.log('[track:server]', row.event_id, row.event_name, row.properties);
    return;
  }
  try {
    void Promise.resolve(client.from('events').insert(row)).catch((err) => {
      console.warn('[track] failed:', (err as Error).message);
    });
  } catch (err) {
    console.warn('[track] failed:', (err as Error).message);
  }
}

export function trackServerEventGlobal(event: ServerEvent): void {
  try {
    trackServerEvent(getSupabaseService(), event);
  } catch (err) {
    console.warn('[track] failed:', (err as Error).message);
  }
}

export function eventNameForTest(eventId: ServerEventId) {
  return EVENT_NAMES[eventId];
}
