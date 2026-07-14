import { describe, expect, it } from 'vitest';
import { parseLeaderboard } from '@/lib/api-football/leaderboard';

// 真实 /players/topscorers·topassists 形态(已按计数降序)
const raw = [
  { player: { name: 'L. Messi' }, statistics: [{ team: { name: 'Argentina' }, games: { appearences: 2 }, goals: { total: 5, assists: 0 } }] },
  { player: { name: 'K. Mbappé' }, statistics: [{ team: { name: 'France' }, games: { appearences: 3 }, goals: { total: 4, assists: 1 } }] },
  { player: { name: 'A. Isak' }, statistics: [{ team: { name: 'Sweden' }, games: { appearences: 3 }, goals: { total: 1, assists: 3 } }] },
];

describe('parseLeaderboard', () => {
  it('topscorers 取 goals.total,保序,带队名/场次', () => {
    const out = parseLeaderboard('topscorers', raw);
    expect(out).toEqual([
      { name: 'L. Messi', team: 'Argentina', count: 5, apps: 2 },
      { name: 'K. Mbappé', team: 'France', count: 4, apps: 3 },
      { name: 'A. Isak', team: 'Sweden', count: 1, apps: 3 },
    ]);
  });

  it('topassists 取 goals.assists,计数为 0 者剔除,按计数降序自排(不信 API 顺序)', () => {
    const out = parseLeaderboard('topassists', raw);
    // Messi assists=0 → 剔除;入参 Mbappé(1) 在 Isak(3) 前,自排后 Isak 应居首
    expect(out).toEqual([
      { name: 'A. Isak', team: 'Sweden', count: 3, apps: 3 },
      { name: 'K. Mbappé', team: 'France', count: 1, apps: 3 },
    ]);
  });

  it('不信 API 顺序:乱序进球数 → 自排降序(金靴领跑取最高)', () => {
    const messy = [
      { player: { name: 'B' }, statistics: [{ team: { name: 'T' }, league: { id: 1 }, games: { appearences: 3 }, goals: { total: 2 } }] },
      { player: { name: 'A' }, statistics: [{ team: { name: 'T' }, league: { id: 1 }, games: { appearences: 3 }, goals: { total: 9 } }] },
    ];
    expect(parseLeaderboard('topscorers', messy as never).map((e) => e.name)).toEqual(['A', 'B']);
  });

  it('转会球员多 statistics 条:优先 league.id 命中条(非首条)', () => {
    const multi = [{ player: { name: 'X' }, statistics: [
      { team: { name: '俱乐部' }, league: { id: 39 }, games: { appearences: 30 }, goals: { total: 20 } }, // 联赛,非本赛事
      { team: { name: 'Brazil' }, league: { id: 1 }, games: { appearences: 3 }, goals: { total: 4 } }, // 本赛事
    ] }];
    expect(parseLeaderboard('topscorers', multi as never)).toEqual([{ name: 'X', team: 'Brazil', count: 4, apps: 3 }]);
  });

  it('limit 截断;无 statistics / null 计数 防御', () => {
    expect(parseLeaderboard('topscorers', raw, 2)).toHaveLength(2);
    const messy = [
      { player: { name: 'X' }, statistics: [] }, // 无 stat → 跳过
      { player: { name: 'Y' }, statistics: [{ team: { name: 'Z' }, goals: { total: null, assists: null } }] }, // null → 0 → 剔除
      { player: { name: 'W' }, statistics: [{ team: { name: 'Q' }, games: {}, goals: { total: 2 } }] }, // apps 缺 → 0
    ];
    expect(parseLeaderboard('topscorers', messy as never)).toEqual([{ name: 'W', team: 'Q', count: 2, apps: 0 }]);
  });

  it('空响应 → 空数组', () => {
    expect(parseLeaderboard('topscorers', [])).toEqual([]);
    expect(parseLeaderboard('topassists', undefined as never)).toEqual([]);
  });
});
