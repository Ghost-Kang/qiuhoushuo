import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireOpenidSignKey } from './internal-token';

/**
 * 签名 openid token（架构审视 R4）。
 *
 * 服务号 H5 OAuth 回跳不再把 openid 明文塞 URL query（泄露点），改塞 HMAC 签名 token；
 * 支付下单验签后取 openid，既消除明文泄露、又让该 openid 不可伪造。
 * 格式：base64url(openid).exp.base64url(HMAC-SHA256)
 */

const DEFAULT_TTL_SECONDS = 30 * 60;

function signKey(env: NodeJS.ProcessEnv): string {
  return requireOpenidSignKey(env);
}

function hmac(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function constEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function signOpenidToken(
  openid: string,
  nowMs: number,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${Buffer.from(openid, 'utf8').toString('base64url')}.${exp}`;
  return `${payload}.${hmac(payload, signKey(env))}`;
}

export function verifyOpenidToken(
  token: string | null | undefined,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const encOpenid = parts[0] ?? '';
  const expStr = parts[1] ?? '';
  const sig = parts[2] ?? '';
  const payload = `${encOpenid}.${expStr}`;
  if (!constEq(sig, hmac(payload, signKey(env)))) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return null;
  try {
    const openid = Buffer.from(encOpenid, 'base64url').toString('utf8');
    return openid.length > 0 ? openid : null;
  } catch {
    return null;
  }
}
