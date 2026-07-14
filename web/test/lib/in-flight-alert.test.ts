import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';

type AlertPayload = { severity?: string; title?: string; body?: string };
type AlertOptions = { dedupKey?: string; dedupWindowMs?: number };

const calls: Array<{ payload: AlertPayload; opts?: AlertOptions }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetQuotaMemoryForTests();
  calls.length = 0;
});

describe('maybeAlertInFlightCap', () => {
  it('fires P1 once per 5 minute window when in-flight cap is exceeded', async () => {
    vi.doMock('@/lib/alerts', () => ({
      notifyOpsFireAndForget: (payload: unknown, opts?: unknown) => calls.push({
        payload: payload as AlertPayload,
        opts: opts as AlertOptions,
      }),
    }));
    const { maybeAlertInFlightCap } = await import('@/lib/api/in-flight-alert');
    await maybeAlertInFlightCap(101, 100);
    await maybeAlertInFlightCap(102, 100);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({ severity: 'P1', title: 'API in-flight 容量打满' });
    expect(calls[0]?.payload.body).toContain('in_flight=101');
    expect(calls[0]?.opts).toEqual({ dedupKey: 'middleware:in-flight-cap', dedupWindowMs: 300000 });
  });
});
