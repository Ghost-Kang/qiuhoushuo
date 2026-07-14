import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaMemoryForTests, setValue } from '@/lib/api/quota-store';

type AlertPayload = { severity?: string; title?: string; body?: string };
type AlertOptions = { dedupKey?: string; dedupWindowMs?: number };

const calls: Array<{ payload: AlertPayload; opts?: AlertOptions }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetQuotaMemoryForTests();
  calls.length = 0;
});

describe('maybeAlertRateLimitFlood', () => {
  it('fires P1 once when count crosses 100', async () => {
    await setValue('rl:user:u1', '61', 300);
    await setValue('rl:ip:1.2.3.4', '201', 300);
    const { maybeAlertRateLimitFlood } = await loadSubject();
    await maybeAlertRateLimitFlood(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({ severity: 'P1', title: '5 分钟限流命中突增' });
    expect(calls[0]?.payload.body).toContain('top_openid=u1:61');
    expect(calls[0]?.payload.body).toContain('top_ip=1.2.3.4:201');
    expect(calls[0]?.opts).toEqual({ dedupKey: 'middleware:rate-limit-flood', dedupWindowMs: 300000 });
  });

  it('does not fire for count below 100 or after', async () => {
    const { maybeAlertRateLimitFlood } = await loadSubject();
    await maybeAlertRateLimitFlood(99);
    await maybeAlertRateLimitFlood(101);
    expect(calls).toHaveLength(0);
  });

  it('renders top_ip=n/a when scanPrefix returns empty', async () => {
    const { setValue: setQuotaValue } = await import('@/lib/api/quota-store');
    await setQuotaValue('rl:user:u1', '61', 300);
    const { maybeAlertRateLimitFlood } = await loadSubject();
    await maybeAlertRateLimitFlood(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.body).toContain('top_openid=u1:61');
    expect(calls[0]?.payload.body).toContain('top_ip=n/a');
  });

  it('renders the highest count IP when multiple IP counters exist', async () => {
    const { setValue: setQuotaValue } = await import('@/lib/api/quota-store');
    await setQuotaValue('rl:ip:1.2.3.4', '101', 300);
    await setQuotaValue('rl:ip:5.6.7.8', '202', 300);
    const { maybeAlertRateLimitFlood } = await loadSubject();
    await maybeAlertRateLimitFlood(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.body).toContain('top_ip=5.6.7.8:202');
  });
});

async function loadSubject() {
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: (payload: unknown, opts?: unknown) => calls.push({
      payload: payload as AlertPayload,
      opts: opts as AlertOptions,
    }),
  }));
  return import('@/lib/api/rate-limit-alert');
}
