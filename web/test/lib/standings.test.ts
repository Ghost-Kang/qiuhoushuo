import { describe, expect, it } from 'vitest';
import { parseStandings, pickGroup } from '@/lib/api-football/standings';

// 真实 /standings 形态:response[0].league.standings = 各组数组,含 "Group Stage" 汇总组须剔除
const response = [{
  league: {
    standings: [
      [
        { rank: 1, team: { name: 'Mexico' }, points: 9, goalsDiff: 6, group: 'Group A', description: 'Round of 32', all: { played: 3, win: 3, draw: 0, lose: 0 } },
        { rank: 3, team: { name: 'South Korea' }, points: 3, goalsDiff: -2, group: 'Group A', description: null, all: { played: 3, win: 1, draw: 0, lose: 2 } },
        { rank: 2, team: { name: 'Netherlands' }, points: 6, goalsDiff: 3, group: 'Group A', description: 'Round of 32', all: { played: 3, win: 2, draw: 0, lose: 1 } },
      ],
      [
        { rank: 1, team: { name: 'France' }, points: 7, goalsDiff: 4, group: 'Group B', description: 'Round of 32', all: { played: 3, win: 2, draw: 1, lose: 0 } },
      ],
      // 汇总组(48 队总表)→ 必须剔除
      [{ rank: 1, team: { name: 'Mexico' }, points: 9, goalsDiff: 6, group: 'Group Stage', all: { played: 3, win: 3, draw: 0, lose: 0 } }],
    ],
  },
}];

describe('parseStandings', () => {
  it('剔除 "Group Stage" 汇总组,只留字母组', () => {
    const out = parseStandings(response as never);
    expect(out.map((g) => g.group)).toEqual(['Group A', 'Group B']);
  });

  it('组内按 rank 升序;映射 played/胜平负/净胜/积分/description', () => {
    const out = parseStandings(response as never);
    const a = out[0]!;
    expect(a.rows.map((r) => r.rank)).toEqual([1, 2, 3]); // 入参乱序 → 升序
    expect(a.rows[0]).toEqual({ rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: 'Round of 32' });
  });

  it('剔除 L 以外的字母组(2026 制仅 A–L)', () => {
    const withM = [{ league: { standings: [
      [{ rank: 1, team: { name: 'X' }, points: 3, goalsDiff: 0, group: 'Group M', all: { played: 1, win: 1, draw: 0, lose: 0 } }],
      [{ rank: 1, team: { name: 'Y' }, points: 3, goalsDiff: 0, group: 'Group L', all: { played: 1, win: 1, draw: 0, lose: 0 } }],
    ] } }];
    expect(parseStandings(withM as never).map((g) => g.group)).toEqual(['Group L']);
  });

  it('空响应 → 空数组', () => {
    expect(parseStandings([] as never)).toEqual([]);
    expect(parseStandings([{ league: {} }] as never)).toEqual([]);
  });
});

describe('pickGroup', () => {
  it('大小写不敏感取组;未找到 undefined', () => {
    const out = parseStandings(response as never);
    expect(pickGroup(out, 'a')?.group).toBe('Group A');
    expect(pickGroup(out, 'B')?.group).toBe('Group B');
    expect(pickGroup(out, 'Z')).toBeUndefined();
  });
});
