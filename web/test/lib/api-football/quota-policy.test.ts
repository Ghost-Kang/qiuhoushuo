import { describe, expect, it } from 'vitest';
import {
  FINALS_STRICT_THRESHOLDS,
  NORMAL_THRESHOLDS,
  resolveQuotaThresholds,
} from '@/lib/api-football/quota-policy';

describe('resolveQuotaThresholds', () => {
  it('uses finals strict policy at the T-4d start boundary', () => {
    expect(resolveQuotaThresholds(new Date('2026-07-15T00:00:00Z'))).toBe(FINALS_STRICT_THRESHOLDS);
  });

  it('uses finals strict policy at the T+1d end boundary', () => {
    expect(resolveQuotaThresholds(new Date('2026-07-20T23:59:59Z'))).toBe(FINALS_STRICT_THRESHOLDS);
  });

  it('uses normal policy one second before the strict window', () => {
    expect(resolveQuotaThresholds(new Date('2026-07-14T23:59:59Z'))).toBe(NORMAL_THRESHOLDS);
  });

  it('uses normal policy one second after the strict window', () => {
    expect(resolveQuotaThresholds(new Date('2026-07-21T00:00:00Z'))).toBe(NORMAL_THRESHOLDS);
  });

  it('uses normal policy before finals preparations', () => {
    expect(resolveQuotaThresholds(new Date('2026-05-15T08:00:00Z'))).toBe(NORMAL_THRESHOLDS);
  });

  it('uses normal policy in the post-finals future', () => {
    expect(resolveQuotaThresholds(new Date('2026-08-15T12:00:00Z'))).toBe(NORMAL_THRESHOLDS);
  });

  it('keeps finals strict window checks fast across repeated calls', () => {
    const startedAt = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      resolveQuotaThresholds(new Date('2026-07-16T12:00:00Z'));
    }
    expect(performance.now() - startedAt).toBeLessThan(50);
  });
});
