import { createCipheriv, createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const platform = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const merchant = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const API_V3 = 'abcdefghijklmnopqrstuvwxyz123456';
const MOCK_SECRET = 'dev-internal-token';

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'WXPAY_MCHID',
  'WXPAY_MERCHANT_SERIAL',
  'WXPAY_PRIVATE_KEY',
  'WXPAY_API_V3_KEY',
  'WXPAY_PLATFORM_PUBLIC_KEY',
  'WXPAY_NOTIFY_URL',
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) delete process.env[k];
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

function setWxpayReal() {
  process.env.WXPAY_ENABLED = '1';
  process.env.WXPAY_MCHID = '1900000001';
  process.env.WXPAY_MERCHANT_SERIAL = 'SERIAL';
  process.env.WXPAY_PRIVATE_KEY = merchant.privateKey;
  process.env.WXPAY_API_V3_KEY = API_V3;
  process.env.WXPAY_PLATFORM_PUBLIC_KEY = platform.publicKey;
  process.env.WXPAY_NOTIFY_URL = 'https://e/api/payment/notify';
}

function aesEncrypt(plain: string) {
  const nonce = '123456789012';
  const aad = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_V3, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]).toString('base64'), nonce, associated_data: aad };
}

function signPlatform(ts: string, nonce: string, body: string) {
  return createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}\n`).end().sign(platform.privateKey, 'base64');
}

function mockReq(payload: unknown, secret: string = MOCK_SECRET) {
  return req('/api/payment/notify', { method: 'POST', headers: { 'x-mock-wxpay-secret': secret }, body: JSON.stringify(payload) });
}

async function load() {
  return import('@/app/api/payment/notify/route');
}

describe('POST /api/payment/notify (mock mode)', () => {
  it('rejects wrong mock secret', async () => {
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'o', trade_state: 'SUCCESS' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('rejects malformed body', async () => {
    const { POST } = await load();
    const res = await POST(mockReq({ nonsense: true }));
    expect(res.status).toBe(400);
  });

  it('returns SUCCESS without event for unknown order', async () => {
    const cap = withDb({ payment: null });
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'unknown', transaction_id: 'tx', trade_state: 'SUCCESS' }));
    expect(res.status).toBe(200);
    expect(cap.events.length).toBe(0);
  });

  it('marks success and tracks E032 when amount matches', async () => {
    const cap = withDb({ payment: { id: 'o1', user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' } });
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'o1', transaction_id: 'tx9', trade_state: 'SUCCESS', amount: { total: 1900 } }));
    expect(res.status).toBe(200);
    expect(cap.updates[0]!.row).toMatchObject({ status: 'success', wx_transaction_id: 'tx9' });
    expect(cap.events.some((e) => e.event_id === 'E032')).toBe(true);
  });

  it('rejects amount mismatch: marks failed, no E032', async () => {
    const cap = withDb({ payment: { id: 'o1', user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' } });
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'o1', transaction_id: 'tx9', trade_state: 'SUCCESS', amount: { total: 100 } }));
    expect(res.status).toBe(200);
    expect(cap.updates[0]!.row).toMatchObject({ status: 'failed' });
    expect(cap.events.some((e) => e.event_id === 'E032')).toBe(false);
  });

  it('returns 503 in production when payments disabled (mock branch closed)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'o1', transaction_id: 'tx', trade_state: 'SUCCESS' }));
    expect(res.status).toBe(503);
  });

  it('is idempotent when order already success', async () => {
    const cap = withDb({ payment: { id: 'o1', user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'success' } });
    const { POST } = await load();
    await POST(mockReq({ out_trade_no: 'o1', transaction_id: 'tx', trade_state: 'SUCCESS' }));
    expect(cap.updates.length).toBe(0);
  });

  it('marks failed on non-success trade state', async () => {
    const cap = withDb({ payment: { id: 'o1', user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' } });
    const { POST } = await load();
    await POST(mockReq({ out_trade_no: 'o1', transaction_id: '', trade_state: 'CLOSED' }));
    expect(cap.updates[0]!.row).toMatchObject({ status: 'failed' });
  });

  it('returns SUCCESS in no-db mock mode', async () => {
    const { POST } = await load();
    const res = await POST(mockReq({ out_trade_no: 'o1', transaction_id: 'tx', trade_state: 'SUCCESS' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ code: 'SUCCESS' });
  });
});

describe('POST /api/payment/notify (real mode)', () => {
  it('verifies signature, decrypts resource, returns SUCCESS', async () => {
    setWxpayReal();
    const raw = JSON.stringify({ resource: aesEncrypt(JSON.stringify({ out_trade_no: 'o-real', transaction_id: 'txR', trade_state: 'SUCCESS' })) });
    const headers = {
      'wechatpay-signature': signPlatform('1700', 'NN', raw),
      'wechatpay-timestamp': '1700',
      'wechatpay-nonce': 'NN',
    };
    const { POST } = await load();
    const res = await POST(req('/api/payment/notify', { method: 'POST', headers, body: raw }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ code: 'SUCCESS' });
  });

  it('rejects invalid signature with 401', async () => {
    setWxpayReal();
    const raw = JSON.stringify({ resource: aesEncrypt('{}') });
    const headers = { 'wechatpay-signature': 'bad', 'wechatpay-timestamp': '1', 'wechatpay-nonce': '1' };
    const { POST } = await load();
    const res = await POST(req('/api/payment/notify', { method: 'POST', headers, body: raw }));
    expect(res.status).toBe(401);
  });
});
