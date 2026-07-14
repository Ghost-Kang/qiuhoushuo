/**
 * 官方战报风卡(ft)组装器:国际官方赛后模版结构 × 球后皮肤。
 * 关键不变量:① 进球者双栏=常规进球(点球大战逐轮归拢不进名单),乌龙随受益方列出并标注;
 * ② 比分进程优先 stats.scoreBreakdown,缺则事件推导兜底(PEN 场次「120分钟 X:X · 点球 h:a」);
 * ③ 90分钟行只在有加时/点球时展示(否则与终场重复);「加时」展示累计终局比分;
 * ④ 球场名保留英文(founder 口径 2026-07-04);⑤ 数据条按可得性生成,ratio=主队占比。
 */
import { describe, expect, it } from 'vitest';
import { buildMatchFtCard } from '@/lib/api/match-brief-card';

const ARG_EVENTS = [
  { minute: 29, type: 'goal', team: 'Argentina', player: 'L. Messi', assist: 'L. Martinez' },
  { minute: 59, type: 'goal', team: 'Cape Verde Islands', player: 'D. Duarte', assist: 'R. Mendes' },
  { minute: 92, type: 'goal', team: 'Argentina', player: 'L. Martinez', assist: 'A. Mac Allister' },
  { minute: 103, type: 'goal', team: 'Cape Verde Islands', player: 'S. Lopes Cabral', assist: 'Y. Semedo' },
  { minute: 111, type: 'goal', team: 'Argentina', player: 'D. Borges', description: '乌龙球' },
];

function argMatch(over: Record<string, unknown> = {}) {
  return {
    id: 'm-arg',
    competition: '国际大赛 2026 - 32强赛',
    date: '2026-07-03',
    home_team: 'Argentina',
    away_team: 'Cape Verde Islands',
    home_score: 3,
    away_score: 2,
    stats: {
      possession: { home: 64, away: 36 },
      shots: { home: 22, away: 13 },
      shots_on_target: { home: 10, away: 5 },
      xg: { home: 2.15, away: 0.36 },
      venue: { name: 'Hard Rock Stadium', city: 'Miami Gardens' },
      scoreBreakdown: { halftime: { home: 1, away: 0 }, fulltime: { home: 1, away: 1 }, extratime: { home: 2, away: 1 }, penalty: null },
      players: { motm: { name: 'Lionel Messi', team: 'Argentina', rating: 9.5, position: '前锋' } },
    },
    events: ARG_EVENTS,
    ...over,
  };
}

describe('buildMatchFtCard', () => {
  it('阿根廷 3:2 佛得角(加时):进程/双栏进球者/乌龙标注/POTM/数据条齐全', () => {
    const ft = buildMatchFtCard(argMatch(), { matchDateIso: '2026-07-03T22:00:00Z', shareQuote: '梅西负责写诗' });

    // 球场名保留英文;赛事名走清洗(分隔符规范为 ·)
    expect(ft.meta_line).toBe('国际大赛 2026 · 32强赛 · Hard Rock Stadium, Miami Gardens');
    // 北京日期 = UTC+8(07-03T22:00Z → 07-04)
    expect(ft.date_line).toBe('2026.07.04 · 北京');
    // 进程:半场 → 90分钟(有加时才展示)→ 加时=累计终局
    expect(ft.progression).toBe('半场 1:0 · 90分钟 1:1 · 加时 3:2');
    // 双栏进球者:乌龙随受益方(阿根廷)列出并标注
    expect(ft.home_scorers).toEqual(["29' 梅西", "92' 劳塔罗·马丁内斯", "111' 博尔赫斯(乌龙)"]);
    expect(ft.away_scorers).toEqual(["59' 杜阿尔特", "103' 卡布拉尔"]);
    expect(ft.potm).toContain('全场最佳 梅西 · 9.5');
    // 数据条:4 条齐,ratio=主队占比
    expect(ft.bars.map((b) => b.label)).toEqual(['控球 %', '射门', '射正', 'xG 机会质量']);
    expect(ft.bars[0]).toMatchObject({ home: '64', away: '36', home_ratio: 64 });
    expect(ft.bars[3]!.home_ratio).toBeCloseTo((2.15 / 2.51) * 100, 1);
    expect(ft.quote).toBe('梅西负责写诗');
  });

  it('点球大战场次:逐轮不进进球者名单;无 scoreBreakdown 时事件推导「120分钟 X:X · 点球 h:a」', () => {
    const ft = buildMatchFtCard({
      id: 'm-pen',
      competition: '国际大赛 - 32强赛',
      date: '2026-07-03',
      home_team: 'Australia',
      away_team: 'Egypt',
      home_score: 1,
      away_score: 1,
      stats: {},
      events: [
        { minute: 13, type: 'goal', team: 'Egypt', player: 'E. Ashour', assist: 'K. Hafez' },
        { minute: 55, type: 'goal', team: 'Australia', player: 'M. Hany', description: '乌龙球' },
        { minute: 121, type: 'penalty_missed', team: 'Australia', player: 'A' },
        { minute: 121, type: 'penalty', team: 'Egypt', player: 'B' },
        { minute: 122, type: 'penalty', team: 'Australia', player: 'C' },
        { minute: 122, type: 'penalty', team: 'Egypt', player: 'D' },
        { minute: 123, type: 'penalty', team: 'Australia', player: 'E' },
        { minute: 123, type: 'penalty', team: 'Egypt', player: 'F' },
        { minute: 124, type: 'penalty_missed', team: 'Australia', player: 'G' },
        { minute: 124, type: 'penalty', team: 'Egypt', player: 'H' },
      ],
    });
    expect(ft.progression).toBe('120分钟 1:1 · 点球 2:4');
    // 点球大战逐轮不进名单;乌龙(受益方澳大利亚)+ 常规进球各一
    expect(ft.home_scorers).toHaveLength(1);
    expect(ft.home_scorers[0]).toContain('(乌龙)');
    expect(ft.away_scorers).toHaveLength(1);
    // 时间线尾行=点球大战汇总(brief 卡同口径)
    expect(ft.timeline[ft.timeline.length - 1]).toEqual({ minute: '点球大战', text: '互射 2:4，埃及晋级' });
  });

  it('90 分钟常规胜负:进程只展示半场(90分钟与终场重复不展示);运动战点球带(点球)标注', () => {
    const ft = buildMatchFtCard({
      id: 'm-ft',
      competition: '国际大赛 - 32强赛',
      date: '2026-07-03',
      home_team: 'Portugal',
      away_team: 'Croatia',
      home_score: 2,
      away_score: 1,
      stats: { scoreBreakdown: { halftime: { home: 0, away: 1 }, fulltime: { home: 2, away: 1 }, extratime: null, penalty: null } },
      events: [
        { minute: 53, type: 'goal', team: 'Croatia', player: 'I. Perisic' },
        { minute: 68, type: 'penalty', team: 'Portugal', player: 'Cristiano Ronaldo' },
        { minute: 94, type: 'goal', team: 'Portugal', player: 'G. Ramos', assist: 'R. Leao' },
      ],
    });
    expect(ft.progression).toBe('半场 0:1');
    expect(ft.home_scorers.some((s) => s.includes('(点球)'))).toBe(true);
    expect(ft.potm).toBeUndefined(); // 无评分数据不编造
  });

  it('无 scoreBreakdown、无点球、无统计:进程省略、数据条为空,不崩', () => {
    const ft = buildMatchFtCard({
      id: 'm-min',
      competition: '',
      date: '2026-07-03',
      home_team: 'A',
      away_team: 'B',
      home_score: 1,
      away_score: 0,
      stats: {},
      events: [],
    });
    expect(ft.progression).toBeUndefined();
    expect(ft.bars).toEqual([]);
    expect(ft.meta_line).toBe('赛后战报');
  });
});
