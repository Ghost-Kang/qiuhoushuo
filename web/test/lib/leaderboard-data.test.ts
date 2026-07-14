import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaderEntry } from '@/lib/api-football/leaderboard';
import type { GroupStanding, KnockoutMatch } from '@/lib/api-football/standings';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

const SCORERS: LeaderEntry[] = [
  { name: 'L. Messi', team: 'Argentina', count: 5, apps: 2 },
  { name: 'Nobody Zzz', team: 'Narnia', count: 1, apps: 1 },
];
const GROUPS: GroupStanding[] = [
  { group: 'Group A', rows: [{ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: 'Round of 32' }] },
];
const KO: KnockoutMatch[] = [{ home: 'Mexico', away: 'Canada', kickoffAt: '2026-06-28T19:00:00+00:00', round: 'Round of 32', status: 'NS' }];

async function load() {
  const fetchLeaderboard = vi.fn(async () => SCORERS);
  const fetchStandings = vi.fn(async () => GROUPS);
  const fetchKnockoutMatchups = vi.fn(async () => KO);
  vi.doMock('@/lib/api-football/leaderboard', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api-football/leaderboard')>('@/lib/api-football/leaderboard')),
    fetchLeaderboard,
  }));
  vi.doMock('@/lib/api-football/standings', async () => ({
    ...(await vi.importActual<typeof import('@/lib/api-football/standings')>('@/lib/api-football/standings')),
    fetchStandings, fetchKnockoutMatchups,
  }));
  const mod = await import('@/lib/api/leaderboard-data');
  mod.__clearLeaderboardCacheForTests();
  return { ...mod, fetchLeaderboard, fetchStandings, fetchKnockoutMatchups };
}

describe('getLeaderboardData', () => {
  it('球员名译中文(查不到回退英文),队名英文原文', async () => {
    const { getLeaderboardData } = await load();
    const d = await getLeaderboardData();
    expect(d.scorers[0]).toEqual({ name: '梅西', team: 'Argentina', count: 5, apps: 2 });
    expect(d.scorers[1]!.name).toBe('Nobody Zzz'); // 字典 miss → 英文原文
    expect(d.asof).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });

  it('进程内缓存:第二次不再打 API(force=true 才重取)', async () => {
    const { getLeaderboardData, fetchLeaderboard } = await load();
    await getLeaderboardData();
    await getLeaderboardData();
    expect(fetchLeaderboard).toHaveBeenCalledTimes(2); // 一次取 scorers + 一次 assists(同次调用),第二次命中缓存不再调
    await getLeaderboardData(true);
    expect(fetchLeaderboard).toHaveBeenCalledTimes(4); // force 重取
  });
});

describe('getStandingsData', () => {
  it('组名 A-L、英文队名、qualified 官方分类、带淘汰赛对阵', async () => {
    const { getStandingsData } = await load();
    const d = await getStandingsData();
    expect(d.groups[0]!.group).toBe('A');
    expect(d.groups[0]!.rows[0]).toEqual({ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, qualified: true });
    expect(d.knockout[0]!.home).toBe('Mexico');
  });

  it('淘汰赛抽签未出(抛错)→ 不拖垮主体,knockout 空', async () => {
    const fetchKnockoutMatchups = vi.fn(async () => { throw new Error('no draw'); });
    vi.doMock('@/lib/api-football/standings', async () => ({
      ...(await vi.importActual<typeof import('@/lib/api-football/standings')>('@/lib/api-football/standings')),
      fetchStandings: vi.fn(async () => GROUPS), fetchKnockoutMatchups,
    }));
    const mod = await import('@/lib/api/leaderboard-data');
    mod.__clearLeaderboardCacheForTests();
    const d = await mod.getStandingsData();
    expect(d.groups[0]!.group).toBe('A');
    expect(d.knockout).toEqual([]);
  });
});
