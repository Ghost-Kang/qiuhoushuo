import { describe, expect, it } from 'vitest';
import { computeKFactor, formatKFactorReport, kFactorReport, type LandingRow, type ShareRow } from '@/scripts/k-factor-report';

const WINDOW = { since: '2026-06-11T00:00:00Z', until: '2026-06-12T00:00:00Z' };

function shares(): ShareRow[] {
  return [
    { user_id: 'u1', platform: 'wechat_chat', short_code: 'a', utm_kol: 'kolA', shared_at: 't' },
    { user_id: 'u1', platform: 'wechat_moments', short_code: 'b', utm_kol: 'kolA', shared_at: 't' },
    { user_id: 'u2', platform: 'xhs', short_code: 'c', utm_kol: 'kolB', shared_at: 't' },
  ];
}

function landings(): LandingRow[] {
  return [
    { short_code: 'a', utm_kol: 'kolA', registered: true, user_id: 'u3', visited_at: 't' },
    { short_code: 'b', utm_kol: 'kolA', registered: false, user_id: null, visited_at: 't' },
    { short_code: 'c', utm_kol: 'kolB', registered: true, user_id: 'u4', visited_at: 't' },
    { short_code: 'a', utm_kol: 'kolA', registered: false, user_id: null, visited_at: 't' },
  ];
}

describe('computeKFactor', () => {
  it('computes K = 注册回流 / 分享用户数', () => {
    const r = computeKFactor(shares(), landings(), WINDOW);
    expect(r.shares.sharers).toBe(2);
    expect(r.shares.total).toBe(3);
    expect(r.landings.total).toBe(4);
    expect(r.landings.registered).toBe(2);
    expect(r.k.kFactor).toBe(1); // 2 注册 / 2 分享者
    expect(r.k.sharesPerSharer).toBe(1.5); // 3 / 2
    expect(r.k.registerPerLanding).toBe(0.5); // 2 / 4
  });

  it('按平台分布统计分享', () => {
    const r = computeKFactor(shares(), landings(), WINDOW);
    expect(r.shares.byPlatform).toMatchObject({ wechat_chat: 1, wechat_moments: 1, xhs: 1 });
  });

  it('KOL 归因聚合分享/访问/注册', () => {
    const r = computeKFactor(shares(), landings(), WINDOW);
    const kolA = r.byKol.find((k) => k.kol === 'kolA');
    expect(kolA).toMatchObject({ shares: 2, landings: 3, registered: 1 });
    const kolB = r.byKol.find((k) => k.kol === 'kolB');
    expect(kolB).toMatchObject({ shares: 1, landings: 1, registered: 1 });
  });

  it('空数据不除零，K 因子为 0', () => {
    const r = computeKFactor([], [], WINDOW);
    expect(r.k.kFactor).toBe(0);
    expect(r.k.sharesPerSharer).toBe(0);
    expect(r.k.registerPerLanding).toBe(0);
    expect(r.byKol).toEqual([]);
  });
});

describe('formatKFactorReport', () => {
  it('K ≥ 0.8 标北极星达标', () => {
    const text = formatKFactorReport(computeKFactor(shares(), landings(), WINDOW));
    expect(text).toContain('K 因子');
    expect(text).toContain('✅ ≥ 北极星 0.8');
  });

  it('K < 0.8 标未达标', () => {
    const text = formatKFactorReport(computeKFactor([], [], WINDOW));
    expect(text).toContain('⚠️ < 北极星 0.8');
  });
});

describe('kFactorReport', () => {
  it('client 为 null 返回 null', async () => {
    expect(await kFactorReport(null, WINDOW)).toBeNull();
  });

  it('通过 client 查询并计算', async () => {
    const client = {
      from(table: string) {
        return {
          select: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ data: table === 'shares' ? shares() : landings(), error: null }),
            }),
          }),
        };
      },
    } as unknown as Parameters<typeof kFactorReport>[0];
    const r = await kFactorReport(client, WINDOW);
    expect(r?.k.kFactor).toBe(1);
    expect(r?.shares.total).toBe(3);
  });
});
