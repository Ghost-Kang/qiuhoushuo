import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFootballAuthError } from '@/lib/api-football/client';

const mocks = vi.hoisted(() => ({
  apiFootballGet: vi.fn(),
  notify: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/lib/api-football/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-football/client')>()),
  apiFootballGet: mocks.apiFootballGet,
}));

vi.mock('@/lib/alerts', () => ({
  notifyOpsFireAndForget: mocks.notify,
}));

vi.mock('@/lib/api/tracker', () => ({
  trackServerEventGlobal: mocks.track,
}));

afterEach(() => {
  vi.restoreAllMocks();
  mocks.apiFootballGet.mockReset();
  mocks.notify.mockReset();
  mocks.track.mockReset();
});

describe('checkApiFootballQuota', () => {
  it('returns healthy quota for zero usage', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(0, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await expect(checkApiFootballQuota()).resolves.toMatchObject({
      used: 0,
      limit: 7500,
      percent: 0,
      severity: 'healthy',
      policyName: 'normal',
    });
  });

  it('marks 80% usage as P1', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({ alertOnExceed: false });
    expect(snapshot).toMatchObject({ percent: 80, severity: 'P1' });
  });

  it('marks 95%+ usage as P0', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(7200, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({ alertOnExceed: false });
    expect(snapshot).toMatchObject({ percent: 96, severity: 'P0' });
  });

  it('marks 85% usage as P1 under the normal policy', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6375, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({
      alertOnExceed: false,
      now: new Date('2026-07-14T23:59:59Z'),
    });
    expect(snapshot).toMatchObject({ percent: 85, severity: 'P1', policyName: 'normal' });
  });

  it('marks 85% usage as P0 under the finals strict policy', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6375, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({
      alertOnExceed: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });
    expect(snapshot).toMatchObject({ percent: 85, severity: 'P0', policyName: 'finals-strict' });
  });

  it('keeps 70% usage healthy under the normal policy', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(5250, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({
      alertOnExceed: false,
      now: new Date('2026-07-14T23:59:59Z'),
    });
    expect(snapshot).toMatchObject({ percent: 70, severity: 'healthy', policyName: 'normal' });
  });

  it('marks 70% usage as P1 under the finals strict policy', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(5250, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({
      alertOnExceed: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });
    expect(snapshot).toMatchObject({ percent: 70, severity: 'P1', policyName: 'finals-strict' });
  });

  it('marks quota exhaustion as P0 at 100%', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(7500, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({ alertOnExceed: false });
    expect(snapshot).toMatchObject({ percent: 100, severity: 'P0' });
  });

  it('forces P0 when subscription is inactive', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(0, 7500, false));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    const snapshot = await checkApiFootballQuota({ alertOnExceed: false });
    expect(snapshot).toMatchObject({ severity: 'P0', subscriptionActive: false });
  });

  it('does not notify when alertOnExceed is false', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('notifies with P1 payload when usage exceeds the warning threshold', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'P1',
      title: 'API-Football 额度 80% (P1)',
      tags: ['api-football-quota', 'normal'],
    }), expect.objectContaining({
      dedupKey: 'quota:P1:normal',
      dedupWindowMs: 30 * 60 * 1000,
    }));
  });

  it('uses one stable P1 normal dedup key for repeated normal warning notifications', async () => {
    mocks.apiFootballGet
      .mockResolvedValueOnce(statusResult(6000, 7500))
      .mockResolvedValueOnce(statusResult(6000, 7500))
      .mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    expect(mocks.notify).toHaveBeenCalledTimes(3);
    for (const call of mocks.notify.mock.calls) {
      expect(call[1]).toEqual({ dedupKey: 'quota:P1:normal', dedupWindowMs: 30 * 60 * 1000 });
    }
  });

  it('keeps the quota dedup window at 30 minutes', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true });
    expect(mocks.notify.mock.calls[0]![1]).toMatchObject({ dedupWindowMs: 30 * 60 * 1000 });
  });

  it('uses different quota dedup keys for P1 and P0 severities', async () => {
    mocks.apiFootballGet
      .mockResolvedValueOnce(statusResult(6000, 7500))
      .mockResolvedValueOnce(statusResult(7125, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    expect(mocks.notify.mock.calls.map((call) => call[1])).toEqual([
      { dedupKey: 'quota:P1:normal', dedupWindowMs: 30 * 60 * 1000 },
      { dedupKey: 'quota:P0:normal', dedupWindowMs: 30 * 60 * 1000 },
    ]);
  });

  it('uses different quota dedup keys for normal and finals strict policies', async () => {
    mocks.apiFootballGet
      .mockResolvedValueOnce(statusResult(5250, 7500))
      .mockResolvedValueOnce(statusResult(6000, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-15T00:00:00Z') });
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-14T23:59:59Z') });
    expect(mocks.notify.mock.calls.map((call) => call[1])).toEqual([
      { dedupKey: 'quota:P1:finals-strict', dedupWindowMs: 30 * 60 * 1000 },
      { dedupKey: 'quota:P1:normal', dedupWindowMs: 30 * 60 * 1000 },
    ]);
  });

  it('does not notify for healthy quota', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(100, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('always emits E073 and emits E074 only for non-healthy severity', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(100, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota();
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E073' }));
    expect(mocks.track).not.toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E074' }));

    mocks.track.mockClear();
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(6000, 7500));
    await checkApiFootballQuota({ alertOnExceed: false });
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E073' }));
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'E074' }));
  });

  it('emits E073 with policyName', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(100, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ now: new Date('2026-07-15T00:00:00Z') });
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E073',
      properties: expect.objectContaining({ policyName: 'finals-strict' }),
    }));
  });

  it('emits E074 with policyName', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(5250, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: false, now: new Date('2026-07-15T00:00:00Z') });
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'E074',
      properties: expect.objectContaining({ policyName: 'finals-strict' }),
    }));
  });

  it('includes finals strict policy context in quota notifications', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(5250, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await checkApiFootballQuota({ alertOnExceed: true, now: new Date('2026-07-15T00:00:00Z') });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'P1',
      body: expect.stringContaining('policy: finals-strict (P1@70% / P0@85%)'),
      tags: ['api-football-quota', 'finals-strict'],
    }), expect.objectContaining({ dedupKey: 'quota:P1:finals-strict' }));
  });

  it('uses the strict policy when now is injected at the T-4d boundary', async () => {
    mocks.apiFootballGet.mockResolvedValueOnce(statusResult(5250, 7500));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await expect(checkApiFootballQuota({
      alertOnExceed: false,
      now: new Date('2026-07-15T00:00:00Z'),
    })).resolves.toMatchObject({
      percent: 70,
      severity: 'P1',
      policyName: 'finals-strict',
    });
  });

  it('propagates client auth errors', async () => {
    mocks.apiFootballGet.mockRejectedValueOnce(new ApiFootballAuthError('bad key'));
    const { checkApiFootballQuota } = await import('@/lib/api-football/quota');
    await expect(checkApiFootballQuota()).rejects.toBeInstanceOf(ApiFootballAuthError);
  });
});

function statusResult(used: number, limit: number, active = true) {
  return {
    response: {
      account: { firstname: 'Ops' },
      subscription: { plan: 'Pro', end: '2026-08-15T04:05:35+00:00', active },
      requests: { current: used, limit_day: limit },
    },
    results: 0,
    rateLimitMinuteRemaining: null,
    requestId: null,
    raw: { response: {} },
  };
}
