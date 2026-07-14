import { describe, expect, it } from 'vitest';
import { parseOpenFootballFixtures } from '@/lib/api-football/openfootball';

describe('parseOpenFootballFixtures', () => {
  it('normalizes openfootball tournament JSON into Fixture rows', () => {
    const fixtures = parseOpenFootballFixtures({
      name: 'Global Tournament 2026',
      matches: [
        {
          round: 'Matchday 1',
          date: '2026-06-11',
          time: '13:00 UTC-6',
          team1: 'Mexico',
          team2: 'South Africa',
          group: 'Group A',
          ground: 'Mexico City',
        },
      ],
    });

    expect(fixtures).toEqual([
      expect.objectContaining({
        externalId: 'openfootball:2026-06-11:mexico:south-africa:1',
        apiFixtureId: -1,
        league: { id: 2026000, name: 'Global Tournament 2026', season: 2026, round: 'Matchday 1' },
        kickoffAt: '2026-06-11T19:00:00.000Z',
        status: 'scheduled',
        statusRaw: 'NS',
        venue: { name: 'Mexico City', city: 'Mexico City' },
        home: expect.objectContaining({ name: 'Mexico', score: null }),
        away: expect.objectContaining({ name: 'South Africa', score: null }),
      }),
    ]);
  });

  it('marks scored matches as finished and preserves scores', () => {
    const fixtures = parseOpenFootballFixtures({
      name: 'Global Tournament 2026',
      matches: [
        {
          date: '2026-07-19',
          team1: 'W101',
          team2: 'W102',
          score1: 2,
          score2: 1,
        },
      ],
    });

    expect(fixtures[0]).toMatchObject({
      status: 'finished',
      statusRaw: 'FT',
      home: { name: 'W101', score: 2 },
      away: { name: 'W102', score: 1 },
    });
  });

  it('sorts fixtures by normalized kickoff time', () => {
    const fixtures = parseOpenFootballFixtures({
      name: 'Global Tournament 2026',
      matches: [
        { date: '2026-06-12', time: '20:00 UTC-4', team1: 'B', team2: 'C' },
        { date: '2026-06-11', time: '13:00 UTC-6', team1: 'A', team2: 'D' },
      ],
    });

    expect(fixtures.map((fixture) => fixture.home.name)).toEqual(['A', 'B']);
  });

  it('allows caller-provided league metadata for dry-run imports', () => {
    const fixtures = parseOpenFootballFixtures({
      name: 'Custom Feed',
      matches: [{ date: '2026-06-11', team1: 'A', team2: 'B' }],
    }, {
      leagueId: 99,
      leagueName: 'Dry Run Feed',
      season: 2030,
    });

    expect(fixtures[0]?.league).toEqual({
      id: 99,
      name: 'Dry Run Feed',
      season: 2030,
      round: 'OpenFootball',
    });
  });

  it('throws a parse error for malformed openfootball JSON', () => {
    expect(() => parseOpenFootballFixtures({ name: 'Global Tournament 2026', matches: [{ date: '2026/06/11' }] }))
      .toThrow('[openfootball] zod parse failed');
  });
});
