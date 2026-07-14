import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, json, req } from './_utils';

const KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'WXPAY_ENABLED',
  'WXPAY_MCHID',
  'WXPAY_MERCHANT_SERIAL',
  'WXPAY_PRIVATE_KEY',
  'WXPAY_API_V3_KEY',
  'WXPAY_SERVICE_APPID',
  'WXPAY_MINI_APPID',
  'WXPAY_NOTIFY_URL',
];
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) delete process.env[k];
  globalThis.fetch = originalFetch;
});

interface UserLike {
  id: string;
  is_minor: boolean;
}

function withDb(opts: { user: UserLike | null; insertError?: string }) {
  process.env.SUPABASE_URL = 'https://e.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  const inserts: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let currentUser = opts.user; // 有状态:支持 create 路由"查不到→upsert 自愈→再查"
  const client = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: currentUser }) }) }),
          // ensureUserByOpenid 自愈:upsert 后建档,后续 findUserByOpenid 能查到
          upsert: (row: Record<string, unknown>) => ({
            select: () => ({
              maybeSingle: async () => {
                currentUser = { id: 'u-ensured', is_minor: false };
                return { data: { id: 'u-ensured', wx_openid: row.wx_openid as string }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'payments') {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            return { error: opts.insertError ? { message: opts.insertError } : null };
          },
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
  return { inserts, events };
}

function setWxpay(opts: { serviceAppid?: string } = {}) {
  process.env.WXPAY_ENABLED = '1';
  process.env.WXPAY_MCHID = '1900000001';
  process.env.WXPAY_MERCHANT_SERIAL = 'SERIAL';
  process.env.WXPAY_PRIVATE_KEY = KEY.privateKey;
  process.env.WXPAY_API_V3_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
  process.env.WXPAY_NOTIFY_URL = 'https://e/api/payment/notify';
  if (opts.serviceAppid) process.env.WXPAY_SERVICE_APPID = opts.serviceAppid;
}

function createReq(payload: unknown, withAuth = true) {
  const init: RequestInit = { method: 'POST', body: JSON.stringify(payload) };
  return withAuth ? authed('/api/payment/create', init) : req('/api/payment/create', init);
}

async function load() {
  return import('@/app/api/payment/create/route');
}

describe('POST /api/payment/create', () => {
  it('rejects without x-openid', async () => {
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'final_column', scene: 'jsapi_mp' }, false));
    expect(res.status).toBe(401);
  });

  it('R4: accepts valid x-openid-token (signed, H5 path)', async () => {
    const { signOpenidToken } = await import('@/lib/api/openid-token');
    const token = signOpenidToken('mock_user_h5', Date.now());
    const { POST } = await load();
    const res = await POST(
      req('/api/payment/create', { method: 'POST', headers: { 'x-openid-token': token }, body: JSON.stringify({ sku: 'final_column', scene: 'jsapi_mp' }) }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).amountCents).toBe(900);
  });

  it('R4: rejects forged/invalid x-openid-token', async () => {
    const { POST } = await load();
    const res = await POST(
      req('/api/payment/create', { method: 'POST', headers: { 'x-openid-token': 'forged.token.sig' }, body: JSON.stringify({ sku: 'final_column', scene: 'jsapi_mp' }) }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects invalid json', async () => {
    const { POST } = await load();
    const res = await POST(authed('/api/payment/create', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
  });

  it('rejects unknown sku', async () => {
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'nope', scene: 'jsapi_mp' }));
    expect(res.status).toBe(400);
  });

  it('mock mode returns payParams + ¥9 for final_column', async () => {
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'final_column', scene: 'jsapi_mp' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.mock).toBe(true);
    expect(body.amountCents).toBe(900);
    expect(body.payParams.package).toContain('prepay_id=');
  });

  it('accepts reportId:null for account-level SKU (avatar_card) — 修真机"下单失败"=zod 拒 null', async () => {
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'avatar_card', scene: 'jsapi_mini', reportId: null }));
    expect(res.status).toBe(200); // 旧 .optional() 会 400 "Expected string, received null"
    const body = await json(res);
    expect(body.amountCents).toBe(100);
    expect(body.payParams.package).toContain('prepay_id=');
  });

  it('mock mode prices deep_report at ¥19', async () => {
    const { POST } = await load();
    const body = await json(await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mini' })));
    expect(body.amountCents).toBe(1900);
  });

  it('returns 503 in production when payments disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('PAYMENTS_DISABLED');
  });

  it('R3: production + db + no wxpay → 503 without inserting a pending order', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cap = withDb({ user: { id: 'u1', is_minor: false } });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(503);
    expect(cap.inserts.length).toBe(0);
    expect(cap.events.length).toBe(0);
  });

  it('R3: production keeps payments disabled when keys exist but WXPAY_ENABLED is not 1', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    setWxpay({ serviceAppid: 'wx_mp' });
    delete process.env.WXPAY_ENABLED;
    const cap = withDb({ user: { id: 'u1', is_minor: false } });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('PAYMENTS_DISABLED');
    expect(cap.inserts.length).toBe(0);
  });

  it('blocks minors with 403', async () => {
    withDb({ user: { id: 'u1', is_minor: true } });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe('MINOR_BLOCKED');
  });

  it('self-heals unknown-but-authed openid by upserting a user, then creates the order', async () => {
    // openid 已鉴权但 users 无行(登录 upsert 上线前/缓存 openid)→ create 自愈建档,不再 401
    const cap = withDb({ user: null });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mini' }));
    expect(res.status).toBe(200);
    expect(cap.inserts[0]).toMatchObject({ user_id: 'u-ensured', sku: 'deep_report', status: 'pending' });
  });

  it('creates pending order and tracks E031 (db, no wxpay)', async () => {
    const cap = withDb({ user: { id: 'u1', is_minor: false } });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mini' }));
    expect(res.status).toBe(200);
    expect(cap.inserts[0]).toMatchObject({ user_id: 'u1', sku: 'deep_report', amount_cents: 1900, status: 'pending' });
    expect(cap.events.some((e) => e.event_id === 'E031')).toBe(true);
  });

  it('客户端 reportId 不写入 payments.report_id(外键引用 reports.id;SKU 是账户级)→ 避免外键违例', async () => {
    // 真机踩坑:客户端传 match_id(UUID) 当 reportId,但 report_id 外键引用 reports(id) → FK 违例 → 下单 500。
    const cap = withDb({ user: { id: 'u1', is_minor: false } });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mini', reportId: '11111111-1111-1111-1111-111111111111' }));
    expect(res.status).toBe(200);
    expect(cap.inserts[0]!.report_id).toBeNull(); // 不绑战报行
  });

  it('returns 500 when pending insert fails', async () => {
    withDb({ user: { id: 'u1', is_minor: false }, insertError: 'boom' });
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(500);
  });

  it('real wxpay mode returns signed payParams', async () => {
    setWxpay({ serviceAppid: 'wx_mp' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepay_id: 'PP1' })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.payParams.package).toBe('prepay_id=PP1');
    expect(body.payParams.paySign).toBeTruthy();
    // 微信 out_trade_no 必须 ≤32 字符且无连字符(UUID 会超 32 被拒 PARAM_ERROR 商户订单号错误)
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const sentBody = JSON.parse((firstCall![1] as { body: string }).body);
    expect(sentBody.out_trade_no).not.toContain('-');
    expect(sentBody.out_trade_no.length).toBe(32);
  });

  it('returns 400 when scene appid not configured', async () => {
    setWxpay();
    const { POST } = await load();
    const res = await POST(createReq({ sku: 'deep_report', scene: 'jsapi_mp' }));
    expect(res.status).toBe(400);
    expect((await json(res)).details).toMatchObject({ scene: 'APPID_NOT_CONFIGURED' });
  });
});
