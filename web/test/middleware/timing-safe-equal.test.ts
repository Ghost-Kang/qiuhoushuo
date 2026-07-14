import { describe, expect, it } from 'vitest';
import { timingSafeEqual } from '@/middleware';

describe('middleware timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for same-length different strings', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('returns false for empty versus non-empty string', () => {
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('returns true for identical single-character strings', () => {
    expect(timingSafeEqual('x', 'x')).toBe(true);
  });

  it('returns true for identical 64-char HMAC hex strings', () => {
    const signature = 'a'.repeat(64);
    expect(timingSafeEqual(signature, signature)).toBe(true);
  });

  it('handles UTF-8 multi-byte characters according to JavaScript code units', () => {
    expect(timingSafeEqual('决赛🔐', '决赛🔐')).toBe(true);
    expect(timingSafeEqual('决赛🔐', '决赛🔓')).toBe(false);
  });
});
