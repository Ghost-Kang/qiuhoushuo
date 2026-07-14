/**
 * 一图看懂「数据证据」真实数据源:终场后拉技术统计落 matches.stats。
 * 关键不变量:① 幂等(已有真实统计跳过)② 合并不覆盖 stats.apiFootball(队徽/阵型依赖)③ 失败不拖垮主链路。
 */
import { describe, expect, it, vi } from 'vitest';
import { enrichMatchWithStats, type MatchRow } from '@/lib/api/auto-report';

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-s',
    external_id: 'apifoot:1489369',
    competition: '国际大赛',
    home_team: 'Turkey',
    away_team: 'USA',
    home_score: 3,
    away_score: 2,
    match_date: '2026-06-24T19:00:00Z',
    status: 'finished',
    stats: { apiFootball: { homeTeamId: 10, awayTeamId: 20 } }, // sync 落的队 id,enrich 必须保留
    events: [],
    ...over,
  };
}

const fixtureIdOf = (ext: string) => (ext === 'apifoot:1489369' ? 1489369 : null);
const fetched = { possession: { home: 45, away: 55 }, shots: { home: 12, away: 9 } };

function dbStub(updates: Array<{ stats: unknown; id: string }>) {
  return {
    from: () => ({
      update: (values: { stats: unknown }) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ stats: values.stats, id });
          return { error: null };
        },
      }),
    }),
  } as never;
}

describe('enrichMatchWithStats', () => {
  it('拉统计落库,合并保留 apiFootball,按 team id 取主客', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    const seen: Array<[number, number | null | undefined, number | null | undefined]> = [];
    const out = await enrichMatchWithStats(
      dbStub(updates),
      row(),
      async (fixtureId, homeId, awayId) => { seen.push([fixtureId, homeId, awayId]); return fetched; },
      fixtureIdOf,
      'apifoot:1489369',
    );
    expect(seen).toEqual([[1489369, 10, 20]]); // 把 sync 落的 team id 透传给抓取
    expect(out.stats).toEqual({ apiFootball: { homeTeamId: 10, awayTeamId: 20 }, ...fetched });
    expect(updates).toEqual([{ stats: { apiFootball: { homeTeamId: 10, awayTeamId: 20 }, ...fetched }, id: 'match-s' }]);
  });

  it('已有真实统计 → 幂等跳过(不重复抓取/落库)', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    const withStats = row({ stats: { possession: { home: 50, away: 50 }, apiFootball: { homeTeamId: 10, awayTeamId: 20 } } });
    const out = await enrichMatchWithStats(dbStub(updates), withStats, async () => fetched, fixtureIdOf, 'apifoot:1489369');
    expect(out).toBe(withStats);
    expect(updates).toEqual([]);
  });

  it('external_id 解析不到 fixture / 抓取空 → 原样返回不落库', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    expect((await enrichMatchWithStats(dbStub(updates), row(), async () => fetched, fixtureIdOf, 'openfootball:x')).stats)
      .toEqual({ apiFootball: { homeTeamId: 10, awayTeamId: 20 } });
    const empty = await enrichMatchWithStats(dbStub(updates), row(), async () => ({}), fixtureIdOf, 'apifoot:1489369');
    expect(empty.stats).toEqual({ apiFootball: { homeTeamId: 10, awayTeamId: 20 } });
    expect(updates).toEqual([]);
  });

  it('抓取抛错 → 返回原行,不抛(主链路不受影响)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = row();
    const out = await enrichMatchWithStats(dbStub([]), original, async () => { throw new Error('quota'); }, fixtureIdOf, 'apifoot:1489369');
    expect(out).toBe(original);
    expect(warn).toHaveBeenCalled();
  });
});
