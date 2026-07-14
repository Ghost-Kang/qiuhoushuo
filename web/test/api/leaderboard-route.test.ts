import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

async function load(getLeaderboardData = vi.fn(async () => ({ scorers: [{ name: '梅西', team: 'Argentina', count: 5, apps: 2 }], assists: [], asof: '2026.06.27' }))) {
  vi.doMock('@/lib/api/leaderboard-data', () => ({ getLeaderboardData }));
  const { GET } = await import('@/app/api/leaderboard/route');
  return { GET, getLeaderboardData };
}

describe('GET /api/leaderboard', () => {
  it('返缓存数据层结果 + max-age 头', async () => {
    const { GET, getLeaderboardData } = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorers[0]).toEqual({ name: '梅西', team: 'Argentina', count: 5, apps: 2 });
    expect(res.headers.get('cache-control')).toContain('max-age=600');
    expect(getLeaderboardData).toHaveBeenCalled();
  });

  it('数据层异常 → 502 + no-store', async () => {
    const { GET } = await load(vi.fn(async () => { throw new Error('boom'); }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
