import { describe, expect, it } from 'vitest';
import { formationDots, parseFormation } from '../src';

describe('parseFormation', () => {
  it('parses common formations into line counts', () => {
    expect(parseFormation('4-3-3')).toEqual([4, 3, 3]);
    expect(parseFormation('4-2-3-1')).toEqual([4, 2, 3, 1]);
    expect(parseFormation('5-4-1')).toEqual([5, 4, 1]);
    expect(parseFormation('3-4-2-1')).toEqual([3, 4, 2, 1]);
  });

  it('tolerates fewer than 10 outfield players (red card / data gap)', () => {
    expect(parseFormation('4-3-2')).toEqual([4, 3, 2]);
  });

  it('trims whitespace', () => {
    expect(parseFormation(' 4-4-2 ')).toEqual([4, 4, 2]);
  });

  it('rejects malformed or impossible formations', () => {
    expect(parseFormation('')).toBeNull();
    expect(parseFormation('433')).toBeNull();
    expect(parseFormation('4-3-3-3')).toBeNull(); // 13 outfield players
    expect(parseFormation('4-0-6')).toBeNull(); // a line of 0
    expect(parseFormation('7-2-1')).toBeNull(); // line > 6
    expect(parseFormation('4–3–3')).toBeNull(); // en-dash, not hyphen
    expect(parseFormation('abc')).toBeNull();
    expect(parseFormation('1-1-1-1-1-1')).toBeNull(); // > 5 lines
  });
});

describe('formationDots', () => {
  it('returns GK + outfield dots with fractional coordinates in [0,1]', () => {
    const dots = formationDots('4-3-3')!;
    expect(dots).toHaveLength(11);
    expect(dots[0]).toMatchObject({ fx: 0.5, line: 0 });
    for (const dot of dots) {
      expect(dot.fx).toBeGreaterThan(0);
      expect(dot.fx).toBeLessThan(1);
      expect(dot.fy).toBeGreaterThan(0);
      expect(dot.fy).toBeLessThan(1);
    }
  });

  it('spreads each line evenly and orders lines goal → halfway', () => {
    const dots = formationDots('4-4-2')!;
    const defense = dots.filter((d) => d.line === 1);
    const attack = dots.filter((d) => d.line === 3);
    expect(defense).toHaveLength(4);
    expect(attack).toHaveLength(2);
    // 同线 fy 相同，攻击线比后防线更靠近中线（fy 更大）
    expect(new Set(defense.map((d) => d.fy)).size).toBe(1);
    expect(attack[0]!.fy).toBeGreaterThan(defense[0]!.fy);
    // 4 人线横向均匀：0.2 / 0.4 / 0.6 / 0.8
    expect(defense.map((d) => d.fx)).toEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it('returns null for invalid formations', () => {
    expect(formationDots('not-a-formation')).toBeNull();
  });
});
