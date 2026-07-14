import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.unstubAllEnvs(); });

async function load(prewarm = vi.fn(async () => ({ stamp: '2026062613', scoreboard: 'warmed', standings: { warmed: 2, groups: ['A', 'B'], failed: 0 } }))) {
  vi.stubEnv('ADMIN_API_SECRET', 'sekret');
  vi.doMock('@/lib/api/leaderboard-prewarm', () => ({ prewarmLeaderboards: prewarm }));
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => ({ exists: vi.fn(), put: vi.fn() }) }));
  const { GET } = await import('@/app/api/cron/warm-leaderboards/route');
  return { GET, prewarm };
}

function req(auth?: string) {
  return new Request('http://localhost/api/cron/warm-leaderboards', auth ? { headers: { authorization: auth } } : undefined);
}

describe('/api/cron/warm-leaderboards', () => {
  it('正确 Bearer → 预热并返结果', async () => {
    const { GET, prewarm } = await load();
    const res = await GET(req('Bearer sekret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stamp: '2026062613', scoreboard: 'warmed', standings: { warmed: 2, groups: ['A', 'B'], failed: 0 } });
    expect(prewarm).toHaveBeenCalled();
  });

  it('缺/错 token → 401,不预热', async () => {
    const { GET, prewarm } = await load();
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer wrong'))).status).toBe(401);
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('ADMIN_API_SECRET 未配置 → 503', async () => {
    vi.stubEnv('ADMIN_API_SECRET', '');
    vi.doMock('@/lib/api/leaderboard-prewarm', () => ({ prewarmLeaderboards: vi.fn() }));
    vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => ({}) }));
    const { GET } = await import('@/app/api/cron/warm-leaderboards/route');
    expect((await GET(req('Bearer x'))).status).toBe(503);
  });
});
