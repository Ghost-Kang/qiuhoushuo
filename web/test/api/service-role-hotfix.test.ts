import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, json } from './_utils';

type Scenario = 'me' | 'track' | 'paid' | 'unpaid';
type LogEntry =
  | { table: string; op: 'eq'; column: string; value: unknown }
  | { table: string; op: 'in'; column: string; value: unknown }
  | { table: string; op: 'insert'; value: unknown };
type ServiceQuery = {
  select(): ServiceQuery;
  eq(column: string, value: unknown): ServiceQuery | Promise<{ data: ReturnType<typeof reportRows> }> | Promise<{ data: { sku: string }[] }>;
  in(column: string, value: unknown): ServiceQuery;
  limit(): Promise<{ data: { id: string; content?: string }[] }>;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null }>;
  insert(value: unknown): Promise<{ data: null }>;
};

const logs: LogEntry[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  logs.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.REPORT_PAYWALL_ENABLED;
});

describe('service-role API hotfixes', () => {
  it('me returns own user data only', async () => {
    const { GET } = await loadMeRoute('me');
    const body = await json(await GET(authed('/api/me')));
    expect(body.user.nickname).toBe('小王');
    expect(logs).toContainEqual({ table: 'users', op: 'eq', column: 'wx_openid', value: 'mock_openid_001' });
    expect(logs).toContainEqual({ table: 'chat_quotes', op: 'eq', column: 'user_id', value: 'user-1' });
    expect(logs).toContainEqual({ table: 'payments', op: 'eq', column: 'user_id', value: 'user-1' });
  });

  it('report detail returns 3 styles for premium-paid user', async () => {
    const { GET } = await loadReportRoute('paid');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(Object.keys(body)).toContain('hardcore');
    expect(Object.keys(body)).toContain('duanzi');
    expect(Object.keys(body)).toContain('emotion');
    expect(logs).toContainEqual({ table: 'payments', op: 'eq', column: 'user_id', value: 'user-1' });
  });

  it('report detail locks premium styles for unpaid user (paywall, not hidden)', async () => {
    const { GET } = await loadReportRoute('unpaid');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore.premium_locked).toBe(true); // premium 行保留但锁定,渲染付费墙
    expect(body.duanzi.title).toBe('段子');
    expect(body.emotion.title).toBe('情绪');
  });

  it('track inserts into events with resolved user_id', async () => {
    const { POST } = await loadTrackRoute('track');
    await POST(authed('/api/track', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'E001', event_name: 'app_open', properties: {} }),
    }));
    expect(logs).toContainEqual(expect.objectContaining({
      table: 'events',
      op: 'insert',
      value: expect.objectContaining({ user_id: 'user-1', session_id: null }),
    }));
  });

  it('track persists session_id from request body', async () => {
    const { POST } = await loadTrackRoute('track');
    await POST(authed('/api/track', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E001',
        event_name: 'app_open',
        properties: {},
        session_id: 'sess_body-1',
      }),
    }));
    expect(logs).toContainEqual(expect.objectContaining({
      table: 'events',
      op: 'insert',
      value: expect.objectContaining({ user_id: 'user-1', session_id: 'sess_body-1' }),
    }));
  });

  it('track falls back to x-session-id header', async () => {
    const { POST } = await loadTrackRoute('track');
    await POST(authed('/api/track', {
      method: 'POST',
      headers: { 'x-session-id': 'sess_header-1' },
      body: JSON.stringify({ event_id: 'E001', event_name: 'app_open', properties: {} }),
    }));
    expect(logs).toContainEqual(expect.objectContaining({
      table: 'events',
      op: 'insert',
      value: expect.objectContaining({ user_id: 'user-1', session_id: 'sess_header-1' }),
    }));
  });
});

async function loadMeRoute(scenario: Scenario) {
  mockDb(scenario);
  return import('@/app/api/me/route');
}

async function loadReportRoute(scenario: Scenario) {
  process.env.REPORT_PAYWALL_ENABLED = '1'; // 本套件钉付费墙开启时的锁定/解锁分支(默认关另由 report-detail.test.ts 覆盖)
  mockDb(scenario);
  return import('@/app/api/report/[id]/route');
}

async function loadTrackRoute(scenario: Scenario) {
  mockDb(scenario);
  return import('@/app/api/track/route');
}

function mockDb(scenario: Scenario) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-role';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => createClient(scenario) }));
}

function createClient(scenario: Scenario) {
  return {
    from(table: string) {
      return createQuery(table, scenario);
    },
  };
}

function createQuery(table: string, scenario: Scenario) {
  const filters: Record<string, unknown> = {};
  const query: ServiceQuery = {
    select() { return query; },
    eq(column: string, value: unknown) {
      logs.push({ table, op: 'eq', column, value });
      filters[column] = value;
      if (table === 'reports' && column === 'match_id') return Promise.resolve({ data: reportRows() });
      // 付费查询终止于 .eq('status','success')：
      //  - report/[id] successfulSkus 直接 await 它
      //  - /api/me 在其后续 .order('paid_at').limit(10)
      // 故返回既可 await 又可续链的 thenable。
      if (table === 'payments' && column === 'status') {
        const rows = scenario === 'paid'
          ? [{ id: 'pay-1', sku: 'deep_report', amount_cents: 1900, paid_at: '2026-06-16' }]
          : [];
        const settled = { data: rows };
        const chain = {
          then: (resolve: (v: typeof settled) => unknown) => resolve(settled),
          order: () => chain,
          limit: () => Promise.resolve(settled),
        };
        return chain as unknown as Promise<{ data: { sku: string }[] }>;
      }
      return query;
    },
    in(column: string, value: unknown) {
      logs.push({ table, op: 'in', column, value });
      filters[column] = value;
      return query;
    },
    limit() {
      if (table === 'chat_quotes') return Promise.resolve({ data: [{ id: 'q1', content: '金句' }] });
      if (table === 'payments') return Promise.resolve({ data: scenario === 'paid' ? [{ id: 'pay-1' }] : [] });
      return Promise.resolve({ data: [] });
    },
    maybeSingle() {
      if (table === 'users') return Promise.resolve({ data: { id: 'user-1', wx_openid: filters.wx_openid, nickname: '小王' } });
      if (table === 'matches') return Promise.resolve({ data: { id: 'match-1' } });
      if (table === 'reports') return Promise.resolve({ data: { match_id: 'match-1' } });
      return Promise.resolve({ data: null });
    },
    insert(value: unknown) {
      logs.push({ table, op: 'insert', value });
      return Promise.resolve({ data: null });
    },
  };
  return query;
}

function reportRows() {
  const base = {
    match_id: 'match-1',
    subtitle: '',
    lead: '',
    body: [],
    share_quote: '',
    tags: [],
    matches: { short_code: 'mock001', competition: '国际大赛小组赛', match_date: '2026-06-16T00:00:00Z', home_team: '巴西', away_team: '西班牙', home_score: 2, away_score: 1, stats: {} },
  };
  return [
    { ...base, id: 'r1', style: 'hardcore', title: '硬核', is_premium: true },
    { ...base, id: 'r2', style: 'duanzi', title: '段子', is_premium: false },
    { ...base, id: 'r3', style: 'emotion', title: '情绪', is_premium: false },
  ];
}
