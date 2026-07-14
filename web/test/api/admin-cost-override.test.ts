import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/admin/cost-override/route';
import { middleware } from '@/middleware';
import { costKey } from '@/lib/api/cost-meter';
import { __resetQuotaMemoryForTests, setValue } from '@/lib/api/quota-store';
import { json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  __resetQuotaMemoryForTests();
  delete process.env.ADMIN_TOKEN;
});

describe('/api/admin/cost-override', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(req('/api/admin/cost-override', { method: 'POST', body: JSON.stringify(body()) }));
    expect(res.status).toBe(401);
  });

  it('overrides cap and middleware honors it', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    await setValue(costKey(), '60000', 300);
    const before = await middleware(nextReq('/api/report/abc'));
    expect(before.status).toBe(503);
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ active_cap_cny: 8000 });
    const after = await middleware(nextReq('/api/report/abc'));
    expect(after.status).toBe(200);
  });

  it('override expires after ttl', async () => {
    await setValue('cost-cap-override', '8000', 1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1100);
    await setValue(costKey(), '60000', 300);
    const res = await middleware(nextReq('/api/report/abc'));
    expect(res.status).toBe(503);
    vi.useRealTimers();
  });

  it('rejects payload > 2KB', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(adminReq({ ...body(), reason: 'a'.repeat(3 * 1024) }));
    expect(res.status).toBe(413);
  });
});

function adminReq(payload: unknown) {
  return req('/api/admin/cost-override', { method: 'POST', headers: { 'x-admin-token': 'secret' }, body: JSON.stringify(payload) });
}

function nextReq(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { 'x-openid': 'u1' } });
}

function body() {
  return { cap_cny: 8000, ttl_seconds: 3600, reason: 'finals day surge' };
}
