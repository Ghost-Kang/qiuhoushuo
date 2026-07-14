/**
 * 微信支付 v3 客户端（JSAPI 下单 + 客户端调起参数 + 回调验签/解密 + 退款）。
 *
 * 6/1 决策（decisions/2026-06-01-purchase-monetization-under-getihu.md）：
 * 同一商户号绑定服务号 + 小程序两个 AppID，
 *   - scene=jsapi_mp   → 服务号 H5（WXPAY_SERVICE_APPID），iOS+安卓通吃
 *   - scene=jsapi_mini → 安卓小程序（WXPAY_MINI_APPID）
 * 共用本模块与同一套 payments 后端。
 *
 * 纯函数 + 可注入 fetch/nonce/timestamp，便于单测用自生成 RSA 密钥与 AES 密钥做往返验证。
 */

import { createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto';

const WXPAY_BASE = 'https://api.mch.weixin.qq.com';

export type PaymentScene = 'jsapi_mp' | 'jsapi_mini';

export interface WxPayConfig {
  mchid: string;
  merchantSerial: string;
  privateKey: string;
  apiV3Key: string;
  platformPublicKey: string;
  serviceAppid?: string;
  miniAppid?: string;
  notifyUrl: string;
  baseUrl: string;
}

export interface WxPayDeps {
  fetch?: typeof fetch;
  nonce?: () => string;
  timestamp?: () => string;
}

export interface JsapiOrderParams {
  appid: string;
  description: string;
  outTradeNo: string;
  amountCents: number;
  openid: string;
}

export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export interface RefundParams {
  transactionId: string;
  outRefundNo: string;
  amountCents: number;
  reason?: string;
}

export interface WxNotifyHeaders {
  signature: string;
  timestamp: string;
  nonce: string;
}

export interface WxResource {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}

function normalizePem(value: string | undefined): string {
  return (value ?? '').replace(/\\n/g, '\n');
}

export function loadWxPayConfig(env: NodeJS.ProcessEnv = process.env): WxPayConfig | null {
  const mchid = env.WXPAY_MCHID;
  const merchantSerial = env.WXPAY_MERCHANT_SERIAL;
  const privateKey = normalizePem(env.WXPAY_PRIVATE_KEY);
  const apiV3Key = env.WXPAY_API_V3_KEY;
  if (!mchid || !merchantSerial || !privateKey || !apiV3Key) return null;
  return {
    mchid,
    merchantSerial,
    privateKey,
    apiV3Key,
    platformPublicKey: normalizePem(env.WXPAY_PLATFORM_PUBLIC_KEY),
    serviceAppid: env.WXPAY_SERVICE_APPID,
    miniAppid: env.WXPAY_MINI_APPID,
    notifyUrl: env.WXPAY_NOTIFY_URL ?? '',
    baseUrl: WXPAY_BASE,
  };
}

export function appidForScene(cfg: WxPayConfig, scene: PaymentScene): string | null {
  const appid = scene === 'jsapi_mp' ? cfg.serviceAppid : cfg.miniAppid;
  return appid && appid.length > 0 ? appid : null;
}

function defaultNonce(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

function defaultTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function rsaSign(message: string, privateKey: string): string {
  return createSign('RSA-SHA256').update(message).end().sign(privateKey, 'base64');
}

/** 构造请求签名 Authorization 头（WECHATPAY2-SHA256-RSA2048）。 */
export function buildAuthToken(
  cfg: WxPayConfig,
  method: string,
  urlPath: string,
  body: string,
  nonce: string,
  timestamp: string,
): string {
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaSign(message, cfg.privateKey);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",` +
    `timestamp="${timestamp}",serial_no="${cfg.merchantSerial}",signature="${signature}"`
  );
}

async function postSigned(
  cfg: WxPayConfig,
  urlPath: string,
  bodyObj: Record<string, unknown>,
  deps: WxPayDeps,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const f = deps.fetch ?? fetch;
  const nonce = (deps.nonce ?? defaultNonce)();
  const timestamp = (deps.timestamp ?? defaultTimestamp)();
  const body = JSON.stringify(bodyObj);
  const auth = buildAuthToken(cfg, 'POST', urlPath, body, nonce, timestamp);
  const res = await f(`${cfg.baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

/** JSAPI 下单，返回 prepay_id。 */
export async function createJsapiOrder(cfg: WxPayConfig, params: JsapiOrderParams, deps: WxPayDeps = {}): Promise<{ prepayId: string }> {
  const { status, data } = await postSigned(
    cfg,
    '/v3/pay/transactions/jsapi',
    {
      appid: params.appid,
      mchid: cfg.mchid,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: cfg.notifyUrl,
      amount: { total: params.amountCents, currency: 'CNY' },
      payer: { openid: params.openid },
    },
    deps,
  );
  const prepayId = typeof data.prepay_id === 'string' ? data.prepay_id : '';
  if (!prepayId) {
    throw new Error(`wxpay jsapi order failed: ${String(data.code ?? status)} ${String(data.message ?? '')}`.trim());
  }
  return { prepayId };
}

async function getSigned(
  cfg: WxPayConfig,
  urlPath: string,
  deps: WxPayDeps,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const f = deps.fetch ?? fetch;
  const nonce = (deps.nonce ?? defaultNonce)();
  const timestamp = (deps.timestamp ?? defaultTimestamp)();
  const auth = buildAuthToken(cfg, 'GET', urlPath, '', nonce, timestamp); // GET 签名 body 为空串
  const res = await f(`${cfg.baseUrl}${urlPath}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: auth },
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

export interface WxOrderState {
  tradeState: string; // SUCCESS / NOTPAY / CLOSED / ...
  transactionId: string;
  amountTotal: number | null;
}

/**
 * 主动查单（notify 兜底）：按 out_trade_no 查询微信订单真实状态。
 * notify 是 best-effort、可能延迟/丢失；查单是权威结算依据，客户端支付后应主动查。
 */
export async function queryOrderByOutTradeNo(cfg: WxPayConfig, outTradeNo: string, deps: WxPayDeps = {}): Promise<WxOrderState> {
  const urlPath = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${cfg.mchid}`;
  const { data } = await getSigned(cfg, urlPath, deps);
  const amount = data.amount as { total?: number } | undefined;
  return {
    tradeState: typeof data.trade_state === 'string' ? data.trade_state : '',
    transactionId: typeof data.transaction_id === 'string' ? data.transaction_id : '',
    amountTotal: typeof amount?.total === 'number' ? amount.total : null,
  };
}

/** 客户端调起支付参数（wx.requestPayment / WeixinJSBridge 通用，服务号与小程序同构）。 */
export function buildPayParams(cfg: WxPayConfig, appId: string, prepayId: string, deps: WxPayDeps = {}): JsapiPayParams {
  const timeStamp = (deps.timestamp ?? defaultTimestamp)();
  const nonceStr = (deps.nonce ?? defaultNonce)();
  const pkg = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  return {
    appId,
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign: rsaSign(message, cfg.privateKey),
  };
}

/** 验回调签名（微信支付平台证书公钥 RSA-SHA256）。 */
export function verifyNotifySignature(cfg: WxPayConfig, headers: WxNotifyHeaders, rawBody: string): boolean {
  if (!cfg.platformPublicKey) return false;
  const message = `${headers.timestamp}\n${headers.nonce}\n${rawBody}\n`;
  try {
    return createVerify('RSA-SHA256').update(message).end().verify(cfg.platformPublicKey, headers.signature, 'base64');
  } catch {
    return false;
  }
}

/** AES-256-GCM 解密回调 resource。 */
export function decryptResource(apiV3Key: string, resource: WxResource): string {
  const key = Buffer.from(apiV3Key, 'utf8');
  const data = Buffer.from(resource.ciphertext, 'base64');
  const authTag = data.subarray(data.length - 16);
  const cipher = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
}

/** 退款。 */
export async function createRefund(cfg: WxPayConfig, params: RefundParams, deps: WxPayDeps = {}): Promise<{ status: string }> {
  const { status, data } = await postSigned(
    cfg,
    '/v3/refund/domestic/refunds',
    {
      transaction_id: params.transactionId,
      out_refund_no: params.outRefundNo,
      reason: params.reason,
      notify_url: cfg.notifyUrl,
      amount: { refund: params.amountCents, total: params.amountCents, currency: 'CNY' },
    },
    deps,
  );
  const refundStatus = typeof data.status === 'string' ? data.status : '';
  if (!refundStatus) {
    throw new Error(`wxpay refund failed: ${String(data.code ?? status)} ${String(data.message ?? '')}`.trim());
  }
  return { status: refundStatus };
}
