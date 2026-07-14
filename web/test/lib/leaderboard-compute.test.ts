import { describe, expect, it } from 'vitest';
import { computeScoreLeaderboards } from '@/lib/api/leaderboard-data';

const goal = (team: string, player: string, assist?: string) => ({ type: 'goal', team, player, assist });
const pen = (team: string, player: string, minute?: number) => ({ type: 'penalty', team, player, minute }); // 运动战点球计;点球大战逐轮(战平场 minute>120)不计
const og = (team: string, player: string) => ({ type: 'goal', team, player, description: '乌龙球' }); // 乌龙:team=受益方,不计给任何人

describe('computeScoreLeaderboards(从 events 算射手榜/助攻榜)', () => {
  it('进球/助攻计数 + apps=分布场次 + 排序', () => {
    const rows = [
      { events: [goal('France', 'K. Mbappe', 'O. Dembele'), goal('France', 'B. Barcola', 'M. Olise'), goal('France', 'K. Mbappe')] }, // 场0:姆巴佩2、巴尔科拉1;德姆贝莱助攻1
      { events: [goal('France', 'K. Mbappe', 'O. Dembele')] }, // 场1:姆巴佩1;德姆贝莱助攻1
      { events: [goal('Brazil', 'Vinicius', 'Raphinha')] }, // 场2
    ];
    const { scorers, assists } = computeScoreLeaderboards(rows, 10);
    expect(scorers[0]).toMatchObject({ name: 'K. Mbappe', team: 'France', count: 3, apps: 2 }); // 3球分布2场
    expect(scorers.find((s) => s.name === 'B. Barcola')).toMatchObject({ count: 1, apps: 1 });
    expect(scorers.find((s) => s.name === 'Vinicius')).toMatchObject({ team: 'Brazil', count: 1 });
    // 助攻榜:德姆贝莱2(2场)
    expect(assists[0]).toMatchObject({ name: 'O. Dembele', team: 'France', count: 2, apps: 2 });
  });

  it('运动战点球计入;点球大战逐轮(战平场 minute>120)不计(2026-07-04 修:旧版一刀切漏算 C罗 68 分钟点球)', () => {
    const rows = [{
      home_score: 1, away_score: 1, // 战平 → 进点球大战
      events: [goal('Germany', 'K. Havertz'), pen('Germany', 'J. Kimmich', 68), pen('Germany', 'K. Havertz', 121), pen('Paraguay', 'Mauricio', 121)],
    }];
    const { scorers } = computeScoreLeaderboards(rows, 10);
    expect(scorers.find((s) => s.name === 'K. Havertz')).toMatchObject({ count: 1 }); // 正规进球 1,121' 点球大战不计
    expect(scorers.find((s) => s.name === 'J. Kimmich')).toMatchObject({ count: 1 }); // 68' 运动战点球计
    expect(scorers.find((s) => s.name === 'Mauricio')).toBeUndefined(); // 仅点球大战 → 不上榜
  });

  it('非战平场次的 minute>120 点球(加时补时运动战点球)照常计', () => {
    const rows = [{ home_score: 3, away_score: 2, events: [pen('Belgium', 'K. De Bruyne', 122)] }];
    const { scorers } = computeScoreLeaderboards(rows, 10);
    expect(scorers.find((s) => s.name === 'K. De Bruyne')).toMatchObject({ count: 1 });
  });

  it('乌龙球不计给任何人(事件 team=受益方·佛得角博尔赫斯案例)', () => {
    const rows = [{
      home_score: 3, away_score: 2,
      events: [goal('Argentina', 'L. Messi', 'L. Martinez'), og('Argentina', 'D. Borges')],
    }];
    const { scorers, assists } = computeScoreLeaderboards(rows, 10);
    expect(scorers.find((s) => s.name === 'L. Messi')).toMatchObject({ count: 1 });
    expect(scorers.find((s) => s.name === 'D. Borges')).toBeUndefined(); // 乌龙不算进球,更不能挂到受益队名下
    expect(assists.find((s) => s.name === 'L. Martinez')).toMatchObject({ count: 1 });
  });

  it('limit 截断 + 坏 events 不崩', () => {
    const rows = [
      { events: [goal('A', 'P1'), goal('A', 'P2'), goal('A', 'P3')] },
      { events: null },
      { events: 'bad' as never },
    ];
    const { scorers } = computeScoreLeaderboards(rows, 2);
    expect(scorers).toHaveLength(2);
  });

  it('无进球者/助攻为空时不计;空入 → 空榜', () => {
    expect(computeScoreLeaderboards([], 10)).toEqual({ scorers: [], assists: [] });
    const { scorers, assists } = computeScoreLeaderboards([{ events: [goal('A', 'P1')] }], 10);
    expect(scorers).toHaveLength(1);
    expect(assists).toHaveLength(0); // 无助攻
  });
});
