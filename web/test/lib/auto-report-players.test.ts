/** 球员评分富集:终场后拉 /fixtures/players 落 matches.stats.players(全场最佳 + 评分卡数据源)。 */
import { describe, expect, it, vi } from 'vitest';
import { enrichMatchWithPlayers, type MatchRow } from '@/lib/api/auto-report';
import type { MatchPlayerStats } from '@/lib/api-football/player-stats';

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'm-p',
    external_id: 'apifoot:1',
    competition: '国际大赛',
    home_team: 'Argentina',
    away_team: 'France',
    home_score: 2,
    away_score: 1,
    match_date: '2026-06-20T19:00:00Z',
    status: 'finished',
    stats: { apiFootball: { homeTeamId: 10, awayTeamId: 20 }, possession: { home: 55, away: 45 } },
    events: [],
    ...over,
  };
}

const fixtureIdOf = (ext: string) => (ext === 'apifoot:1' ? 1 : null);
const players: MatchPlayerStats = {
  motm: { name: 'L. Messi', team: 'Argentina', rating: 9.6, position: '前锋' },
  home: [{ name: 'L. Messi', rating: 9.6, minutes: 90, position: '前锋', goals: 2, assists: 1 }],
  away: [{ name: 'K. Mbappé', rating: 8.9, minutes: 90, position: '前锋', goals: 1, assists: 0 }],
};

function dbStub(updates: Array<{ stats: unknown; id: string }>) {
  return {
    from: () => ({
      update: (values: { stats: unknown }) => ({
        eq: async (_c: string, id: string) => { updates.push({ stats: values.stats, id }); return { error: null }; },
      }),
    }),
  } as never;
}

describe('enrichMatchWithPlayers', () => {
  it('拉球员评分落 stats.players,合并保留技术统计与 apiFootball,透传 team id', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    const seen: Array<[number, number | null | undefined, number | null | undefined]> = [];
    const out = await enrichMatchWithPlayers(
      dbStub(updates), row(),
      async (fid, hId, aId) => { seen.push([fid, hId, aId]); return players; },
      fixtureIdOf, 'apifoot:1',
    );
    expect(seen).toEqual([[1, 10, 20]]);
    expect(out.stats).toEqual({ apiFootball: { homeTeamId: 10, awayTeamId: 20 }, possession: { home: 55, away: 45 }, players });
    expect(updates).toHaveLength(1);
  });

  it('已有 players → 幂等跳过;force 时强制重拉', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    const withPlayers = row({ stats: { players: { motm: null, home: [], away: [] }, apiFootball: { homeTeamId: 10, awayTeamId: 20 } } });
    expect(await enrichMatchWithPlayers(dbStub(updates), withPlayers, async () => players, fixtureIdOf, 'apifoot:1')).toBe(withPlayers);
    expect(updates).toHaveLength(0);
    const forced = await enrichMatchWithPlayers(dbStub(updates), withPlayers, async () => players, fixtureIdOf, 'apifoot:1', true);
    expect((forced.stats as { players: unknown }).players).toEqual(players);
  });

  it('无 fixture / 空数据 / 抛错 → 原样返回不落库', async () => {
    const updates: Array<{ stats: unknown; id: string }> = [];
    expect(await enrichMatchWithPlayers(dbStub(updates), row(), async () => players, fixtureIdOf, 'openfootball:x')).toMatchObject({ id: 'm-p' });
    const empty = await enrichMatchWithPlayers(dbStub(updates), row(), async () => ({ motm: null, home: [], away: [] }), fixtureIdOf, 'apifoot:1');
    expect((empty.stats as { players?: unknown }).players).toBeUndefined();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = row();
    expect(await enrichMatchWithPlayers(dbStub([]), original, async () => { throw new Error('quota'); }, fixtureIdOf, 'apifoot:1')).toBe(original);
    expect(warn).toHaveBeenCalled();
  });
});
