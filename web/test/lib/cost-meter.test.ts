import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COST_CAP_CNY, costKey, getDailyCost, recordCost } from '@/lib/api/cost-meter';
import { __resetQuotaMemoryForTests, getValue } from '@/lib/api/quota-store';

beforeEach(() => {
  __resetQuotaMemoryForTests();
  vi.useRealTimers();
});

afterEach(() => {
  __resetQuotaMemoryForTests();
  vi.useRealTimers();
});

describe('costKey (UTC+8 daily bucket)', () => {
  it('shifts UTC to Asia/Shanghai before formatting the date', () => {
    // 2026-05-13 00:30 Shanghai = 2026-05-12 16:30 UTC
    const shanghaiMidnight = new Date(Date.UTC(2026, 4, 12, 16, 30));
    expect(costKey(shanghaiMidnight)).toBe('cost:2026-05-13');
  });

  it('rolls over the bucket once UTC+8 crosses midnight', () => {
    const before = new Date(Date.UTC(2026, 4, 12, 15, 59, 59)); // 5/12 23:59:59 SH
    const after = new Date(Date.UTC(2026, 4, 12, 16, 0, 0)); //   5/13 00:00:00 SH
    expect(costKey(before)).toBe('cost:2026-05-12');
    expect(costKey(after)).toBe('cost:2026-05-13');
  });

  it('defaults to "now" when called without args', () => {
    const k = costKey();
    expect(k).toMatch(/^cost:\d{4}-\d{2}-\d{2}$/);
  });
});

describe('recordCost / getDailyCost', () => {
  it('charges doubao at 0.008 CNY / 1k tokens', async () => {
    await recordCost('doubao', 10_000); // 0.08 CNY = 8 cents
    expect(await getDailyCost()).toBe(0.08);
  });

  it('charges deepseek at 0.014 CNY / 1k tokens (ceil to next cent)', async () => {
    await recordCost('deepseek', 1_000); // 0.014 CNY → ceil(1.4) = 2 cents
    expect(await getDailyCost()).toBe(0.02);
  });

  it('treats unknown provider as doubao (graceful default)', async () => {
    await recordCost('zhipu', 10_000); // unknown → falls back to doubao price
    expect(await getDailyCost()).toBe(0.08);
  });

  it('treats explicit fallback provider as 0 cost', async () => {
    await recordCost('fallback', 10_000);
    expect(await getDailyCost()).toBe(0);
  });

  it('accumulates across multiple recordCost calls within the same day', async () => {
    await recordCost('doubao', 1_000);
    await recordCost('doubao', 1_000);
    await recordCost('deepseek', 1_000);
    // doubao 2 × ceil(0.008 * 100) = 2 + deepseek ceil(1.4) = 2 → 4 cents
    expect(await getDailyCost()).toBe(0.04);
  });

  it('writes cents (integer) to the bucket key, not yuan', async () => {
    await recordCost('doubao', 10_000);
    const raw = await getValue(costKey());
    expect(raw).toBe('8');
  });
});

describe('COST_CAP_CNY', () => {
  it('exports a positive ceiling from env or sane default', () => {
    expect(typeof COST_CAP_CNY).toBe('number');
    expect(COST_CAP_CNY).toBeGreaterThan(0);
  });
});
