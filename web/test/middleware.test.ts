import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware, signIdempotencyBypass } from '@/middleware';
import { costKey } from '@/lib/api/cost-meter';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { __resetQuotaMemoryForTests, setValue } from '@/lib/api/quota-store';
import { GET as getQuotas } from '@/app/api/admin/quotas/route';
import { GET as getBanlist } from '@/app/api/admin/banlist/route';

function nextReq(path: string, init: RequestInit = {}) {
  return new NextRequest(new Request(`http://localhost${path}`, init));
}

async function body(res: Response) {
  return res.json() as Promise<any>;
}

afterEach(() => {
  __resetQuotaMemoryForTests();
  vi.restoreAllMocks();
  delete process.env.ADMIN_TOKEN;
  delete process.env.IDEMPOTENCY_HMAC_KEY;
  delete process.env.FEATURE_FLAG_FINALS_MODE;
  delete process.env.MAX_API_IN_FLIGHT;
  __resetFlagsForTests();
});

describe('api middleware quotas', () => {
  it('limits one openid at 61 requests', async () => {
    let res: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      res = await middleware(nextReq('/api/me', { headers: { 'x-openid': 'u1', 'x-forwarded-for': `10.0.0.${i}` } }));
    }
    expect(res!.status).toBe(429);
    expect(await body(res!)).toMatchObject({ error: 'RATE_LIMIT_USER' });
  });

  it('limits one IP after 200 requests', async () => {
    let res: Response | undefined;
    for (let i = 0; i < 201; i += 1) {
      res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '10.0.0.9' } }));
    }
    expect(res!.status).toBe(429);
    expect(await body(res!)).toEqual({ error: 'RATE_LIMIT_IP' });
  });

  it('replays the same idempotency key without fetching twice', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true, n: 1 }));
    const init = { method: 'POST', headers: { 'x-openid': 'u1', 'x-idempotency-key': 'abc' }, body: JSON.stringify({ a: 1 }) };
    const first = await middleware(nextReq('/api/track', init));
    const second = await middleware(nextReq('/api/track', init));
    expect(await body(first)).toEqual({ ok: true, n: 1 });
    expect(await body(second)).toEqual({ ok: true, n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks banned IPs', async () => {
    await setValue('ban:ip:1.2.3.4', 'manual', 300);
    const res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '1.2.3.4' } }));
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: 'BANNED' });
  });

  it('rejects external x-idempotency-bypass header', async () => {
    await setValue('ban:ip:1.2.3.4', 'manual', 300);
    const res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-idempotency-bypass': '1' } }));
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: 'BANNED' });
  });

  it('rejects bypass without valid HMAC', async () => {
    await setValue('ban:ip:1.2.3.4', 'manual', 300);
    const res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-idempotency-bypass': 'bad', 'x-idempotency-bypass-ts': String(Date.now()) } }));
    expect(res.status).toBe(403);
  });

  it('accepts bypass with valid HMAC', async () => {
    process.env.IDEMPOTENCY_HMAC_KEY = 'test-secret';
    await setValue('ban:ip:1.2.3.4', 'manual', 300);
    const ts = String(Date.now());
    const sig = await signIdempotencyBypass(ts);
    const res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-idempotency-bypass': sig, 'x-idempotency-bypass-ts': ts } }));
    expect(res.status).toBe(200);
  });

  it('blocks when the global in-flight counter is full', async () => {
    await setValue('global:inflight', '100', 30);
    const res = await middleware(nextReq('/api/me', { headers: { 'x-openid': 'u1' } }));
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ error: 'OVERLOAD' });
  });

  it('applies finals thresholds when feature.finals_mode=100', async () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    __resetFlagsForTests();
    let res: Response | undefined;
    for (let i = 0; i < 201; i += 1) {
      res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '10.0.0.10' } }));
    }
    expect(res!.status).toBe(200);
  });

  it('applies normal thresholds when feature.finals_mode disabled', async () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '0';
    __resetFlagsForTests();
    let res: Response | undefined;
    for (let i = 0; i < 201; i += 1) {
      res = await middleware(nextReq('/api/me', { headers: { 'x-forwarded-for': '10.0.0.11' } }));
    }
    expect(res!.status).toBe(429);
    expect(await body(res!)).toEqual({ error: 'RATE_LIMIT_IP' });
  });

  it('MAX_API_IN_FLIGHT env override is honored above finals threshold', async () => {
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    process.env.MAX_API_IN_FLIGHT = '600';
    __resetFlagsForTests();
    await setValue('global:inflight', '500', 30);
    const allowed = await middleware(nextReq('/api/me', { headers: { 'x-openid': 'u1' } }));
    expect(allowed.status).toBe(200);
    await setValue('global:inflight', '600', 30);
    const blocked = await middleware(nextReq('/api/me', { headers: { 'x-openid': 'u2' } }));
    expect(blocked.status).toBe(503);
  });

  it('blocks report detail when cost cap is reached only there', async () => {
    await setValue(costKey(), '50000', 300);
    const blocked = await middleware(nextReq('/api/report/abc', { headers: { 'x-openid': 'u1' } }));
    const allowed = await middleware(nextReq('/api/me', { headers: { 'x-openid': 'u1' } }));
    expect(blocked.status).toBe(503);
    expect(await body(blocked)).toMatchObject({ error: 'COST_CAP' });
    expect(allowed.status).toBe(200);
  });

  it('rejects admin requests with a wrong token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const bad = new Request('http://localhost/api/admin/quotas', { headers: { 'x-admin-token': 'bad' } });
    expect((await getQuotas(bad)).status).toBe(401);
    expect((await getBanlist(bad)).status).toBe(401);
  });

  it('quotas snapshot returns expected shape', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    await setValue('global:inflight', '23', 300);
    await setValue('rl:user:abc', '142', 300);
    await setValue('meter:limited:5m', '3', 300);
    const res = await getQuotas(new Request('http://localhost/api/admin/quotas', { headers: { 'x-admin-token': 'secret' } }));
    expect(await body(res)).toMatchObject({
      in_flight: 23,
      cost_cap_cny: 500,
      top_users_by_req: [{ openid: 'abc', count: 142 }],
      rate_limited_count_5min: 3,
    });
  });
});
