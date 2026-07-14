import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFootballGetMock = vi.fn();
const trackMock = vi.fn();

vi.mock('@/lib/api-football/client', () => ({
  apiFootballGet: apiFootballGetMock,
}));

vi.mock('@/lib/api/tracker', () => ({
  trackServerEventGlobal: trackMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  apiFootballGetMock.mockReset();
  trackMock.mockReset();
});

describe('getFixturesByDate', () => {
  it('parses a complete fixture sample', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ id: 215662 })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures[0]).toMatchObject({
      externalId: 'apifoot:215662',
      apiFixtureId: 215662,
      league: { id: 1, name: 'Global Finals', season: 2026, round: 'Group Stage - 1' },
      kickoffAt: '2026-06-11T20:00:00.000Z',
      status: 'scheduled',
      statusRaw: 'NS',
      venue: { name: 'Lusail Stadium', city: 'Lusail' },
      home: { teamId: 6, name: 'Qatar', score: null },
      away: { teamId: 14, name: 'Ecuador', score: null },
    });
  });

  it('accepts missing optional fields from api-sports', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ fixturePatch: { venue: undefined } })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    await expect(getFixturesByDate('2026-06-11')).resolves.toHaveLength(1);
  });

  it('throws a zod parse error when a required field is missing', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ homePatch: { name: undefined } })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    await expect(getFixturesByDate('2026-06-11')).rejects.toThrow('[api-football/fixtures] zod parse failed');
  });

  it('normalizes scheduled, live, finished, postponed, and cancelled status groups', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([
      fixtureRow({ id: 1, status: 'NS' }),
      fixtureRow({ id: 2, status: 'LIVE' }),
      fixtureRow({ id: 3, status: 'FT' }),
      fixtureRow({ id: 4, status: 'PST' }),
      fixtureRow({ id: 5, status: 'CANC' }),
    ]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures.map((fixture) => fixture.status)).toEqual([
      'scheduled',
      'live',
      'finished',
      'postponed',
      'cancelled',
    ]);
  });

  it('warns and falls back to scheduled for unknown status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ status: 'WEIRD' })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures[0]?.status).toBe('scheduled');
    expect(warn).toHaveBeenCalledWith('[api-football/fixtures] unknown fixture status:', 'WEIRD');
  });

  it('preserves null goals instead of converting them to zero', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ goals: { home: null, away: null } })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures[0]?.home.score).toBeNull();
    expect(fixtures[0]?.away.score).toBeNull();
  });

  it('normalizes missing venue to null', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ fixturePatch: { venue: null } })]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures[0]?.venue).toBeNull();
  });

  it('sorts fixtures by kickoff time ascending', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([
      fixtureRow({ id: 2, date: '2026-06-11T22:00:00+00:00' }),
      fixtureRow({ id: 1, date: '2026-06-11T18:00:00+00:00' }),
    ]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    const fixtures = await getFixturesByDate('2026-06-11');
    expect(fixtures.map((fixture) => fixture.externalId)).toEqual(['apifoot:1', 'apifoot:2']);
  });

  it('passes date, league, season, and timezone to the client', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([]));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    await getFixturesByDate('2026-06-11', {
      league: 1,
      season: 2026,
      timezone: 'Asia/Shanghai',
      client: { apiKey: 'test-key' },
    });
    expect(apiFootballGetMock).toHaveBeenCalledWith(
      '/fixtures',
      { date: '2026-06-11', league: 1, season: 2026, timezone: 'Asia/Shanghai' },
      { apiKey: 'test-key' },
    );
  });

  it('emits E070 after a successful API call', async () => {
    apiFootballGetMock.mockResolvedValueOnce(apiResult([fixtureRow({ id: 1 })], 1, 447));
    const { getFixturesByDate } = await import('@/lib/api-football/fixtures');
    await getFixturesByDate('2026-06-11');
    expect(trackMock).toHaveBeenCalledWith({
      eventId: 'E070',
      properties: expect.objectContaining({
        path: '/fixtures',
        results: 1,
        rate_limit_remaining: 447,
        latency_ms: expect.any(Number),
      }),
    });
  });
});

function apiResult(response: unknown, results = Array.isArray(response) ? response.length : 0, remaining: number | null = null) {
  return { response, results, rateLimitMinuteRemaining: remaining, requestId: null, raw: { response } };
}

interface FixtureRowOptions {
  id?: number;
  status?: string;
  date?: string;
  goals?: { home: number | null; away: number | null };
  fixturePatch?: Record<string, unknown>;
  homePatch?: Record<string, unknown>;
}

function fixtureRow(opts: FixtureRowOptions = {}) {
  return {
    fixture: {
      id: opts.id ?? 215662,
      date: opts.date ?? '2026-06-11T20:00:00+00:00',
      venue: { id: 1, name: 'Lusail Stadium', city: 'Lusail' },
      status: { long: 'Not Started', short: opts.status ?? 'NS', elapsed: null },
      ...(opts.fixturePatch ?? {}),
    },
    league: {
      id: 1,
      name: 'Global Finals',
      season: 2026,
      round: 'Group Stage - 1',
    },
    teams: {
      home: { id: 6, name: 'Qatar', ...(opts.homePatch ?? {}) },
      away: { id: 14, name: 'Ecuador' },
    },
    goals: opts.goals ?? { home: null, away: null },
  };
}
