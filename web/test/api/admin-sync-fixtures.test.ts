import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { json, req } from './_utils';

const fixture = {
  externalId: 'apifoot:1',
  apiFixtureId: 1,
  league: { id: 1, name: 'Global Finals', season: 2026, round: 'Group Stage - 1' },
  kickoffAt: '2026-06-11T20:00:00.000Z',
  status: 'scheduled',
  statusRaw: 'NS',
  venue: null,
  home: { teamId: 6, name: 'Qatar', score: null },
  away: { teamId: 14, name: 'Ecuador', score: null },
};

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'secret';
  __resetQuotaMemoryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
  __resetQuotaMemoryForTests();
});

describe('/api/admin/sync-fixtures', () => {
  it('syncs fetched fixtures on the happy path', async () => {
    const { POST, getFixtures, syncFixtures } = await loadAdminRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: 447 });
    syncFixtures.mockResolvedValueOnce({ inserted: 1, updated: 0, errors: [] });
    const res = await POST(adminReq({ date: '2026-06-11', league: 1, season: 2026 }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      date: '2026-06-11',
      fetched: 1,
      inserted: 1,
      updated: 0,
      errors: [],
      rateLimitMinuteRemaining: 447,
    });
  });

  it('rejects requests without admin token', async () => {
    const { POST } = await loadAdminRoute();
    const res = await POST(req('/api/admin/sync-fixtures', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-06-11' }),
    }));
    expect(res.status).toBe(401);
  });

  it('rejects invalid bodies before syncing', async () => {
    const { POST, getFixtures } = await loadAdminRoute();
    const res = await POST(adminReq({ league: 1 }));
    expect(res.status).toBe(400);
    expect(getFixtures).not.toHaveBeenCalled();
  });

  it('maps ApiFootballAuthError to a 503 response', async () => {
    const { POST, getFixtures, ApiFootballAuthError } = await loadAdminRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    const res = await POST(adminReq({ date: '2026-06-11' }));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_auth' });
  });

  it('maps ApiFootballRateLimitError to a 503 response with retryAfterSec', async () => {
    const { POST, getFixtures, ApiFootballRateLimitError } = await loadAdminRoute();
    getFixtures.mockRejectedValueOnce(new ApiFootballRateLimitError('limited', 30));
    const res = await POST(adminReq({ date: '2026-06-11' }));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_rate_limit', retryAfterSec: 30 });
  });

  it('lets withAdmin convert sync failures into generic 500 responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { POST, getFixtures, syncFixtures } = await loadAdminRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(adminReq({ date: '2026-06-11' }));
    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('emits E071 when sync starts and E072 when it finishes', async () => {
    const { POST, getFixtures, syncFixtures, track } = await loadAdminRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    await POST(adminReq({ date: '2026-06-11' }));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E071' }));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ fetched: 1, inserted: 0, updated: 1, errors_count: 0 }),
    }));
  });

  it('emits E071 and E072 with trigger=admin to mirror cron route', async () => {
    const { POST, getFixtures, syncFixtures, track } = await loadAdminRoute();
    getFixtures.mockResolvedValueOnce({ fixtures: [fixture], rateLimitMinuteRemaining: null });
    syncFixtures.mockResolvedValueOnce({ inserted: 0, updated: 1, errors: [] });
    await POST(adminReq({ date: '2026-06-11' }));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E071',
      properties: expect.objectContaining({ trigger: 'admin' }),
    }));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E072',
      properties: expect.objectContaining({ trigger: 'admin' }),
    }));
  });
});

function adminReq(body: unknown) {
  return req('/api/admin/sync-fixtures', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(body),
  });
}

async function loadAdminRoute() {
  vi.resetModules();
  const getFixtures = vi.fn();
  const syncFixtures = vi.fn();
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
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEventGlobal: track,
  }));
  const route = await import('@/app/api/admin/sync-fixtures/route');
  const client = await import('@/lib/api-football/client');
  return {
    POST: route.POST,
    getFixtures,
    syncFixtures,
    track,
    ApiFootballAuthError: client.ApiFootballAuthError,
    ApiFootballRateLimitError: client.ApiFootballRateLimitError,
  };
}
