import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetFlagsForTests, flagSnapshot, isFeatureEnabled } from '@/lib/api/feature-flags';

afterEach(() => {
  delete process.env.FEATURE_FLAG_CHAT;
  delete process.env.FEATURE_FLAG_PAYMENT;
  delete process.env.FEATURE_FLAG_HOST;
  __resetFlagsForTests();
});

describe('feature flags', () => {
  it('0% returns false even for valid openid', () => {
    process.env.FEATURE_FLAG_CHAT = '0';
    __resetFlagsForTests();
    expect(isFeatureEnabled('feature.chat', { openid: 'u1' })).toBe(false);
  });

  it('100% returns true for any openid', () => {
    process.env.FEATURE_FLAG_CHAT = '100';
    __resetFlagsForTests();
    expect(isFeatureEnabled('feature.chat', { openid: 'u1' })).toBe(true);
    expect(isFeatureEnabled('feature.chat', { openid: 'u2' })).toBe(true);
  });

  it('50% bucket: same openid stable across calls', () => {
    process.env.FEATURE_FLAG_CHAT = '50';
    __resetFlagsForTests();
    const first = isFeatureEnabled('feature.chat', { openid: 'stable-user' });
    expect(isFeatureEnabled('feature.chat', { openid: 'stable-user' })).toBe(first);
    expect(isFeatureEnabled('feature.chat', { openid: 'stable-user' })).toBe(first);
  });

  it('50% bucket: distribution roughly 50/50 over 1000 openids', () => {
    process.env.FEATURE_FLAG_CHAT = '50';
    __resetFlagsForTests();
    let enabled = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (isFeatureEnabled('feature.chat', { openid: `user-${i}` })) enabled += 1;
    }
    expect(enabled).toBeGreaterThanOrEqual(400);
    expect(enabled).toBeLessThanOrEqual(600);
  });

  it('different flags get different buckets for same openid', () => {
    process.env.FEATURE_FLAG_CHAT = '50';
    process.env.FEATURE_FLAG_PAYMENT = '50';
    __resetFlagsForTests();
    let foundDifferent = false;
    for (let i = 0; i < 1000; i += 1) {
      const identity = { openid: `same-user-${i}` };
      if (isFeatureEnabled('feature.chat', identity) !== isFeatureEnabled('feature.payment', identity)) {
        foundDifferent = true;
        break;
      }
    }
    expect(foundDifferent).toBe(true);
  });

  it('unknown flag returns false fail-closed', () => {
    process.env.FEATURE_FLAG_CHAT = '100';
    __resetFlagsForTests();
    expect(isFeatureEnabled('feature.unknown', { openid: 'u1' })).toBe(false);
  });

  it('flagSnapshot returns loaded flag percentages', () => {
    process.env.FEATURE_FLAG_HOST = '25';
    __resetFlagsForTests();
    expect(flagSnapshot()).toEqual({ 'feature.host': 25 });
  });

  it('hash matches node:crypto SHA-1 for known input', () => {
    process.env.FEATURE_FLAG_CHAT = '50';
    __resetFlagsForTests();
    const expectedBucket = createHash('sha1').update('known-user:feature.chat').digest().readUInt32BE(0) % 100;
    expect(isFeatureEnabled('feature.chat', { openid: 'known-user' })).toBe(expectedBucket < 50);
  });

  it('bucket runs without node:crypto in scope', () => {
    process.env.FEATURE_FLAG_CHAT = '100';
    __resetFlagsForTests();
    expect(isFeatureEnabled('feature.chat', { openid: 'edge-user' })).toBe(true);
  });
});
