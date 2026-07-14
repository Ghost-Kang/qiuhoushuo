import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_API_SECRET;
});

describe('/api/cron/api-football-quota', () => {
  it('returns 503 when ADMIN_API_SECRET is missing', async () => {
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/api-football-quota'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('ADMIN_API_SECRET 未配置');
  });

  it('rejects requests without authorization header', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/api-football-quota'));
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong bearer token', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET } = await loadCronRoute();
    const res = await GET(req('/api/cron/api-football-quota', {
      headers: { authorization: 'Bearer wrong' },
    }));
    expect(res.status).toBe(401);
  });

  it('returns a healthy quota snapshot with alerted=false', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota } = await loadCronRoute();
    checkQuota.mockResolvedValueOnce(snapshot('healthy'));
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ used: 100, limit: 7500, percent: 1.3, severity: 'healthy', alerted: false });
  });

  it('returns alerted=true when quota severity is P1', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota } = await loadCronRoute();
    checkQuota.mockResolvedValueOnce(snapshot('P1'));
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ severity: 'P1', alerted: true });
  });

  it('maps ApiFootballAuthError to 503 and sends a P0 alert', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, notify, ApiFootballAuthError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    const res = await GET(cronReq());
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_auth' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P0', tags: ['cron-failure', 'api_football_auth'] }),
      expect.objectContaining({ dedupKey: 'cron-quota:P0:api_football_auth', dedupWindowMs: 300000 }),
    );
  });

  it('maps ApiFootballRateLimitError to 503 and sends a P1 alert', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, notify, ApiFootballRateLimitError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballRateLimitError('limited', 30));
    const res = await GET(cronReq());
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'api_football_rate_limit', retryAfterSec: 30 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P1', tags: ['cron-failure', 'api_football_rate_limit'] }),
      expect.objectContaining({ dedupKey: 'cron-quota:P1:api_football_rate_limit', dedupWindowMs: 300000 }),
    );
  });

  it('maps ApiFootballTimeoutError to 504 and sends a P1 alert', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, notify, ApiFootballTimeoutError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballTimeoutError('timeout'));
    const res = await GET(cronReq());
    expect(res.status).toBe(504);
    expect(await json(res)).toEqual({ error: 'api_football_timeout' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P1', tags: ['cron-failure', 'api_football_timeout'] }),
      expect.objectContaining({ dedupKey: 'cron-quota:P1:api_football_timeout', dedupWindowMs: 300000 }),
    );
  });

  it('maps unknown errors to 500 and sends a P0 alert', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, notify } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new Error('crashed'));
    const res = await GET(cronReq());
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'api_football_quota_failed' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'P0', tags: ['cron-failure', 'unknown'] }),
      expect.objectContaining({ dedupKey: 'cron-quota:P0:unknown', dedupWindowMs: 300000 }),
    );
  });

  it('emits E074 with error_type=api_football_auth on auth error', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, track, ApiFootballAuthError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    await GET(cronReq());
    expect(track).toHaveBeenCalledWith({
      eventId: 'E074',
      properties: {
        severity: 'P0',
        error_type: 'api_football_auth',
        used: null,
        limit: null,
        percent: null,
      },
    });
  });

  it('emits E074 with error_type=api_football_rate_limit on rate-limit', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, track, ApiFootballRateLimitError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballRateLimitError('limited', 30));
    await GET(cronReq());
    expect(track).toHaveBeenCalledWith({
      eventId: 'E074',
      properties: {
        severity: 'P1',
        error_type: 'api_football_rate_limit',
        used: null,
        limit: null,
        percent: null,
      },
    });
  });

  it('emits E074 with error_type=api_football_timeout on timeout', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, track, ApiFootballTimeoutError } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new ApiFootballTimeoutError('timeout'));
    await GET(cronReq());
    expect(track).toHaveBeenCalledWith({
      eventId: 'E074',
      properties: {
        severity: 'P1',
        error_type: 'api_football_timeout',
        used: null,
        limit: null,
        percent: null,
      },
    });
  });

  it('emits E074 with error_type=unknown on unknown crash', async () => {
    process.env.ADMIN_API_SECRET = 'cron-secret';
    const { GET, checkQuota, track } = await loadCronRoute();
    checkQuota.mockRejectedValueOnce(new Error('crashed'));
    await GET(cronReq());
    expect(track).toHaveBeenCalledWith({
      eventId: 'E074',
      properties: {
        severity: 'P0',
        error_type: 'unknown',
        used: null,
        limit: null,
        percent: null,
      },
    });
  });
});

function cronReq() {
  return req('/api/cron/api-football-quota', {
    headers: { authorization: 'Bearer cron-secret' },
  });
}

async function loadCronRoute() {
  vi.resetModules();
  const checkQuota = vi.fn();
  const notify = vi.fn();
  const track = vi.fn();
  vi.doMock('@/lib/api-football/quota', () => ({
    checkApiFootballQuota: checkQuota,
  }));
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: notify,
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEventGlobal: track,
  }));
  const route = await import('@/app/api/cron/api-football-quota/route');
  const client = await import('@/lib/api-football/client');
  return {
    GET: route.GET,
    checkQuota,
    notify,
    track,
    ApiFootballAuthError: client.ApiFootballAuthError,
    ApiFootballRateLimitError: client.ApiFootballRateLimitError,
    ApiFootballTimeoutError: client.ApiFootballTimeoutError,
  };
}

function snapshot(severity: 'healthy' | 'P1' | 'P0') {
  return {
    used: 100,
    limit: 7500,
    percent: 1.3,
    severity,
    plan: 'Pro',
    planEnd: '2026-08-15T04:05:35+00:00',
    subscriptionActive: true,
  };
}
