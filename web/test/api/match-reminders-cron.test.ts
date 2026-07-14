import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.WX_APPID;
  delete process.env.WX_SECRET;
});

function cronReq(token?: string) {
  return new Request('http://localhost/api/cron/match-reminders', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /api/cron/match-reminders', () => {
  it('未配 ADMIN_API_SECRET → 503', async () => {
    const { GET } = await import('@/app/api/cron/match-reminders/route');
    expect((await GET(cronReq('x'))).status).toBe(503);
  });

  it('错 token → 401', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    const { GET } = await import('@/app/api/cron/match-reminders/route');
    expect((await GET(cronReq('wrong'))).status).toBe(401);
  });

  it('窗口内的场 → 对 pending 订阅推 + 标 sent', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    process.env.WX_APPID = 'a';
    process.env.WX_SECRET = 's';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).includes('cgi-bin/token')
        ? new Response(JSON.stringify({ access_token: 'TK', expires_in: 7200 }), { status: 200 })
        : new Response(JSON.stringify({ errcode: 0 }), { status: 200 })
    )));
    const marked: string[] = [];
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: (t: string) => (t === 'matches'
          ? { select: () => ({ gte: () => ({ lt: async () => ({ data: [{ id: 'm1', home_team: 'Brazil', away_team: 'Spain', competition: 'C', match_date: new Date(Date.now() + 10 * 60000).toISOString() }] }) }) }) }
          : {
              select: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ data: [{ id: 's1', openid: 'o1' }] }) }) }) }),
              update: () => ({ eq: async (_c: string, v: string) => { marked.push(v); return { data: null }; } }),
            }),
      }),
    }));
    const { GET } = await import('@/app/api/cron/match-reminders/route');
    const res = await GET(cronReq('secret'));
    expect(res.status).toBe(200);
    const body = await res.json() as { matches: number; pushed: number };
    expect(body.matches).toBe(1);
    expect(body.pushed).toBe(1);
    expect(marked).toEqual(['s1']);
  });
});
