/**
 * 点球大战三件套(2026-07-04 澳埃战事故回归):
 * ① isPenShootoutPending:PEN 完赛但逐轮点球未落库 → 战报生成门拦截(留窗口等下轮 cron);
 * ② penShootoutScore:互射比分按"战平场次 minute>120 的 penalty"计(对阵图 penScore 同口径);
 * ③ matchRowToMatchData:点球比分/晋级方显式喂 LLM——只给 1:1 让模型猜,hardcore 标题
 *    写成「澳大利亚点球晋级」(实际埃及 4:2),错误内容直通小程序/公众号草稿/社媒文案。
 */
import { describe, expect, it } from 'vitest';
import {
  hasPenShootoutEvents,
  isPenShootoutPending,
  matchRowToMatchData,
  penShootoutScore,
  type MatchRow,
} from '@/lib/api/auto-report';

function penRow(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-pen',
    external_id: 'apifoot:1565178',
    competition: '国际大赛 - Round of 32',
    home_team: 'Australia',
    away_team: 'Egypt',
    home_score: 1,
    away_score: 1,
    match_date: '2026-07-03T18:00:00Z',
    status: 'finished',
    stats: { statusRaw: 'PEN' },
    events: [
      { minute: 13, type: 'goal', team: 'Egypt', player: 'E. Ashour', assist: 'K. Hafez' },
      { minute: 55, type: 'goal', team: 'Australia', player: 'M. Hany', description: '乌龙球' },
    ],
    ...over,
  };
}

const SHOOTOUT_EVENTS = [
  { minute: 121, type: 'penalty_missed', team: 'Australia', player: 'A' },
  { minute: 121, type: 'penalty', team: 'Egypt', player: 'B' },
  { minute: 122, type: 'penalty', team: 'Australia', player: 'C' },
  { minute: 122, type: 'penalty', team: 'Egypt', player: 'D' },
  { minute: 123, type: 'penalty', team: 'Australia', player: 'E' },
  { minute: 123, type: 'penalty', team: 'Egypt', player: 'F' },
  { minute: 124, type: 'penalty_missed', team: 'Australia', player: 'G' },
  { minute: 124, type: 'penalty', team: 'Egypt', player: 'H' },
];

describe('isPenShootoutPending(战报生成门)', () => {
  it('PEN 完赛 + 逐轮点球未落库 → 拦截', () => {
    expect(isPenShootoutPending(penRow())).toBe(true);
  });

  it('逐轮点球已落库 → 放行', () => {
    const m = penRow({ events: [...(penRow().events as unknown[]), ...SHOOTOUT_EVENTS] });
    expect(isPenShootoutPending(m)).toBe(false);
  });

  it('非 PEN 完赛(常规胜负/小组赛平局)→ 不拦', () => {
    expect(isPenShootoutPending(penRow({ stats: { statusRaw: 'FT' } }))).toBe(false);
    expect(isPenShootoutPending(penRow({ stats: {} }))).toBe(false);
  });

  it('运动战点球(minute≤120)不算点球大战逐轮', () => {
    const m = penRow({
      stats: { statusRaw: 'PEN' },
      events: [{ minute: 68, type: 'penalty', team: 'Egypt', player: 'X' }],
    });
    expect(hasPenShootoutEvents(m.events)).toBe(false);
    expect(isPenShootoutPending(m)).toBe(true);
  });
});

describe('penShootoutScore', () => {
  it('战平场次按 minute>120 的 penalty 计主客互射比分(射失不计)', () => {
    const m = penRow({ events: [...(penRow().events as unknown[]), ...SHOOTOUT_EVENTS] });
    expect(penShootoutScore(m)).toEqual({ home: 2, away: 4 });
  });

  it('非战平场次不计(运动战点球不掺入)', () => {
    const m = penRow({ home_score: 2, away_score: 1, events: SHOOTOUT_EVENTS });
    expect(penShootoutScore(m)).toBeNull();
  });

  it('战平但无逐轮事件 → null(区别于 0:0 互射)', () => {
    expect(penShootoutScore(penRow())).toBeNull();
  });
});

describe('matchRowToMatchData 点球比分显式喂 LLM', () => {
  it('有互射比分:match/final_score 都带「点球大战 X:Y,谁晋级」', () => {
    const m = penRow({ events: [...(penRow().events as unknown[]), ...SHOOTOUT_EVENTS] });
    const data = matchRowToMatchData(m);
    expect(data.match).toBe('澳大利亚 1:1 埃及（点球大战 2:4，埃及晋级）');
    expect(data.final_score).toBe('1-1（点球大战 2:4，埃及晋级）');
  });

  it('常规胜负:不加点球注记', () => {
    const data = matchRowToMatchData(penRow({ home_score: 2, away_score: 1, stats: {} }));
    expect(data.match).toBe('澳大利亚 2:1 埃及');
    expect(data.final_score).toBe('2-1');
  });
});
