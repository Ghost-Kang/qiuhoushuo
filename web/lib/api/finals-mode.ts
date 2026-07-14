import { isFeatureEnabled } from './feature-flags';

export const THRESHOLDS = {
  normal: {
    rateLimitPerUserPerMin: 60,
    rateLimitPerIpPerMin: 200,
    maxInFlight: 100,
    costCapCny: 500,
  },
  finals: {
    rateLimitPerUserPerMin: 120,
    rateLimitPerIpPerMin: 800,
    maxInFlight: 500,
    costCapCny: 5000,
  },
} as const;

export function isFinalsMode(): boolean {
  return isFeatureEnabled('feature.finals_mode', { openid: 'global' });
}

export function currentThresholds() {
  return isFinalsMode() ? THRESHOLDS.finals : THRESHOLDS.normal;
}
