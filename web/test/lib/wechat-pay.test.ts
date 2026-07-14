import { createCipheriv, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appidForScene,
  buildAuthToken,
  buildPayParams,
  createJsapiOrder,
  createRefund,
  decryptResource,
  loadWxPayConfig,
  verifyNotifySignature,
  type WxPayConfig,
} from '@/lib/api/wechat-pay';

const merchant = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const platform = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const API_V3 = 'abcdefghijklmnopqrstuvwxyz123456'; // 32 bytes

function cfg(over: Partial<WxPayConfig> = {}): WxPayConfig {
  return {
    mchid: '1900000001',
    merchantSerial: 'SERIAL01',
    privateKey: merchant.privateKey,
    apiV3Key: API_V3,
    platformPublicKey: platform.publicKey,
    serviceAppid: 'wx_mp',
    miniAppid: 'wx_mini',
    notifyUrl: 'https://x.example/api/payment/notify',
    baseUrl: 'https://api.mch.weixin.qq.com',
    ...over,
  };
}

function aesEncrypt(plain: string, aad?: string) {
  const nonce = '123456789012';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_V3, 'utf8'), Buffer.from(nonce, 'utf8'));
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]).toString('base64'), nonce, associated_data: aad };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadWxPayConfig', () => {
  it('returns null when core keys missing', () => {
    expect(loadWxPayConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('builds config and normalizes escaped newlines in PEM', () => {
    const c = loadWxPayConfig({
      WXPAY_MCHID: 'm',
      WXPAY_MERCHANT_SERIAL: 's',
      WXPAY_PRIVATE_KEY: 'a\\nb',
      WXPAY_API_V3_KEY: 'k',
      WXPAY_PLATFORM_PUBLIC_KEY: 'p\\nq',
      WXPAY_NOTIFY_URL: 'https://u',
    } as unknown as NodeJS.ProcessEnv);
    expect(c?.privateKey).toBe('a\nb');
    expect(c?.platformPublicKey).toBe('p\nq');
    expect(c?.notifyUrl).toBe('https://u');
  });
});

describe('appidForScene', () => {
  it('maps mp → serviceAppid, mini → miniAppid', () => {
    expect(appidForScene(cfg(), 'jsapi_mp')).toBe('wx_mp');
    expect(appidForScene(cfg(), 'jsapi_mini')).toBe('wx_mini');
  });

  it('returns null when scene appid unset', () => {
    expect(appidForScene(cfg({ serviceAppid: undefined }), 'jsapi_mp')).toBeNull();
    expect(appidForScene(cfg({ miniAppid: '' }), 'jsapi_mini')).toBeNull();
  });
});

describe('buildAuthToken', () => {
  it('embeds mchid / serial / signature', () => {
    const token = buildAuthToken(cfg(), 'POST', '/v3/pay/transactions/jsapi', '{}', 'NONCE', '1700000000');
    expect(token).toContain('mchid="1900000001"');
    expect(token).toContain('serial_no="SERIAL01"');
    expect(token).toMatch(/signature="[^"]+"/);
  });
});

describe('buildPayParams', () => {
  it('produces a signature verifiable by the merchant public key', () => {
    const params = buildPayParams(cfg(), 'wx_mp', 'PP123', { nonce: () => 'N', timestamp: () => 'T' });
    expect(params.package).toBe('prepay_id=PP123');
    expect(params.signType).toBe('RSA');
    const message = `wx_mp\nT\nN\nprepay_id=PP123\n`;
    const valid = createVerify('RSA-SHA256').update(message).end().verify(merchant.publicKey, params.paySign, 'base64');
    expect(valid).toBe(true);
  });
});

describe('verifyNotifySignature', () => {
  function sign(ts: string, nonce: string, body: string) {
    return createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}\n`).end().sign(platform.privateKey, 'base64');
  }

  it('accepts a valid platform signature', () => {
    const body = '{"id":"x"}';
    const signature = sign('1700', 'NN', body);
    expect(verifyNotifySignature(cfg(), { signature, timestamp: '1700', nonce: 'NN' }, body)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = sign('1700', 'NN', '{"id":"x"}');
    expect(verifyNotifySignature(cfg(), { signature, timestamp: '1700', nonce: 'NN' }, '{"id":"y"}')).toBe(false);
  });

  it('rejects when platform public key missing', () => {
    expect(verifyNotifySignature(cfg({ platformPublicKey: '' }), { signature: 'x', timestamp: '1', nonce: '1' }, 'b')).toBe(false);
  });

  it('rejects malformed signature without throwing', () => {
    expect(verifyNotifySignature(cfg(), { signature: 'not-base64-!!!', timestamp: '1', nonce: '1' }, 'b')).toBe(false);
  });
});

describe('decryptResource', () => {
  it('round-trips ciphertext', () => {
    const r = aesEncrypt('{"out_trade_no":"o1"}');
    expect(decryptResource(API_V3, { ciphertext: r.ciphertext, nonce: r.nonce })).toBe('{"out_trade_no":"o1"}');
  });

  it('round-trips with associated_data', () => {
    const r = aesEncrypt('payload', 'transaction');
    expect(decryptResource(API_V3, r)).toBe('payload');
  });
});

describe('createJsapiOrder', () => {
  it('returns prepayId and signs the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepay_id: 'PP_OK' })));
    const r = await createJsapiOrder(
      cfg(),
      { appid: 'wx_mp', description: '赛事通', outTradeNo: 'o1', amountCents: 1900, openid: 'op1' },
      { fetch: fetchMock as unknown as typeof fetch, nonce: () => 'N', timestamp: () => 'T' },
    );
    expect(r.prepayId).toBe('PP_OK');
    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toContain('/v3/pay/transactions/jsapi');
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toContain('WECHATPAY2-SHA256-RSA2048');
  });

  it('throws when wechat returns no prepay_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'PARAM_ERROR', message: 'bad' }), { status: 400 }));
    await expect(
      createJsapiOrder(
        cfg(),
        { appid: 'wx_mp', description: 'x', outTradeNo: 'o', amountCents: 100, openid: 'o' },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/PARAM_ERROR/);
  });
});

describe('createRefund', () => {
  it('returns status on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'PROCESSING' })));
    const r = await createRefund(
      cfg(),
      { transactionId: 'tx', outRefundNo: 're_1', amountCents: 1900 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(r.status).toBe('PROCESSING');
  });

  it('throws when refund has no status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ERR' }), { status: 400 }));
    await expect(
      createRefund(cfg(), { transactionId: 'tx', outRefundNo: 're', amountCents: 1 }, { fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/ERR/);
  });
});
