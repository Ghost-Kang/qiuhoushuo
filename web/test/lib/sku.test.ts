import { describe, expect, it } from 'vitest';
import { getSku, isSku, SKUS } from '@/lib/api/sku';

describe('sku registry', () => {
  it('赛事通 deep_report = ¥19', () => {
    expect(SKUS.deep_report.amountCents).toBe(1900);
    expect(SKUS.deep_report.label).toBe('赛事通');
  });

  it('决赛专栏 final_column = ¥9', () => {
    expect(SKUS.final_column.amountCents).toBe(900);
    expect(SKUS.final_column.label).toBe('决赛专栏');
  });

  it('isSku guards membership', () => {
    expect(isSku('deep_report')).toBe(true);
    expect(isSku('final_column')).toBe(true);
    expect(isSku('bogus')).toBe(false);
  });

  it('getSku returns info or null', () => {
    expect(getSku('deep_report')?.amountCents).toBe(1900);
    expect(getSku('nope')).toBeNull();
  });
});
