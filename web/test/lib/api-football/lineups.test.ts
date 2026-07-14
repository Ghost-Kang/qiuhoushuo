import { describe, expect, it } from 'vitest';
import { externalIdToFixtureId, fetchFixtureLineups, parseLineupsResponse, pickFormations } from '@/lib/api-football/lineups';

const rawEntry = (id: number, name: string, formation: string | null) => ({
  team: { id, name },
  formation,
});

describe('parseLineupsResponse', () => {
  it('parses both team entries with formations', () => {
    const teams = parseLineupsResponse([rawEntry(6, 'Brazil', '4-3-3'), rawEntry(9, 'Spain', '4-2-3-1')]);
    expect(teams).toEqual([
      { teamId: 6, teamName: 'Brazil', formation: '4-3-3' },
      { teamId: 9, teamName: 'Spain', formation: '4-2-3-1' },
    ]);
  });

  it('normalizes missing/blank formations to null and tolerates malformed entries', () => {
    const teams = parseLineupsResponse([rawEntry(6, 'Brazil', '  '), { team: {} }, null]);
    expect(teams[0]!.formation).toBeNull();
    expect(teams[1]).toEqual({ teamId: null, teamName: '', formation: null });
    expect(teams[2]).toEqual({ teamId: null, teamName: '', formation: null });
  });

  it('returns [] for non-array payloads', () => {
    expect(parseLineupsResponse(null)).toEqual([]);
    expect(parseLineupsResponse({})).toEqual([]);
  });
});

describe('pickFormations', () => {
  const brazil = { teamId: 6, teamName: 'Brazil', formation: '4-3-3' };
  const spain = { teamId: 9, teamName: 'Spain', formation: '4-2-3-1' };

  it('aligns home/away by known homeTeamId even when response order is reversed', () => {
    expect(pickFormations([spain, brazil], 6)).toEqual({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
  });

  it('falls back to response order when homeTeamId is unknown or unmatched', () => {
    expect(pickFormations([brazil, spain])).toEqual({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
    expect(pickFormations([brazil, spain], 999)).toEqual({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
  });

  it('returns null when either side lacks a formation or fewer than 2 teams', () => {
    expect(pickFormations([brazil, { ...spain, formation: null }])).toBeNull();
    expect(pickFormations([brazil])).toBeNull();
    expect(pickFormations([])).toBeNull();
  });
});

describe('externalIdToFixtureId', () => {
  it('strips the sync-written apifoot: prefix to a bare integer (6/11 生产 smoke 实测上游只收整数)', () => {
    expect(externalIdToFixtureId('apifoot:215662')).toBe(215662);
    expect(externalIdToFixtureId('215662')).toBe(215662);
    expect(externalIdToFixtureId(' apifoot:7 ')).toBe(7);
  });

  it('returns null for unparseable ids instead of hitting upstream', () => {
    expect(externalIdToFixtureId('')).toBeNull();
    expect(externalIdToFixtureId('apifoot:')).toBeNull();
    expect(externalIdToFixtureId('openfootball:xyz')).toBeNull();
    expect(externalIdToFixtureId('apifoot:12a')).toBeNull();
  });
});

describe('fetchFixtureLineups', () => {
  it('calls /fixtures/lineups with the fixture id and parses the envelope', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        get: 'fixtures/lineups',
        errors: {},
        results: 2,
        response: [rawEntry(6, 'Brazil', '4-3-3'), rawEntry(9, 'Spain', '4-2-3-1')],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const teams = await fetchFixtureLineups(12345, { apiKey: 'test-key', fetchImpl });
    expect(calls[0]).toContain('/fixtures/lineups?fixture=12345');
    expect(teams).toHaveLength(2);
    expect(teams[0]!.formation).toBe('4-3-3');
  });
});
