import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

const DATA = {
  groups: [{ group: 'A', rows: [{ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, qualified: true }] }],
  knockout: [{ home: 'South Africa', away: 'Canada', kickoffAt: '2026-06-28T19:00:00+00:00', round: 'Round of 32', status: 'NS' }],
  asof: '2026.06.27',
};

async function load(getStandingsData = vi.fn(async () => DATA)) {
  vi.doMock('@/lib/api/leaderboard-data', () => ({ getStandingsData }));
  const { GET } = await import('@/app/api/standings/route');
  return { GET, getStandingsData };
}

describe('GET /api/standings', () => {
  it('返缓存数据层结果(组 + 淘汰赛对阵)+ max-age 头', async () => {
    const { GET } = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups[0].group).toBe('A');
    expect(body.groups[0].rows[0].qualified).toBe(true);
    expect(body.knockout[0]).toEqual({ home: 'South Africa', away: 'Canada', kickoffAt: '2026-06-28T19:00:00+00:00', round: 'Round of 32', status: 'NS' });
    expect(res.headers.get('cache-control')).toContain('max-age=600');
  });

  it('数据层异常 → 502 + no-store', async () => {
    const { GET } = await load(vi.fn(async () => { throw new Error('boom'); }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
