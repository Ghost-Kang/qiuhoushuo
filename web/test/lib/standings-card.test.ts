import { describe, expect, it } from 'vitest';
import { groupLabel, isQualified, buildStandingsCardKey, buildStandingsPayload } from '@/lib/api/standings-card';
import { CARD_RENDER_CACHE_VERSION } from '@/lib/api/card-storage';
import type { GroupStanding } from '@/lib/api-football/standings';

describe('groupLabel', () => {
  it('"Group A" → "A组";已是中文/异常原样', () => {
    expect(groupLabel('Group A')).toBe('A组');
    expect(groupLabel('group l')).toBe('L组');
    expect(groupLabel('A组')).toBe('A组');
    expect(groupLabel('')).toBe('');
  });
});

describe('isQualified', () => {
  it('仅数据源官方下一轮分类判已出线;空/小组赛中不声称', () => {
    expect(isQualified('Round of 32')).toBe(true);
    expect(isQualified('Promotion - Knockout stage')).toBe(true);
    expect(isQualified(null)).toBe(false);
    expect(isQualified('')).toBe(false);
    expect(isQualified('Group Stage')).toBe(false);
  });

  it('否定/淘汰类描述绝不误判已出线("Did not qualify" 含 qualif 也为 false)', () => {
    expect(isQualified('Did not qualify')).toBe(false);
    expect(isQualified('Eliminated')).toBe(false);
    expect(isQualified('Failed to advance')).toBe(false);
    expect(isQualified('Knocked out')).toBe(false); // 含 out
  });
});

describe('buildStandingsCardKey', () => {
  it('组+日期戳独立 key,含缓存版本', () => {
    expect(buildStandingsCardKey('A', '20260626')).toBe(`cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/standings-A-20260626-xhs.png`);
  });
  it('剥非法字符防注入', () => {
    expect(buildStandingsCardKey('a/../', '2026-06-26')).toBe(`cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/standings-A-20260626-xhs.png`);
  });
});

describe('buildStandingsPayload', () => {
  const group: GroupStanding = {
    group: 'Group A',
    rows: [
      { rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: 'Round of 32' },
      { rank: 4, team: 'Saudi Arabia', played: 3, win: 0, draw: 0, lose: 3, goalsDiff: -7, points: 0, description: null },
    ],
  };

  it('队名英→中、组名脱敏、赛事名中性(无商标词)、按官方分类标已出线', () => {
    const p = buildStandingsPayload(group, '2026.06.26');
    expect(p.standingsCard!.title_line).toBe('国际大赛 · A组 积分榜');
    expect(p.standingsCard!.title_line).not.toMatch(/world\s*cup|group\s+a/i);
    expect(p.standingsCard!.asof).toBe('数据截至 2026.06.26');
    expect(p.standingsCard!.rows).toEqual([
      { rank: 1, team: '墨西哥', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, qualified: true, flag: expect.stringMatching(/flags\/.+\.png$/) },
      { rank: 4, team: '沙特阿拉伯', played: 3, win: 0, draw: 0, lose: 3, goalsDiff: -7, points: 0, qualified: false, flag: expect.stringMatching(/flags\/.+\.png$/) },
    ]);
    expect(p.brand).toContain('AI 生成');
  });
});
