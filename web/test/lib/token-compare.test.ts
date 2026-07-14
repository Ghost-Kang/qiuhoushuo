import { describe, expect, it } from 'vitest';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

describe('timingSafeTokenEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeTokenEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('returns false for different lengths without throwing', () => {
    expect(() => timingSafeTokenEqual('short', 'longer-token')).not.toThrow();
    expect(timingSafeTokenEqual('short', 'longer-token')).toBe(false);
  });

  it('returns false for same-length different content', () => {
    expect(timingSafeTokenEqual('secret-a', 'secret-b')).toBe(false);
  });

  it('returns false for null actual value', () => {
    expect(timingSafeTokenEqual(null, 'secret-token')).toBe(false);
  });

  it('returns false for undefined actual value', () => {
    expect(timingSafeTokenEqual(undefined, 'secret-token')).toBe(false);
  });

  it('returns false for an empty actual token against a non-empty expected token', () => {
    expect(timingSafeTokenEqual('', 'secret-token')).toBe(false);
  });

  it('compares UTF-8 multi-byte token bytes correctly', () => {
    expect(timingSafeTokenEqual('决赛-token-安全', '决赛-token-安全')).toBe(true);
    expect(timingSafeTokenEqual('决赛-token-安金', '决赛-token-安全')).toBe(false);
  });

  it('returns true when both actual and expected are empty strings', () => {
    expect(timingSafeTokenEqual('', '')).toBe(true);
  });
});
