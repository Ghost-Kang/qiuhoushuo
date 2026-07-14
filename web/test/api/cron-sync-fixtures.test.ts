import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const fixture = {
  externalId: 'apifoot:1',
  apiFixtureId: 1,
  league: { id: 1, name: 'Global Finals', season: 2026, round: 'Final' },
  kickoffAt: '2026-07-19T20:00:00.000Z',
  status: 'scheduled',
  statusRaw: 'NS',
  venue: null,
  home: { teamId: 6, name: 'Qatar', score: null },
  away: { teamId: 14, name: 'Ecuador', score: null },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  delete process.env.ADMIN_API_SECRET;
});

describe('/api/cron/sync-fixtures', () => {
  it('returns 503 when ADMIN_API_SECRET is missing', async () => {
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/sync-fixtures'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('ADMIN_API_SECRET 未配置');
  });

  it('rejects requests without authorization header', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/sync-fixtures'));
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong bearer token', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/sync-fixtures', {
      headers: { authorization: 'Bearer wrong' },
    }));
    expect(res.status).toBe(401);
  });

  it('syncs today UTC by default and returns counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T08:30:00.000Z'));
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: 447 });
    syncFixtures.mockResolvedValueOnce({ inserted: 1, updated: 0, errors: [] });
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    // F58:无参时锁定目标赛事默认,不允许拉全球(6/12 生产实测灌入 162 场无关比赛)
    expect(getFixtures).toHaveBeenCalledWith('2026-07-19', { league: 1, season: 2026 });
    expect(await json(res)).toMatchObject({
      date: '2026-07-19',
      fetched: 1,
      inserted: 1,
      updated: 0,
      errors: [],
      rateLimitMinuteRemaining: 447,
    });
  });

  it('respects date query param', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(200);
    expect(getFixtures).toHaveBeenCalledWith('2026-06-11', { league: 1, season: 2026 });
  });

  it('env API_FOOTBALL_LEAGUE_ID / API_FOOTBALL_SEASON override the locked defaults', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    process.env.API_FOOTBALL_LEAGUE_ID = '39';
    process.env.API_FOOTBALL_SEASON = '2027';
    try {
      const { GET, getFixtures, syncFixtures } = await loadCronRoute();
      getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
      syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
      const res = await GET(cronReq('?date=2026-06-11'));
      expect(res.status).toBe(200);
      expect(getFixtures).toHaveBeenCalledWith('2026-06-11', { league: 39, season: 2027 });
    } finally {
      delete process.env.API_FOOTBALL_LEAGUE_ID;
      delete process.env.API_FOOTBALL_SEASON;
    }
  });

  it('passes league and season query params through', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    const res = await GET(cronReq('?date=2026-06-11&league=1&season=2026'));
    expect(res.status).toBe(200);
    expect(getFixtures).toHaveBeenCalledWith('2026-06-11', { league: 1, season: 2026 });
  });

  it('emits E071 with trigger=cron on start', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures, track } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    await GET(cronReq('?date=2026-06-11'));
    expect(track).toHaveBeenCalledWith({
      eventId: 'E071',
      properties: { date: '2026-06-11', league: 1, season: 2026, trigger: 'cron' },
    });
  });

  it('emits E072 with trigger=cron and counts on success', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures, track } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    await GET(cronReq('?date=2026-06-11'));
    expect(track).toHaveBeenCalledWith({
      eventId: 'E072',
      properties: {
        date: '2026-06-11',
        fetched: 1,
        inserted: 0,
        updated: 1,
        errors_count: 0,
        trigger: 'cron',
      },
    });
  });

  it('maps ApiFootballAuthError to 503 plus P0 alert and E072 error emit', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, notify, track, ApiFootballAuthError } = await loadCronRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_auth' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P0', tags: ['cron-failure', 'api_football_auth'] }),
      expect.objectContaining({ dedupKey: 'cron-sync:P0:api_football_auth', dedupWindowMs: 300000 }),
    );
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ error: 'api_football_auth', trigger: 'cron', errors_count: 1 }),
    }));
  });

  it('maps ApiFootballRateLimitError to 503 plus P1 alert and E072 error emit', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, notify, track, ApiFootballRateLimitError } = await loadCronRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballRateLimitError('limited', 30));
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_rate_limit', retryAfterSec: 30 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P1', tags: ['cron-failure', 'api_football_rate_limit'] }),
      expect.objectContaining({ dedupKey: 'cron-sync:P1:api_football_rate_limit', dedupWindowMs: 300000 }),
    );
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ error: 'api_football_rate_limit', trigger: 'cron', errors_count: 1 }),
    }));
  });

  it('maps ApiFootballTimeoutError to 504 plus P1 alert and E072 error emit', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, notify, track, ApiFootballTimeoutError } = await loadCronRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballTimeoutError('timeout'));
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(504);
    expect(await json(res)).toEqual({ error: 'api_football_timeout' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P1', tags: ['cron-failure', 'api_football_timeout'] }),
      expect.objectContaining({ dedupKey: 'cron-sync:P1:api_football_timeout', dedupWindowMs: 300000 }),
    );
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ error: 'api_football_timeout', trigger: 'cron', errors_count: 1 }),
    }));
  });

  it('maps unknown errors to 500 plus P0 alert and E072 error emit', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, notify, track } = await loadCronRoute();
    getFixtures.mockRejectedValueOnce(new Error('crashed'));
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'cron_sync_fixtures_failed' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P0', tags: ['cron-failure', 'unknown'] }),
      expect.objectContaining({ dedupKey: 'cron-sync:P0:unknown', dedupWindowMs: 300000 }),
    );
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ error: 'unknown', trigger: 'cron', errors_count: 1 }),
    }));
  });

  it('emits E072 with errors_count > 0 when sync fails partially', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, syncFixtures, track } = await loadCronRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({
      inserted: 0,
      updated: 0,
      errors: [{ externalId: 'apifoot:1', error: 'upsert failed' }],
    });
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(200);
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ errors_count: 1, trigger: 'cron' }),
    }));
  });

  it('does not emit E074 because quota poller owns that event', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, getFixtures, track, ApiFootballAuthError } = await loadCronRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    await GET(cronReq('?date=2026-06-11'));
    expect(track).not.toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E074' }));
  });

  it('returns 503 with DB_UNAVAILABLE when service db is null', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    vi.resetModules();
    const notify = vi.fn();
    const track = vi.fn();
    vi.doMock('@/lib/api/mode', () => ({
      getSupabaseService: () => null,
    }));
    vi.doMock('@/lib/alerts', () => ({
      notifyOpsFireAndForget: notify,
    }));
    vi.doMock('@/lib/api/tracker', () => ({
      trackServerEventGlobal: track,
    }));
    const { GET } = await import('@/app/api/cron/sync-fixtures/route');
    const res = await GET(cronReq('?date=2026-06-11'));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'DB_UNAVAILABLE' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P1', tags: ['cron-failure', 'db_unavailable'] }),
      expect.objectContaining({ dedupKey: 'cron-sync:P1:db_unavailable', dedupWindowMs: 300000 }),
    );
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({
        error: 'db_unavailable',
        trigger: 'cron',
        errors_count: 1,
      }),
    }));
  });
});

function cronReq(query = '') {
  return req(`/api/cron/sync-fixtures${query}`, {
    headers: { authorization: 'Bearer cron-secret' },
  });
}

async function loadCronRoute() {
  vi.resetModules();
  const getFixtures = vi.fn();
  const syncFixtures = vi.fn();
  const notify = vi.fn();
  const track = vi.fn();
  vi.doMock('@/lib/api/mode', () => ({
    getSupabaseService: () => ({ from: () => ({}) }),
  }));
  vi.doMock('@/lib/api-football/fixtures', () => ({
    getFixturesByDateWithMeta: getFixtures,
  }));
  vi.doMock('@/lib/api-football/sync', () => ({
    syncFixturesToDb: syncFixtures,
  }));
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: notify,
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEventGlobal: track,
  }));
  const route = await import('@/app/api/cron/sync-fixtures/route');
  const client = await import('@/lib/api-football/client');
  return {
    GET: route.GET,
    getFixtures,
    syncFixtures,
    notify,
    track,
    ApiFootballAuthError: client.ApiFootballAuthError,
    ApiFootballRateLimitError: client.ApiFootballRateLimitError,
    ApiFootballTimeoutError: client.ApiFootballTimeoutError,
  };
}
