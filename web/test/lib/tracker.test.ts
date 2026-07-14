import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventNameForTest, trackServerEvent, type ServerEventClient } from '@/lib/api/tracker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('trackServerEvent', () => {
  it('inserts into events table when client provided', () => {
    const insert = vi.fn();
    const client: ServerEventClient = { from: vi.fn(() => ({ insert })) };
    trackServerEvent(client, { eventId: 'E040', userId: 'user-1', properties: { match_id: 'm1' } });
    expect(client.from).toHaveBeenCalledWith('events');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      session_id: '',
      event_id: 'E040',
      event_name: 'report_generated',
      properties: { match_id: 'm1' },
    }));
  });

  it('uses console.log when client is null', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    trackServerEvent(null, { eventId: 'E053', properties: { report_id: 'r1' } });
    expect(log).toHaveBeenCalledWith('[track:server]', 'E053', 'card_realtime_rendered', { report_id: 'r1' });
  });

  it('swallows db error and does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client: ServerEventClient = { from: () => ({ insert: () => { throw new Error('db down'); } }) };
    expect(() => trackServerEvent(client, { eventId: 'E092' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[track] failed:', 'db down');
  });

  it('event_name is human-readable mapped from event_id', () => {
    expect(eventNameForTest('E013')).toBe('shortlink_resolved');
    expect(eventNameForTest('E031')).toBe('payment_triggered');
    expect(eventNameForTest('E032')).toBe('payment_succeeded');
    expect(eventNameForTest('E033')).toBe('payment_refunded');
    expect(eventNameForTest('E042')).toBe('report_persist_failed');
    expect(eventNameForTest('E044')).toBe('report_preset_created');
    expect(eventNameForTest('E045')).toBe('report_publish_triggered');
    expect(eventNameForTest('E046')).toBe('report_human_overridden');
    expect(eventNameForTest('E047')).toBe('report_finals_degraded');
    expect(eventNameForTest('E054')).toBe('report_read_completed');
    expect(eventNameForTest('E064')).toBe('deepseek_empty_retry');
    expect(eventNameForTest('E092')).toBe('cost_cap_reached');
  });

  it('maps admin operation event ids', () => {
    expect(eventNameForTest('E094')).toBe('admin_ban_ip');
    expect(eventNameForTest('E095')).toBe('admin_cost_override');
    expect(eventNameForTest('E096')).toBe('admin_query_events');
    expect(eventNameForTest('E097')).toBe('laoli_video_generated');
  });

  it('maps API-Football sync and quota event ids', () => {
    expect(eventNameForTest('E070')).toBe('fixtures_api_call');
    expect(eventNameForTest('E071')).toBe('fixtures_sync_started');
    expect(eventNameForTest('E072')).toBe('fixtures_synced');
    expect(eventNameForTest('E073')).toBe('api_football_quota_check');
    expect(eventNameForTest('E074')).toBe('api_football_quota_alert');
    expect(eventNameForTest('E090')).toBe('schema_migration_event');
  });

  it('maps report human override event id', () => {
    expect(eventNameForTest('E046')).toBe('report_human_overridden');
  });

  it('trackServerEventGlobal uses service client when USE_DB=true', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    const insert = vi.fn();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ from: vi.fn(() => ({ insert })) }),
    }));
    const { trackServerEventGlobal } = await import('@/lib/api/tracker');
    trackServerEventGlobal({ eventId: 'E061', properties: { provider: 'doubao' } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_id: 'E061', event_name: 'llm_call_failed' }));
  });

  it('trackServerEventGlobal falls back to console.log when USE_DB=false', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { trackServerEventGlobal } = await import('@/lib/api/tracker');
    trackServerEventGlobal({ eventId: 'E063', properties: { providers: ['doubao'] } });
    expect(log).toHaveBeenCalledWith('[track:server]', 'E063', 'llm_all_providers_down', { providers: ['doubao'] });
  });

  it('trackServerEventGlobal does not throw on getSupabaseService failure', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => {
        throw new Error('client down');
      },
    }));
    const { trackServerEventGlobal } = await import('@/lib/api/tracker');
    expect(() => trackServerEventGlobal({ eventId: 'E060' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[track] failed:', 'client down');
  });
});
