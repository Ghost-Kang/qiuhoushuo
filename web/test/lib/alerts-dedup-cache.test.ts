import { describe, expect, it } from 'vitest';
import {
  _clearDedupCacheForTest,
  DEFAULT_WINDOW_MS,
  recordDedup,
  shouldDedup,
  snapshotDedup,
} from '@/lib/alerts/dedup-cache';

describe('alerts dedup cache', () => {
  it('does not dedup a key the first time it is seen', () => {
    expect(shouldDedup('first')).toBe(false);
  });

  it('dedups a key after it has been recorded', () => {
    recordDedup('repeat', 1_000);
    expect(shouldDedup('repeat', 1_001)).toBe(true);
  });

  it('expires a key after the dedup window', () => {
    recordDedup('expired', 1_000);
    expect(shouldDedup('expired', 1_000 + DEFAULT_WINDOW_MS + 1)).toBe(false);
  });

  it('increments hitCount when a repeated key is deduped', () => {
    recordDedup('counted', 1_000);
    expect(shouldDedup('counted', 1_001)).toBe(true);
    expect(shouldDedup('counted', 1_002)).toBe(true);
    expect(snapshotDedup(1_003)).toEqual([
      { key: 'counted', firstSeenAt: 1_000, expiresAt: 1_000 + DEFAULT_WINDOW_MS, hitCount: 3 },
    ]);
  });

  it('keeps different keys isolated', () => {
    recordDedup('key-a', 1_000);
    expect(shouldDedup('key-a', 1_001)).toBe(true);
    expect(shouldDedup('key-b', 1_001)).toBe(false);
  });

  it('clears all keys for test isolation', () => {
    recordDedup('clear-me', 1_000);
    _clearDedupCacheForTest();
    expect(shouldDedup('clear-me', 1_001)).toBe(false);
  });

  it('snapshots only unexpired entries with hitCount greater than one', () => {
    recordDedup('single-hit', 1_000);
    recordDedup('multi-hit', 1_000);
    recordDedup('expired-hit', 1_000, 10);
    shouldDedup('multi-hit', 1_001);
    shouldDedup('expired-hit', 1_001, 10);
    expect(snapshotDedup(1_011)).toEqual([
      { key: 'multi-hit', firstSeenAt: 1_000, expiresAt: 1_000 + DEFAULT_WINDOW_MS, hitCount: 2 },
    ]);
  });
});
