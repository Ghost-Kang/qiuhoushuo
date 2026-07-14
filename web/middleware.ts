import { NextRequest, NextResponse } from 'next/server';
import { getDailyCost } from './lib/api/cost-meter';
import { getValue, incrBy, incrWindow, setValue } from './lib/api/quota-store';
import { maybeAlertCostCap } from './lib/api/cost-alert';
import { maybeAlertInFlightCap } from './lib/api/in-flight-alert';
import { maybeAlertRateLimitFlood } from './lib/api/rate-limit-alert';
import { currentThresholds } from './lib/api/finals-mode';

export const config = { matcher: ['/api/:path*'] };

const IDEMPOTENCY_HMAC_TTL_MS = 5 * 60 * 1000;

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (await hasValidIdempotencyBypass(req)) return NextResponse.next();

  const ip = clientIp(req);
  if (await getValue(`ban:ip:${ip}`)) return json({ error: 'BANNED' }, 403);

  const t = currentThresholds();
  const maxInFlight = maxInFlightCap(t.maxInFlight);
  const inFlight = await incrBy('global:inflight', 1, 30);
  if (inFlight > maxInFlight) {
    const limitedCount = await incrBy('meter:limited:5m', 1, 300);
    await maybeAlertRateLimitFlood(limitedCount);
    await maybeAlertInFlightCap(inFlight, maxInFlight);
    await incrBy('global:inflight', -1, 30);
    return json({ error: 'OVERLOAD' }, 503);
  }

  try {
    const openid = req.headers.get('x-openid') || 'anonymous';
    const user = await incrWindow(`rl:user:${openid}`, 60);
    if (openid !== 'anonymous' && user.count > t.rateLimitPerUserPerMin) return limited('RATE_LIMIT_USER', user.retryAfter);

    const byIp = await incrWindow(`rl:ip:${ip}`, 60);
    if (byIp.count > t.rateLimitPerIpPerMin) return limited('RATE_LIMIT_IP');

    if (/^\/api\/report\/[^/]+$/.test(pathname)) {
      const dailyCost = await getDailyCost();
      const override = await getValue('cost-cap-override');
      const effectiveCap = override ? Number(override) : t.costCapCny;
      await maybeAlertCostCap(dailyCost, effectiveCap);
      if (dailyCost >= effectiveCap) {
        return json({ error: 'COST_CAP', message: '今日内容生成已达上限' }, 503);
      }
    }

    if (req.method === 'POST') {
      const idem = req.headers.get('x-idempotency-key');
      if (idem) return handleIdempotency(req, openid, idem);
    }

    return NextResponse.next();
  } finally {
    await incrBy('global:inflight', -1, 30);
  }
}

async function handleIdempotency(req: NextRequest, openid: string, idem: string) {
  const key = `idem:${openid}:${idem}`;
  const cached = await getValue(key);
  if (cached) {
    const parsed = JSON.parse(cached);
    return json(parsed.body, parsed.status);
  }
  const headers = new Headers(req.headers);
  const timestamp = String(Date.now());
  headers.set('x-idempotency-bypass-ts', timestamp);
  headers.set('x-idempotency-bypass', await signIdempotencyBypass(timestamp));
  const res = await fetch(new Request(req.url, { method: req.method, headers, body: req.body, duplex: 'half' } as RequestInit));
  const body = await res.clone().json().catch(() => ({}));
  await setValue(key, JSON.stringify({ status: res.status, body }), 300);
  return json(body, res.status);
}

async function limited(error: string, retryAfter?: number) {
  const limitedCount = await incrBy('meter:limited:5m', 1, 300);
  await maybeAlertRateLimitFlood(limitedCount);
  return json(retryAfter ? { error, retryAfter } : { error }, 429);
}

function clientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

function maxInFlightCap(defaultCap: number) {
  const envCap = Number(process.env.MAX_API_IN_FLIGHT || 0);
  return Math.max(Number.isFinite(envCap) ? envCap : 0, defaultCap);
}

async function hasValidIdempotencyBypass(req: NextRequest) {
  const signature = req.headers.get('x-idempotency-bypass');
  const timestamp = req.headers.get('x-idempotency-bypass-ts');
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > IDEMPOTENCY_HMAC_TTL_MS) return false;
  return timingSafeEqual(signature, await signIdempotencyBypass(timestamp));
}

export async function signIdempotencyBypass(timestamp: string) {
  const secret = process.env.IDEMPOTENCY_HMAC_KEY || 'dev-idempotency-hmac-key';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Timing-safe string equality for HMAC signature comparison.
 *
 * Why hand-rolled (not `node:crypto.timingSafeEqual`):
 * this module runs in the Next.js Edge runtime, where Node builtins such as
 * `node:crypto` are unavailable. Web Crypto has signing primitives, but no
 * direct timingSafeEqual equivalent for comparing the resulting strings.
 *
 * Contract:
 * - different lengths return false immediately; signature length is public
 * - equal lengths compare every code unit via XOR accumulation
 * - constant-time within JavaScript engine constraints
 *
 * @see web/lib/api/token-compare.ts for the Node runtime equivalent.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
