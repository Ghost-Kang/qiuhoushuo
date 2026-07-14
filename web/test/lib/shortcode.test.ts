import { describe, expect, it } from 'vitest';
import { generateShortCode, isValidShortCode } from '@/lib/api/shortcode';

describe('shortcode', () => {
  it('generates 7-char code', () => {
    expect(generateShortCode()).toMatch(/^[a-z0-9]{7}$/);
  });

  it('100 random codes are all unique', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
    expect(codes.size).toBe(100);
  });

  it('excludes ambiguous chars 0/o/1/l/i', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateShortCode()).not.toMatch(/[0o1li]/);
    }
  });

  it('isValidShortCode rejects too short, too long, and wrong chars', () => {
    expect(isValidShortCode('2345678')).toBe(true);
    expect(isValidShortCode('234567')).toBe(false);
    expect(isValidShortCode('23456789')).toBe(false);
    expect(isValidShortCode('ooooooo')).toBe(false);
    expect(isValidShortCode('abc_def')).toBe(false);
  });
});
