import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const UUID = '11111111-1111-4111-8111-111111111111';

const ENV_KEYS = [
  'ADMIN_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'WXPAY_MCHID',
  'WXPAY_MERCHANT_SERIAL',
  'WXPAY_PRIVATE_KEY',
  'WXPAY_API_V3_KEY',
  'WXPAY_NOTIFY_URL',
];
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  globalThis.fetch = originalFetch;
});

interface PaymentLike {
  id: string;
  user_id: string;
  sku: string;
  amount_cents: number;
  status: string;
  wx_transaction_id?: string | null;
}

function withDb(opts: { payment: PaymentLike | null }) {
  process.env.SUPABASE_URL = 'https://e.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  const updates: { row: Record<string, unknown>; id: string }[] = [];
  const events: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === 'payments') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.payment }) }) }),
          update: (row: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ row, id });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'events') {
        return {
          insert: (row: Record<string, unknown>) => {
            events.push(row);
            return Promise.resolve({});
          },
        };
      }
      return {};
    },
  };
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
  return { updates, events };
}

function setWxpay() {
  process.env.WXPAY_ENABLED = '1';
  process.env.WXPAY_MCHID = '1900000001';
  process.env.WXPAY_MERCHANT_SERIAL = 'SERIAL';
  process.env.WXPAY_PRIVATE_KEY = KEY.privateKey;
  process.env.WXPAY_API_V3_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
  process.env.WXPAY_NOTIFY_URL = 'https://e/api/payment/notify';
}

function adminReq(payload: unknown, withToken = true) {
  const headers: Record<string, string> = withToken ? { 'x-admin-token': 'secret' } : {};
  return req('/api/admin/payment-refund', { method: 'POST', headers, body: JSON.stringify(payload) });
}

async function load() {
  return import('@/app/api/admin/payment-refund/route');
}

describe('POST /api/admin/payment-refund', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }, false));
    expect(res.status).toBe(401);
  });

  it('mock refund when db disabled', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }));
    expect(res.status).toBe(200);
    expect((await json(res)).mock).toBe(true);
  });

  it('400 when payment not found', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    withDb({ payment: null });
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }));
    expect(res.status).toBe(400);
  });

  it('400 when payment not refundable', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    withDb({ payment: { id: UUID, user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' } });
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }));
    expect(res.status).toBe(400);
    expect((await json(res)).details).toMatchObject({ payment: 'NOT_REFUNDABLE', status: 'pending' });
  });

  it('refunds a success order and tracks E033', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const cap = withDb({ payment: { id: UUID, user_id: 'u1', sku: 'final_column', amount_cents: 900, status: 'success', wx_transaction_id: null } });
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }));
    expect(res.status).toBe(200);
    expect(cap.updates[0]!.row).toMatchObject({ status: 'refunded' });
    expect(cap.events.some((e) => e.event_id === 'E033')).toBe(true);
  });

  it('calls wechat refund when wxpay enabled', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    setWxpay();
    const cap = withDb({ payment: { id: UUID, user_id: 'u1', sku: 'final_column', amount_cents: 900, status: 'success', wx_transaction_id: 'txReal' } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'PROCESSING' })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { POST } = await load();
    const res = await POST(adminReq({ paymentId: UUID }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(cap.updates[0]!.row).toMatchObject({ status: 'refunded' });
  });
});
