import { describe, expect, it } from 'vitest';
import { beijingDateParts, buildScoreboardCardKey, buildScoreboardPayload } from '@/lib/api/scoreboard-card';
import { CARD_RENDER_CACHE_VERSION } from '@/lib/api/card-storage';
import type { LeaderEntry } from '@/lib/api-football/leaderboard';

describe('beijingDateParts', () => {
  it('UTC 跨日 + 小时级 stamp:UTC 16:30 = 北京次日 00:30', () => {
    const { stamp, display } = beijingDateParts(new Date('2026-06-25T16:30:00Z'));
    expect(stamp).toBe('2026062600'); // YYYYMMDDHH(北京 00 时)
    expect(display).toBe('2026.06.26'); // 印卡上仍日期级
  });
  it('同日不同小时 → 不同 stamp(榜单小时级刷新)', () => {
    expect(beijingDateParts(new Date('2026-06-26T01:00:00Z')).stamp).toBe('2026062609'); // 北京 09 时
    expect(beijingDateParts(new Date('2026-06-26T05:00:00Z')).stamp).toBe('2026062613'); // 北京 13 时
  });
});

describe('buildScoreboardCardKey', () => {
  it('带日期戳的独立榜单 key(日级刷新),含当前缓存版本', () => {
    expect(buildScoreboardCardKey('20260626')).toBe(`cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/scoreboard-20260626-xhs.png`);
  });
  it('剥非数字字符防注入', () => {
    expect(buildScoreboardCardKey('2026-06-26/../x')).toBe(`cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/scoreboard-20260626-xhs.png`);
  });
});

describe('buildScoreboardPayload', () => {
  const scorers: LeaderEntry[] = [
    { name: 'L. Messi', team: 'Argentina', count: 5, apps: 2 },
    { name: 'H. Çalhanoğlu', team: 'Turkey', count: 3, apps: 3 }, // 验 fontSafe
  ];
  const assists: LeaderEntry[] = [{ name: 'A. Isak', team: 'Sweden', count: 3, apps: 3 }];

  it('队名英→中、名字 fontSafe、赛事名中性(无商标词)、带数据截至、每行带队旗 URL', () => {
    const p = buildScoreboardPayload(scorers, assists, '2026.06.26');
    expect(p.scoreboardCard!.title_line).toContain('国际大赛');
    expect(p.scoreboardCard!.title_line).not.toMatch(/world\s*cup/i);
    expect(p.scoreboardCard!.asof).toBe('数据截至 2026.06.26');
    expect(p.scoreboardCard!.scorers).toEqual([
      { name: '梅西', team: '阿根廷', count: 5, apps: 2, flag: expect.stringMatching(/flags\/.+\.png$/) }, // 优先中文译名 + 队旗
      { name: '恰尔汗奥卢', team: '土耳其', count: 3, apps: 3, flag: expect.stringMatching(/flags\/.+\.png$/) },
    ]);
    expect(p.scoreboardCard!.assists).toEqual([
      { name: '伊萨克', team: '瑞典', count: 3, apps: 3, flag: expect.stringMatching(/flags\/.+\.png$/) },
    ]);
    expect(p.brand).toContain('AI 生成');
  });

  it('标题/落款为双榜口径(卡里既有射手榜也有助攻榜)', () => {
    const p = buildScoreboardPayload(scorers, assists, '2026.06.26');
    expect(p.title).toBe('射手榜 & 助攻榜');
    expect(p.brand).toContain('射手榜&助攻榜');
  });

  it('助攻榜漏译补齐:R. Alvarado/B. Diaz/B. Embolo 出中文', () => {
    const p = buildScoreboardPayload([], [
      { name: 'R. Alvarado', team: 'Mexico', count: 3, apps: 3 },
      { name: 'B. Diaz', team: 'Morocco', count: 2, apps: 2 },
      { name: 'B. Embolo', team: 'Switzerland', count: 2, apps: 2 },
    ], '2026.06.26');
    expect(p.scoreboardCard!.assists.map((r) => r.name)).toEqual(['阿尔瓦拉多', '布拉欣·迪亚斯', '恩博洛']);
  });

  it('空榜单 → scoreboardCard 含空数组(模板回退占位)', () => {
    const p = buildScoreboardPayload([], [], '2026.06.26');
    expect(p.scoreboardCard!.scorers).toEqual([]);
    expect(p.scoreboardCard!.assists).toEqual([]);
  });
});
