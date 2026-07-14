import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { ServerEvent } from '@/lib/api/tracker';

// 球迷形象 ¥1 付费闸(AVATAR_PAYMENT_REQUIRED):
// - 默认关 → 免费生成不变(由 avatar-route.test.ts 覆盖)
// - 开 + 无"已付未兑付"权益 → 402 PAYMENT_REQUIRED
// - 开 + 有权益 → 200 + 生成后兑付(markPaymentFulfilled 写 fulfilled_at)

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.FEATURE_FLAG_FAN_AVATAR;
  delete process.env.AVATAR_PAYMENT_REQUIRED;
});

describe('POST /api/avatar · ¥1 付费闸', () => {
  it('开闸但无已付未兑付权益 → 402 PAYMENT_REQUIRED,不生成', async () => {
    const { POST, storage } = await loadRoute({ paymentRequired: true, user: { id: 'u1' }, entitlements: [] });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(402);
    expect(await json(res)).toEqual({ error: 'PAYMENT_REQUIRED' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('开闸 + 有已付未兑付权益 → 200 生成,并兑付(写 fulfilled_at)', async () => {
    const { POST, storage, updates } = await loadRoute({
      paymentRequired: true,
      user: { id: 'u1' },
      entitlements: [{ id: 'pay-1', user_id: 'u1', sku: 'avatar_card', amount_cents: 100, status: 'success', fulfilled_at: null }],
    });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(200);
    expect((await json(res) as { url: string }).url).toContain('fan-avatars/');
    expect(storage.put).toHaveBeenCalledTimes(1);
    // 兑付:对该订单 update fulfilled_at
    expect(updates).toContainEqual(expect.objectContaining({ id: 'pay-1', patch: expect.objectContaining({ fulfilled_at: expect.any(String) }) }));
  });

  it('闸关(默认)→ 不查权益、免费生成(回归保护)', async () => {
    const { POST, storage } = await loadRoute({ paymentRequired: false, user: { id: 'u1' }, entitlements: [] });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(200);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
});

function req(body: Record<string, unknown>) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'x-openid': 'openid-1' });
  return new Request('http://localhost/api/avatar', { method: 'POST', headers, body: JSON.stringify(body) });
}

type Entitlement = { id: string; user_id: string; sku: string; amount_cents: number; status: string; fulfilled_at: string | null };

async function loadRoute(opts: {
  paymentRequired: boolean;
  user: { id: string; is_minor?: boolean } | null;
  entitlements: Entitlement[];
}) {
  vi.stubEnv('FEATURE_FLAG_FAN_AVATAR', '100');
  if (opts.paymentRequired) vi.stubEnv('AVATAR_PAYMENT_REQUIRED', '1');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  process.env.SUPABASE_ANON_KEY = 'anon';

  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  // from() 按表名分流:users 走 select().eq().maybeSingle();payments 走 select().match().is().limit()(查权益) 与 update().eq()(兑付)
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: (table: string) => {
        if (table === 'payments') {
          return {
            select: () => ({
              match: () => ({
                is: () => ({ limit: async () => ({ data: opts.entitlements }) }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_c: string, id: string) => { updates.push({ id, patch }); return { error: null }; },
            }),
          };
        }
        // users
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.user }) }) }) };
      },
    }),
  }));

  const storage = { exists: vi.fn(async () => null), put: vi.fn(async (key: string) => `https://cdn.example.com/${key}`) };
  const track: ServerEvent[] = [];
  vi.resetModules();
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => storage }));
  vi.doMock('@/lib/api/tracker', () => ({ trackServerEvent: (_c: unknown, e: ServerEvent) => track.push(e) }));

  const route = await import('@/app/api/avatar/route');
  return { ...route, storage, track, updates };
}
