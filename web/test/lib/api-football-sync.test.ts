import { describe, expect, it } from 'vitest';
import {
  stableFixtureShortCodeForTest,
  syncFixturesToDb,
  type SyncFixturesClient,
} from '@/lib/api-football/sync';
import { isValidShortCode, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@/lib/api/shortcode';
import type { Fixture } from '@/lib/api-football/fixtures';

describe('syncFixturesToDb', () => {
  it('counts all new fixtures as inserted', async () => {
    const db = fakeSyncClient([]);
    const result = await syncFixturesToDb(db, [fixture(1), fixture(2)]);
    expect(result).toMatchObject({ inserted: 2, updated: 0, errors: [] });
  });

  it('counts existing fixtures as updated', async () => {
    const db = fakeSyncClient(['apifoot:1', 'apifoot:2']);
    const result = await syncFixturesToDb(db, [fixture(1), fixture(2)]);
    expect(result).toMatchObject({ inserted: 0, updated: 2, errors: [] });
  });

  it('counts mixed inserted and updated fixtures', async () => {
    const db = fakeSyncClient(['apifoot:1']);
    const result = await syncFixturesToDb(db, [fixture(1), fixture(2)]);
    expect(result).toMatchObject({ inserted: 1, updated: 1, errors: [] });
  });

  it('collects one-row upsert failures and keeps syncing the batch', async () => {
    const db = fakeSyncClient(['apifoot:1'], ['apifoot:2']);
    const result = await syncFixturesToDb(db, [fixture(1), fixture(2), fixture(3)]);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([{ externalId: 'apifoot:2', error: 'boom apifoot:2' }]);
  });

  it('throws when every upsert fails', async () => {
    const db = fakeSyncClient([], ['apifoot:1']);
    await expect(syncFixturesToDb(db, [fixture(1)])).rejects.toThrow('[api-football/sync] all upserts failed');
  });

  it('returns zeros for an empty input without querying db', async () => {
    const db = fakeSyncClient([]);
    const result = await syncFixturesToDb(db, []);
    expect(result).toEqual({ inserted: 0, updated: 0, errors: [] });
  });

  it('generates stable short codes for the same external_id', () => {
    expect(stableFixtureShortCodeForTest('apifoot:215662')).toBe(stableFixtureShortCodeForTest('apifoot:215662'));
    expect(stableFixtureShortCodeForTest('apifoot:215662')).toHaveLength(7);
  });

  it('writes league round, venue, statusRaw, and team ids into stats jsonb', async () => {
    const db = fakeSyncClient([]);
    await syncFixturesToDb(db, [fixture(1)]);
    expect(db.rows[0]?.stats).toMatchObject({
      venue: { name: 'Lusail Stadium', city: 'Lusail' },
      statusRaw: 'NS',
      apiFootball: {
        fixtureId: 1,
        leagueId: 1,
        round: 'Group Stage - 1',
        homeTeamId: 6,
        awayTeamId: 14,
      },
    });
  });

  it('scoreBreakdown(半场/90分/加时/点球)落 stats;上游未给(null)时保留旧值不清空', async () => {
    const breakdown = { halftime: { home: 1, away: 0 }, fulltime: { home: 1, away: 1 }, extratime: { home: 2, away: 1 }, penalty: null };
    const db = fakeSyncClient([]);
    await syncFixturesToDb(db, [{ ...fixture(1), scoreBreakdown: breakdown }]);
    expect(db.rows[0]?.stats).toMatchObject({ scoreBreakdown: breakdown });

    // 上游 null(如赛前轮询)→ 不写 scoreBreakdown 键,已有值不被清掉
    const db2 = fakeSyncClient(['apifoot:1'], [], undefined, { 'apifoot:1': { scoreBreakdown: breakdown } });
    await syncFixturesToDb(db2, [fixture(1)]);
    expect(db2.rows[0]?.stats).toMatchObject({ scoreBreakdown: breakdown });
  });

  it('throws when the initial existing-row select fails', async () => {
    const db = fakeSyncClient([], [], 'permission denied');
    await expect(syncFixturesToDb(db, [fixture(1)])).rejects.toThrow('select failed: permission denied');
  });

  it('合并保留 enrich 加的技术统计,不被 sync 覆盖(用户报修:数据证据只剩比分)', async () => {
    const db = fakeSyncClient(['apifoot:1'], [], undefined, {
      'apifoot:1': { possession: { home: 55, away: 45 }, shots_on_target: { home: 4, away: 8 }, players: { motm: { name: 'Messi', team: 'A', rating: 9.6, position: '前锋' } }, apiFootball: { stale: true } },
    });
    await syncFixturesToDb(db, [fixture(1)]);
    // 技术统计 + 球员评分(players)保留;venue/statusRaw/apiFootball 由 sync 刷新(stale apiFootball 被覆盖)
    expect(db.rows[0]?.stats).toMatchObject({
      possession: { home: 55, away: 45 },
      shots_on_target: { home: 4, away: 8 },
      players: { motm: { name: 'Messi', rating: 9.6 } }, // sync 不冲掉球员评分
      venue: { name: 'Lusail Stadium', city: 'Lusail' },
      statusRaw: 'NS',
      apiFootball: { fixtureId: 1, homeTeamId: 6, awayTeamId: 14 },
    });
    expect((db.rows[0]?.stats as Record<string, unknown>).apiFootball).not.toHaveProperty('stale');
  });
});

describe('stableFixtureShortCode shares constants with lib/api/shortcode', () => {
  const samples = [
    'apifoot:215662',
    'apifoot:1',
    'apifoot:99999',
    'apifoot:edge-case-_!@',
    '',
  ];

  it('emits codes whose chars are all in the shared alphabet', () => {
    for (const externalId of samples) {
      const code = stableFixtureShortCodeForTest(externalId);
      for (const char of code) {
        expect(SHORT_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('emits codes of length SHORT_CODE_LENGTH', () => {
    for (const externalId of samples) {
      expect(stableFixtureShortCodeForTest(externalId)).toHaveLength(SHORT_CODE_LENGTH);
    }
  });

  it('output passes isValidShortCode cross-module contract', () => {
    for (const externalId of samples) {
      const code = stableFixtureShortCodeForTest(externalId);
      expect(isValidShortCode(code)).toBe(true);
    }
  });
});

type FakeSyncClient = SyncFixturesClient & { rows: Array<Record<string, unknown>> };

function fakeSyncClient(
  existingIds: string[],
  failingIds: string[] = [],
  selectError?: string,
  existingStatsByExtId: Record<string, unknown> = {},
): FakeSyncClient {
  const rows: Array<Record<string, unknown>> = [];
  const client: FakeSyncClient = {
    rows,
    from: () => ({
      select: () => ({
        in: async () => ({
          data: existingIds.map((externalId, index) => ({ id: `m-${index}`, external_id: externalId, stats: existingStatsByExtId[externalId] })),
          error: selectError ? { message: selectError } : null,
        }),
      }),
      upsert: async (upsertRows: Array<Record<string, unknown>>) => {
        const row = upsertRows[0]!;
        const externalId = String(row.external_id);
        if (failingIds.includes(externalId)) {
          return { data: null, error: { message: `boom ${externalId}` } };
        }
        rows.push(row);
        return { data: null, error: null };
      },
    }),
  };
  return client;
}

function fixture(id: number): Fixture {
  return {
    externalId: `apifoot:${id}`,
    apiFixtureId: id,
    league: { id: 1, name: 'Global Finals', season: 2026, round: 'Group Stage - 1' },
    kickoffAt: '2026-06-11T20:00:00.000Z',
    status: 'scheduled',
    statusRaw: 'NS',
    venue: { name: 'Lusail Stadium', city: 'Lusail' },
    home: { teamId: 6, name: 'Qatar', score: null },
    away: { teamId: 14, name: 'Ecuador', score: null },
    scoreBreakdown: null,
  };
}
