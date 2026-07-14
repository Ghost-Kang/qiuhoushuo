import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaderEntry } from '@/lib/api-football/leaderboard';
import type { GroupStanding } from '@/lib/api-football/standings';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

const SCORERS: LeaderEntry[] = [{ name: 'L. Messi', team: 'Argentina', count: 5, apps: 2 }];
const ASSISTS: LeaderEntry[] = [{ name: 'A. Isak', team: 'Sweden', count: 3, apps: 3 }];
const GROUPS: GroupStanding[] = [
  { group: 'Group A', rows: [{ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: 'Round of 32' }] },
  { group: 'Group B', rows: [{ rank: 1, team: 'France', played: 3, win: 2, draw: 1, lose: 0, goalsDiff: 4, points: 7, description: null }] },
  { group: 'Group Stage', rows: [{ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: null }] }, // 汇总,跳过
  { group: 'Group C', rows: [] }, // 空组,跳过
];

async function load(opts: {
  fetchLeaderboard?: ReturnType<typeof vi.fn>;
  fetchStandings?: ReturnType<typeof vi.fn>;
  renderScoreboard?: ReturnType<typeof vi.fn>;
  renderStandings?: ReturnType<typeof vi.fn>;
} = {}) {
  const fetchLeaderboard = opts.fetchLeaderboard ?? vi.fn(async (k: string) => (k === 'topscorers' ? SCORERS : ASSISTS));
  const fetchStandings = opts.fetchStandings ?? vi.fn(async () => GROUPS);
  const renderScoreboard = opts.renderScoreboard ?? vi.fn(async () => Buffer.from([1]));
  const renderStandings = opts.renderStandings ?? vi.fn(async () => Buffer.from([2]));
  vi.doMock('@/lib/api-football/leaderboard', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api-football/leaderboard')>('@/lib/api-football/leaderboard')),
    fetchLeaderboard,
  }));
  vi.doMock('@/lib/api-football/standings', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api-football/standings')>('@/lib/api-football/standings')),
    fetchStandings,
    fetchKnockoutMatchups: vi.fn(async () => []), // 防 JSON 预热打真网络(getStandingsData 会调它)
  }));
  vi.doMock('@/lib/api/scoreboard-card', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api/scoreboard-card')>('@/lib/api/scoreboard-card')),
    renderScoreboardCard: renderScoreboard,
  }));
  vi.doMock('@/lib/api/standings-card', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api/standings-card')>('@/lib/api/standings-card')),
    renderStandingsCard: renderStandings,
  }));
  const { prewarmLeaderboards } = await import('@/lib/api/leaderboard-prewarm');
  return { prewarmLeaderboards, fetchLeaderboard, fetchStandings, renderScoreboard, renderStandings };
}

describe('prewarmLeaderboards', () => {
  it('预热 scoreboard + 仅字母组(剔汇总/空组),写当前小时 key', async () => {
    const puts: string[] = [];
    const storage = { exists: vi.fn(), put: vi.fn(async (k: string) => { puts.push(k); return 'memory://x'; }) };
    const { prewarmLeaderboards } = await load();
    const res = await prewarmLeaderboards(storage as never, new Date('2026-06-26T05:00:00Z')); // 北京 13 时
    expect(res.scoreboard).toBe('warmed');
    expect(res.json).toBe('warmed'); // 端内页 JSON 缓存也预热
    expect(res.standings.groups).toEqual(['A', 'B']); // Group Stage(汇总)+ C(空)跳过
    expect(res.stamp).toBe('2026062613');
    expect(puts).toContain('cards/v34/leaderboard/scoreboard-2026062613-xhs.png');
    expect(puts).toContain('cards/v34/leaderboard/standings-A-2026062613-xhs.png');
    expect(puts).toContain('cards/v34/leaderboard/standings-B-2026062613-xhs.png');
    expect(puts.some((k) => /standings-C-/.test(k))).toBe(false);
  });

  it('双榜空 → scoreboard=empty,不落 scoreboard 卡', async () => {
    const storage = { exists: vi.fn(), put: vi.fn(async () => 'memory://x') };
    const fetchLeaderboard = vi.fn(async () => [] as LeaderEntry[]);
    const { prewarmLeaderboards, renderScoreboard } = await load({ fetchLeaderboard });
    const res = await prewarmLeaderboards(storage as never, new Date('2026-06-26T05:00:00Z'));
    expect(res.scoreboard).toBe('empty');
    expect(renderScoreboard).not.toHaveBeenCalled();
  });

  it('scoreboard 抓取异常不影响 standings 预热(隔离)', async () => {
    const storage = { exists: vi.fn(), put: vi.fn(async () => 'memory://x') };
    const fetchLeaderboard = vi.fn(async () => { throw new Error('boom'); });
    const { prewarmLeaderboards } = await load({ fetchLeaderboard });
    const res = await prewarmLeaderboards(storage as never, new Date('2026-06-26T05:00:00Z'));
    expect(res.scoreboard).toBe('failed');
    expect(res.standings.warmed).toBe(2); // standings 仍预热
  });
});
