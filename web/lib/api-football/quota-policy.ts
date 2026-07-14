export interface QuotaThresholds {
  p1Percent: number;
  p0Percent: number;
  policyName: 'normal' | 'finals-strict';
}

export const NORMAL_THRESHOLDS: QuotaThresholds = {
  p1Percent: 80,
  p0Percent: 95,
  policyName: 'normal',
};

export const FINALS_STRICT_THRESHOLDS: QuotaThresholds = {
  p1Percent: 70,
  p0Percent: 85,
  policyName: 'finals-strict',
};

const FINALS_STRICT_START = new Date('2026-07-15T00:00:00Z');
const FINALS_STRICT_END = new Date('2026-07-20T23:59:59Z');

export function resolveQuotaThresholds(now: Date): QuotaThresholds {
  if (now >= FINALS_STRICT_START && now <= FINALS_STRICT_END) {
    return FINALS_STRICT_THRESHOLDS;
  }
  return NORMAL_THRESHOLDS;
}
