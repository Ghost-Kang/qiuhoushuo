import { afterEach, describe, expect, it } from 'vitest';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { shouldDegradeGracefully } from '@/lib/api/finals-fallback';

afterEach(() => {
  delete process.env.FEATURE_FLAG_FINALS_MODE;
  __resetFlagsForTests();
});

describe('finals fallback', () => {
  it('returns false by default', () => {
    expect(shouldDegradeGracefully()).toBe(false);
  });

  it('returns true when finals mode enabled', () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    __resetFlagsForTests();
    expect(shouldDegradeGracefully()).toBe(true);
  });
});
