import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

type EventQueryCall = { select?: string; column?: string; since?: string; limit?: number };
type EventsQuery = {
  columns?: string;
  gte(column: string, since: string): EventsQuery;
  limit(n: number): Promise<{ data: ReturnType<typeof rows> }>;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('/api/admin/events-recent', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRoute();
    expect((await GET(req('/api/admin/events-recent'))).status).toBe(401);
  });

  it('returns events grouped by event_id', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRoute();
    const res = await GET(adminReq('/api/admin/events-recent'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.window_seconds).toBe(300);
    expect(body.total).toBe(3);
    expect(body.events).toContainEqual({ event_id: 'E040', event_name: 'report_generated', count: 2 });
  });

  it('respects window_seconds parameter', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const calls: EventQueryCall[] = [];
    const { GET } = await loadRoute(calls);
    await GET(adminReq('/api/admin/events-recent?window_seconds=600'));
    expect(calls[0]?.since).toBeTruthy();
  });

  it('queries by created_at column not occurred_at', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const calls: EventQueryCall[] = [];
    const { GET } = await loadRoute(calls);
    await GET(adminReq('/api/admin/events-recent'));
    expect(calls[0]?.column).toBe('created_at');
    expect(calls[0]?.select).toBe('event_id,event_name,created_at');
  });

  it('applies row limit to bound application grouping', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const calls: EventQueryCall[] = [];
    const { GET } = await loadRoute(calls);
    await GET(adminReq('/api/admin/events-recent'));
    expect(calls[0]?.limit).toBe(10000);
  });

  it('warns when events result is truncated', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { GET } = await loadRoute([], 10000);
    const res = await GET(adminReq('/api/admin/events-recent'));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith('[api/admin/events-recent] truncated at 10000 rows');
  });
});

async function loadRoute(calls: EventQueryCall[] = [], rowCount = 3) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client(calls, rowCount) }));
  return import('@/app/api/admin/events-recent/route');
}

function client(calls: EventQueryCall[], rowCount: number) {
  return {
    from(table: string) {
      if (table === 'events') {
        const query: EventsQuery = {
          gte: (column: string, since: string) => {
            calls.push({ select: query.columns, column, since });
            return query;
          },
          limit: (n: number) => {
            const first = calls[0];
            if (first) first.limit = n;
            return Promise.resolve({ data: rows(rowCount) });
          },
        };
        return {
          select: (columns: string) => {
            query.columns = columns;
            return query;
          },
          insert: vi.fn(),
        };
      }
      return { insert: vi.fn() };
    },
  };
}

function rows(count: number) {
  if (count === 3) {
    return [
      { event_id: 'E040', event_name: 'report_generated', created_at: '2026-05-14T00:00:00Z' },
      { event_id: 'E040', event_name: 'report_generated', created_at: '2026-05-14T00:00:01Z' },
      { event_id: 'E051', event_name: 'card_prerender_succeeded', created_at: '2026-05-14T00:00:02Z' },
    ];
  }
  return Array.from({ length: count }, () => ({ event_id: 'E040', event_name: 'report_generated', created_at: '2026-05-14T00:00:00Z' }));
}

function adminReq(path: string) {
  return req(path, { headers: { 'x-admin-token': 'secret' } });
}
