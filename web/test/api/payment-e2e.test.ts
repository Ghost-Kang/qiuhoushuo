import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authed, json } from './_utils';

/**
 * 支付闭环端到端联调(mock 模式,不碰真钱):
 *   下单 /api/payment/create → 落 pending → mock 回调 /api/payment/notify(INTERNAL_TOKEN 守护)
 *   → 结算 success → 权益查询(successfulSkus 同款 `.eq('user_id').eq('status','success')`)能查到解锁。
 * 共享一份内存 payments store,跨三步真实串联,验证闭环而非单点。
 */

type Row = Record<string, unknown>;
interface Store { users: Row[]; payments: Row[]; events: Row[] }

function makeClient(store: Store) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let pendingUpdate: Row | null = null;
      const q = {
        insert(row: Row) {
          if (table === 'payments') store.payments.push({ ...row });
          else if (table === 'events') store.events.push({ ...row });
          return Promise.resolve({ error: null });
        },
        select(_cols: string) { return q; },
        update(row: Row) { pendingUpdate = row; return q; },
        eq(col: string, val: unknown) {
          filters[col] = val;
          // update(...).eq('id', id) → 终止,落更新
          if (pendingUpdate) {
            const row = store.payments.find((p) => p[col] === val);
            if (row) Object.assign(row, pendingUpdate);
            return Promise.resolve({ error: null });
          }
          // successfulSkus: .eq('user_id').eq('status','success') → 第二个 eq 终止 awaitable
          if (table === 'payments' && col === 'status') {
            const rows = store.payments.filter((p) => p.user_id === filters.user_id && p.status === val);
            return Promise.resolve({ data: rows });
          }
          return q;
        },
        maybeSingle() {
          if (table === 'users') return Promise.resolve({ data: store.users.find((u) => u.wx_openid === filters.wx_openid) ?? null });
          if (table === 'payments') return Promise.resolve({ data: store.payments.find((p) => p.id === filters.id) ?? null });
          return Promise.resolve({ data: null });
        },
      };
      return q;
    },
  };
}

let store: Store;

beforeEach(() => {
  store = { users: [{ id: 'user-1', wx_openid: 'mock_openid_001', is_minor: false }], payments: [], events: [] };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-role';
  process.env.INTERNAL_TOKEN = 'e2e-internal-token';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => makeClient(store) }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.INTERNAL_TOKEN;
});

describe('支付闭环 e2e(mock dry-run)', () => {
  it('下单→pending→mock回调→success→权益解锁', async () => {
    const { POST: create } = await import('@/app/api/payment/create/route');
    const { POST: notify } = await import('@/app/api/payment/notify/route');

    // ① 下单(安卓小程序场景)
    const createRes = await create(authed('/api/payment/create', {
      method: 'POST',
      body: JSON.stringify({ sku: 'deep_report', scene: 'jsapi_mini' }),
    }));
    expect(createRes.status).toBe(200);
    const createBody = await json(createRes);
    const paymentId: string = createBody.paymentId;
    expect(paymentId).toBeTruthy();
    expect(createBody.amountCents).toBe(1900); // 赛事通 ¥19,服务端权威定价

    // pending 已落库
    const pending = store.payments.find((p) => p.id === paymentId);
    expect(pending).toMatchObject({ user_id: 'user-1', sku: 'deep_report', amount_cents: 1900, status: 'pending' });

    // ② mock 回调结算(INTERNAL_TOKEN 守护,金额必须等于下单金额)
    const notifyRes = await notify(new Request('http://x/api/payment/notify', {
      method: 'POST',
      headers: { 'x-mock-wxpay-secret': 'e2e-internal-token' },
      body: JSON.stringify({ out_trade_no: paymentId, transaction_id: 'wx_txn_1', trade_state: 'SUCCESS', amount: { total: 1900 } }),
    }));
    expect(notifyRes.status).toBe(200);
    expect(await json(notifyRes)).toEqual({ code: 'SUCCESS' });

    // 订单已结算成 success + 记录微信流水号
    const settled = store.payments.find((p) => p.id === paymentId);
    expect(settled).toMatchObject({ status: 'success', wx_transaction_id: 'wx_txn_1' });
    expect(settled!.paid_at).toBeTruthy();

    // ③ 权益:successfulSkus 同款查询能查到 deep_report → 战报会解锁
    type SkuQuery = { select(c: string): { eq(c: string, v: string): { eq(c: string, v: string): Promise<{ data: Row[] }> } } };
    const client = makeClient(store) as unknown as { from(t: string): SkuQuery };
    const { data } = await client.from('payments').select('sku').eq('user_id', 'user-1').eq('status', 'success');
    const skus = new Set((data ?? []).map((p) => p.sku));
    expect(skus.has('deep_report')).toBe(true);

    // E032 收款成功埋点已写
    expect(store.events.some((e) => e.event_id === 'E032' || e.eventId === 'E032')).toBe(true);
  });

  it('回调金额与下单不符 → 标 failed,权益不解锁(防价格篡改)', async () => {
    const { POST: create } = await import('@/app/api/payment/create/route');
    const { POST: notify } = await import('@/app/api/payment/notify/route');

    const createBody = await json(await create(authed('/api/payment/create', {
      method: 'POST',
      body: JSON.stringify({ sku: 'deep_report', scene: 'jsapi_mini' }),
    })));
    const paymentId: string = createBody.paymentId;

    // 篡改金额(报 100 分,实际下单 1900)
    await notify(new Request('http://x/api/payment/notify', {
      method: 'POST',
      headers: { 'x-mock-wxpay-secret': 'e2e-internal-token' },
      body: JSON.stringify({ out_trade_no: paymentId, transaction_id: 'wx_txn_bad', trade_state: 'SUCCESS', amount: { total: 100 } }),
    }));

    const row = store.payments.find((p) => p.id === paymentId);
    expect(row!.status).toBe('failed'); // 金额不符 → failed,不结算
  });

  it('伪造回调(无 INTERNAL_TOKEN)→ 401,订单仍 pending', async () => {
    const { POST: create } = await import('@/app/api/payment/create/route');
    const { POST: notify } = await import('@/app/api/payment/notify/route');

    const createBody = await json(await create(authed('/api/payment/create', {
      method: 'POST',
      body: JSON.stringify({ sku: 'deep_report', scene: 'jsapi_mini' }),
    })));
    const paymentId: string = createBody.paymentId;

    const res = await notify(new Request('http://x/api/payment/notify', {
      method: 'POST',
      body: JSON.stringify({ out_trade_no: paymentId, trade_state: 'SUCCESS', amount: { total: 1900 } }),
    }));
    expect(res.status).toBe(401);
    expect(store.payments.find((p) => p.id === paymentId)!.status).toBe('pending'); // 未被伪造结算
  });
});
