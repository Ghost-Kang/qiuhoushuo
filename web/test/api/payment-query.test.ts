import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authed, json, req } from './_utils';
import { generateKeyPairSync } from 'node:crypto';

const PID = '550e8400-e29b-41d4-a716-446655440000';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

type Row = Record<string, unknown>;
interface Store { users: Row[]; payments: Row[]; events: Row[] }
let store: Store;

function makeClient(s: Store) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let pendingUpdate: Row | null = null;
      const q = {
        select: () => q,
        update: (row: Row) => { pendingUpdate = row; return q; },
        insert: (row: Row) => { if (table === 'events') s.events.push({ ...row }); return Promise.resolve({ error: null }); },
        eq(col: string, val: unknown) {
          filters[col] = val;
          if (pendingUpdate) {
            const r = s.payments.find((p) => p[col] === val);
            if (r) Object.assign(r, pendingUpdate);
            return Promise.resolve({ error: null });
          }
          return q;
        },
        maybeSingle: async () => {
          if (table === 'users') return { data: s.users.find((u) => u.wx_openid === filters.wx_openid) ?? null };
          if (table === 'payments') return { data: s.payments.find((p) => p.id === filters.id) ?? null };
          return { data: null };
        },
      };
      return q;
    },
  };
}

function setWxpay() {
  process.env.WXPAY_ENABLED = '1';
  process.env.WXPAY_MCHID = '1900000001';
  process.env.WXPAY_MERCHANT_SERIAL = 'SERIAL';
  process.env.WXPAY_PRIVATE_KEY = PEM;
  process.env.WXPAY_API_V3_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
  process.env.WXPAY_NOTIFY_URL = 'https://e/api/payment/notify';
}

beforeEach(() => {
  store = {
    users: [{ id: 'u1', wx_openid: 'mock_openid_001' }],
    payments: [{ id: PID, user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' }],
    events: [],
  };
  process.env.SUPABASE_URL = 'https://e.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => makeClient(store) }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'WXPAY_ENABLED', 'WXPAY_MCHID', 'WXPAY_MERCHANT_SERIAL', 'WXPAY_PRIVATE_KEY', 'WXPAY_API_V3_KEY', 'WXPAY_NOTIFY_URL']) delete process.env[k];
  delete (globalThis as { fetch?: unknown }).fetch;
});

function wxOrder(state: string, total = 1900) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ trade_state: state, transaction_id: 'wx_txn_1', amount: { total } })));
}

describe('POST /api/payment/query (主动查单兜底)', () => {
  it('微信 SUCCESS → 结算订单 + E032', async () => {
    setWxpay();
    globalThis.fetch = wxOrder('SUCCESS') as unknown as typeof fetch;
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(authed('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe('success');
    expect(store.payments[0]!.status).toBe('success');
    expect(store.payments[0]!.wx_transaction_id).toBe('wx_txn_1');
    expect(store.events.some((e) => e.event_id === 'E032')).toBe(true);
  });

  it('微信 NOTPAY → 保持 pending,不结算', async () => {
    setWxpay();
    globalThis.fetch = wxOrder('NOTPAY') as unknown as typeof fetch;
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(authed('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect((await json(res)).status).toBe('pending');
    expect(store.payments[0]!.status).toBe('pending');
  });

  it('金额与下单不符 → 不结算', async () => {
    setWxpay();
    globalThis.fetch = wxOrder('SUCCESS', 1) as unknown as typeof fetch; // 微信报 ¥0.01 ≠ 下单 ¥19
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(authed('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect(store.payments[0]!.status).toBe('pending');
    expect((await json(res)).status).toBe('pending');
  });

  it('已 success → 幂等直接返回,不再查微信', async () => {
    setWxpay();
    store.payments[0]!.status = 'success';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(authed('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect((await json(res)).status).toBe('success');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非本人订单 → 403', async () => {
    setWxpay();
    store.payments[0]!.user_id = 'someone-else';
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(authed('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect(res.status).toBe(403);
  });

  it('无 openid → 401', async () => {
    const { POST } = await import('@/app/api/payment/query/route');
    const res = await POST(req('/api/payment/query', { method: 'POST', body: JSON.stringify({ paymentId: PID }) }));
    expect(res.status).toBe(401);
  });
});
