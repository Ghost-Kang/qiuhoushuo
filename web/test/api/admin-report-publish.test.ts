import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('/api/admin/report-publish', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute();
    const res = await POST(req('/api/admin/report-publish', { method: 'POST', body: JSON.stringify(body()) }));
    expect(res.status).toBe(401);
  });

  it('publishes regular 3-style reports when scenario omitted', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const updates: Record<string, unknown>[] = [];
    const events: unknown[] = [];
    const { POST } = await loadRoute({ rows: regularRows(), updates, events });
    const res = await POST(adminReq({ match_id: MATCH_ID, channel: ['wechat', 'miniprogram'] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      match_id: MATCH_ID,
      scenario: null,
      reports_published: 3,
      channels_notified: ['wechat', 'miniprogram'],
    });
    expect(updates).toHaveLength(3);
    expect((updates[0]!.tags as string[]).some((tag) => tag.startsWith('published:'))).toBe(true);
    expect(events[0]).toMatchObject({ eventId: 'E045' });
  });

  it('publishes scenario preset when scenario specified', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const calls: unknown[] = [];
    const { POST } = await loadRoute({ rows: [row('preset-1', ['scenario:home_wins'])], calls });
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ scenario: 'home_wins', reports_published: 1 });
    expect(calls).toContainEqual({ op: 'contains', column: 'tags', value: ['scenario:home_wins'] });
  });

  it('returns 404 when no matching preset', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute({ rows: [] });
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });
});

async function loadRoute(opts: { rows?: ReportRow[]; updates?: Record<string, unknown>[]; events?: unknown[]; calls?: unknown[] } = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client(opts) }));
  vi.doMock('@/lib/api/tracker', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/tracker')>('@/lib/api/tracker');
    return { ...actual, trackServerEventGlobal: (event: unknown) => opts.events?.push(event) };
  });
  return import('@/app/api/admin/report-publish/route');
}

type ReportRow = { id: string; tags: string[] };

function client(opts: { rows?: ReportRow[]; updates?: Record<string, unknown>[]; calls?: unknown[] }) {
  return {
    from(table: string) {
      if (table !== 'reports') return {};
      return {
        select: () => selectQuery(opts.rows ?? regularRows(), opts.calls),
        update: (update: Record<string, unknown>) => {
          opts.updates?.push(update);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
  };
}

function selectQuery(rows: ReportRow[], calls: unknown[] = []) {
  const query = {
    eq: (column: string, value: string) => {
      calls.push({ op: 'eq', column, value });
      return query;
    },
    contains: (column: string, value: string[]) => {
      calls.push({ op: 'contains', column, value });
      return query;
    },
    then: (resolve: (value: { data: ReportRow[] }) => void) => resolve({ data: rows }),
  };
  return query;
}

function regularRows() {
  return [row('r-hardcore', []), row('r-duanzi', []), row('r-emotion', [])];
}

function row(id: string, tags: string[]): ReportRow {
  return { id, tags };
}

function adminReq(payload: unknown) {
  return req('/api/admin/report-publish', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(payload),
  });
}

function body() {
  return { match_id: MATCH_ID, scenario: 'home_wins', channel: ['wechat', 'miniprogram'] };
}
