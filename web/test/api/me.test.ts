import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/me/route';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { authed, json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.FEATURE_FLAG_SHOW_PAYMENT_HISTORY;
  delete process.env.FEATURE_FLAG_KOL_ALPHA;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  __resetFlagsForTests();
});

describe('/api/me', () => {
  it('returns user center data', async () => {
    const body = await json(await GET(authed('/api/me')));
    expect(body.user.nickname).toBeTruthy();
    expect(body.user).toMatchObject({ is_minor: false, guardian_consent: false });
  });

  it('rejects unknown query', async () => {
    expect((await GET(authed('/api/me?bad=1'))).status).toBe(400);
  });

  it('requires x-openid', async () => {
    expect((await GET(req('/api/me'))).status).toBe(401);
  });

  it('matches miniprogram me shape', async () => {
    process.env.FEATURE_FLAG_SHOW_PAYMENT_HISTORY = '100';
    __resetFlagsForTests();
    expect(Object.keys(await json(await GET(authed('/api/me'))))).toEqual(['user', 'quotes', 'payments', 'kol_alpha']);
  });

  it('omits payments until payment history flag is enabled', async () => {
    let body = await json(await GET(authed('/api/me')));
    expect(body).not.toHaveProperty('payments');
    process.env.FEATURE_FLAG_SHOW_PAYMENT_HISTORY = '100';
    __resetFlagsForTests();
    body = await json(await GET(authed('/api/me')));
    expect(body).toHaveProperty('payments');
  });

  it('exposes kol_alpha=true when KOL Alpha flag is enabled', async () => {
    process.env.FEATURE_FLAG_KOL_ALPHA = '100';
    __resetFlagsForTests();
    const body = await json(await GET(authed('/api/me')));
    expect(body.kol_alpha).toBe(true);
  });

  it('exposes kol_alpha=false when KOL Alpha flag is disabled', async () => {
    process.env.FEATURE_FLAG_KOL_ALPHA = '0';
    __resetFlagsForTests();
    const body = await json(await GET(authed('/api/me')));
    expect(body.kol_alpha).toBe(false);
  });

  it('includes kol_alpha in USE_DB unknown-user fallback (G3)', async () => {
    // USE_DB=true 但 findUserByOpenid 返 null（新 openid 未在 users 表）→ 兜底返 mockMe()
    // G3 deep audit 发现 line 47 漏 withKolAlpha 包装 → 修补后兜底也含 kol_alpha 字段
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.FEATURE_FLAG_KOL_ALPHA = '100';
    __resetFlagsForTests();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
              limit: () => Promise.resolve({ data: [] }),
            }),
          }),
        }),
      }),
    }));
    const { GET: dbGET } = await import('@/app/api/me/route');
    const body = await json(await dbGET(authed('/api/me')));
    expect(body).toHaveProperty('kol_alpha', true);
  });

  // 反向验证:账单只返回成功订单 + 带 SKU 中文 label(防 pending/failed 当付费记录)
  it('账单查询过滤 status=success 并附 SKU label', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.FEATURE_FLAG_SHOW_PAYMENT_HISTORY = '100';
    __resetFlagsForTests();
    const eqCalls: Array<[string, string]> = [];
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: (table: string) => {
          const q = {
            select: () => q,
            eq: (col: string, val: string) => { eqCalls.push([col, val]); return q; },
            order: () => q,
            maybeSingle: async () => ({ data: { id: 'u1', nickname: '老王', is_minor: false, guardian_consent: false } }),
            limit: async () => ({
              data: table === 'payments'
                ? [{ id: 'pay1', sku: 'deep_report', amount_cents: 1900, paid_at: '2026-06-16' }]
                : [],
            }),
          };
          return q;
        },
      }),
    }));
    const { GET: dbGET } = await import('@/app/api/me/route');
    const body = await json(await dbGET(authed('/api/me')));
    expect(body.payments).toEqual([
      { id: 'pay1', sku: 'deep_report', label: '赛事通', amount: 19, paid_at: '2026-06-16' },
    ]);
    // 账单查询必须带 status=success 过滤
    expect(eqCalls).toContainEqual(['status', 'success']);
  });
});
