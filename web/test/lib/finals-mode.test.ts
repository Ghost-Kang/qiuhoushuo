import { afterEach, describe, expect, it } from 'vitest';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { currentThresholds, isFinalsMode, THRESHOLDS } from '@/lib/api/finals-mode';

afterEach(() => {
  delete process.env.FEATURE_FLAG_FINALS_MODE;
  __resetFlagsForTests();
});

describe('finals mode', () => {
  it('isFinalsMode returns false when flag not set', () => {
    expect(isFinalsMode()).toBe(false);
  });

  it('isFinalsMode returns true when FEATURE_FLAG_FINALS_MODE=100', () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    __resetFlagsForTests();
    expect(isFinalsMode()).toBe(true);
  });

  it('currentThresholds returns normal by default', () => {
    expect(currentThresholds()).toBe(THRESHOLDS.normal);
  });

  it('currentThresholds returns finals when flag enabled', () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    __resetFlagsForTests();
    expect(currentThresholds()).toBe(THRESHOLDS.finals);
  });
});
