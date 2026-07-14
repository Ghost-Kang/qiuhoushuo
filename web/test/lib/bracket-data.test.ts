import { describe, expect, it } from 'vitest';
import { assembleBracket, beijingShort, type BracketDbRow } from '@/lib/api/bracket-data';

// 点球大战事件:分钟恒 >120(与真实数据一致,如德国-巴拉圭 121'–126')
const pen = (team: string, n: number) => Array.from({ length: n }, (_, i) => ({ type: 'penalty', team, minute: 121 + i }));
const row = (home: string, away: string, hs: number | null, as: number | null, status: string, events: { type: string; team: string; minute?: number }[] = [], match_date: string | null = null): BracketDbRow =>
  ({ home_team: home, away_team: away, home_score: hs, away_score: as, status, match_date, events, stats: null });

// 真实数据:4 场 R32 已完赛(2 场点球),其余未排/未打;match_date 为 UTC(北京=+8h)
const ROWS: BracketDbRow[] = [
  row('South Africa', 'Canada', 0, 1, 'finished', [], '2026-06-28T19:00:00Z'),
  row('Brazil', 'Japan', 2, 1, 'finished', [], '2026-06-29T17:00:00Z'),
  row('Germany', 'Paraguay', 1, 1, 'finished', [...pen('Paraguay', 4), ...pen('Germany', 3)], '2026-06-29T20:30:00Z'),
  row('Netherlands', 'Morocco', 1, 1, 'finished', [...pen('Morocco', 3), ...pen('Netherlands', 2)], '2026-06-30T01:00:00Z'),
];

describe('assembleBracket', () => {
  const b = assembleBracket(ROWS);

  it('R32 槽位填入真实比分(8 上 + 8 下)', () => {
    expect(b.topR32).toHaveLength(8);
    expect(b.botR32).toHaveLength(8);
    expect(b.topR32[0]).toMatchObject({ home: 'Germany', away: 'Paraguay', homeScore: 1, awayScore: 1, status: 'finished' });
    expect(b.botR32[0]).toMatchObject({ home: 'Brazil', away: 'Japan', homeScore: 2, awayScore: 1, status: 'finished' });
  });

  it('日期取 DB match_date 转北京时间(UTC+8),不是 UTC', () => {
    expect(beijingShort('2026-06-29T20:30:00Z')).toBe('6/30 04:30'); // 德国-巴拉圭
    expect(beijingShort('2026-06-28T19:00:00Z')).toBe('6/29 03:00'); // 南非-加拿大
    expect(b.topR32[0]!.date).toBe('6/30 04:30'); // 装配后用的是 DB 北京时间
    expect(b.botR32[0]!.date).toBe('6/30 01:00'); // 巴西-日本 17:00 UTC → 次日 01:00 京
  });

  it('DB 缺该场 → 用兜底排期日期(已按北京时间)', () => {
    // 未提供 USA-Bosnia 的 DB 行 → topR32[3] 用兜底 7/2 08:00
    expect(b.topR32[3]).toMatchObject({ home: 'USA', date: '7/2 08:00' });
  });

  it('点球比分从 events 数出(主客对齐槽位)', () => {
    // 槽位 home=Germany away=Paraguay → penHome=3(德国) penAway=4(巴拉圭)
    expect(b.topR32[0]).toMatchObject({ penHome: 3, penAway: 4 });
    // 荷兰 1:1 摩洛哥,点球 2:3
    const ned = b.topR32[5]!;
    expect(ned).toMatchObject({ home: 'Netherlands', away: 'Morocco', penHome: 2, penAway: 3 });
  });

  it('运动战点球不计点球分:2:1 判点/加时补时点球的场次 penHome/penAway=null 且胜者按比分', () => {
    // 葡萄牙 2:1 克罗地亚,C罗 68' 运动战点球 → 括号不出现,胜者=葡萄牙(2026-07-03 线上误显示 2(1)/1(0) 的回归)
    const rows = [row('Portugal', 'Croatia', 2, 1, 'finished', [{ type: 'penalty', team: 'Portugal', minute: 68 }])];
    const bb = assembleBracket(rows);
    const m = bb.topR32.find((x) => x.home === 'Portugal')!;
    expect(m).toMatchObject({ penHome: null, penAway: null });
    // 比利时 3:2 塞内加尔,加时补时 125' 运动战点球(分钟 >120 但比分未平)→ 同样不计
    const rows2 = [row('Belgium', 'Senegal', 3, 2, 'finished', [{ type: 'penalty', team: 'Belgium', minute: 125 }])];
    const m2 = assembleBracket(rows2).topR32.find((x) => x.home === 'Belgium')!;
    expect(m2).toMatchObject({ penHome: null, penAway: null });
  });

  it('战平场次里 120 分钟内的运动战点球不混入点球大战计数', () => {
    // 1:1 且第 60' 有记运动战点球(主队),点球大战 3:4 → 只数 121'+ 的
    const rows = [row('Germany', 'Paraguay', 1, 1, 'finished', [{ type: 'penalty', team: 'Germany', minute: 60 }, ...pen('Germany', 3), ...pen('Paraguay', 4)])];
    const m = assembleBracket(rows).topR32[0]!;
    expect(m).toMatchObject({ penHome: 3, penAway: 4 });
  });

  it('晋级方上浮到 16 强:加拿大+摩洛哥都晋级 → 同槽对阵(both determined)', () => {
    // top16[1] 由 R32 col1(South Africa-Canada→Canada) + col1下排(Netherlands-Morocco→Morocco)
    expect(b.top16[1]).toMatchObject({ home: 'Canada', away: 'Morocco', status: 'scheduled' });
  });

  it('只有一方晋级的 16 强槽 = half(另一方待定)', () => {
    // top16[0] = 巴拉圭(德国-巴拉圭胜) vs 法国-瑞典胜者(未打)
    expect(b.top16[0]).toMatchObject({ home: 'Paraguay', status: 'half' });
    expect(b.top16[0]!.away).toBeUndefined();
    // bot16[0] = 巴西(巴西-日本胜) vs 墨西哥-厄瓜多尔胜者(未打)
    expect(b.bot16[0]).toMatchObject({ home: 'Brazil', status: 'half' });
  });

  it('未产生的轮次 = tbd(待定 vs 待定)', () => {
    expect(b.top8[0]).toMatchObject({ status: 'tbd' });
    expect(b.final[0]).toMatchObject({ status: 'tbd', tag: '决赛' });
    expect(b.third[0]).toMatchObject({ status: 'tbd', tag: '季军赛' });
  });

  it('DB 主客与槽位反序时比分仍对齐', () => {
    // 故意把 DB 行写成 Canada-South Africa(反序),槽位是 South Africa-Canada
    const flipped = assembleBracket([row('Canada', 'South Africa', 1, 0, 'finished')]);
    // 槽位 home=South Africa away=Canada → 比分应对齐为 0:1,Canada 晋级
    expect(flipped.topR32[1]).toMatchObject({ home: 'South Africa', away: 'Canada', homeScore: 0, awayScore: 1 });
    expect(flipped.top16[1]).toMatchObject({ home: 'Canada' });
  });

  it('结构槽位数固定(双向树)', () => {
    expect([b.top16.length, b.top8.length, b.topSF.length, b.final.length, b.third.length]).toEqual([4, 2, 1, 1, 1]);
    expect([b.botR32.length, b.bot16.length, b.bot8.length, b.botSF.length]).toEqual([8, 4, 2, 1]);
  });
});
