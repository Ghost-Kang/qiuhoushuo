import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/admin/ban-ip/route';
import { middleware } from '@/middleware';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  __resetQuotaMemoryForTests();
  delete process.env.ADMIN_TOKEN;
});

describe('/api/admin/ban-ip', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(req('/api/admin/ban-ip', { method: 'POST', body: JSON.stringify(body()) }));
    expect(res.status).toBe(401);
  });

  it('rejects invalid ip format', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(adminReq({ ...body(), ip: 'not-ip' }));
    expect(res.status).toBe(400);
  });

  it('rejects ttl out of range', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(adminReq({ ...body(), ttl_seconds: 86401 }));
    expect(res.status).toBe(400);
  });

  it('bans ip and middleware honors it', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ banned: '1.2.3.4' });
    const blocked = await middleware(new NextRequest('http://localhost/api/me', { headers: { 'x-forwarded-for': '1.2.3.4' } }));
    expect(blocked.status).toBe(403);
  });

  it('rejects payload > 2KB', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await POST(adminReq({ ...body(), reason: 'a'.repeat(3 * 1024) }));
    expect(res.status).toBe(413);
  });
});

function adminReq(payload: unknown) {
  return req('/api/admin/ban-ip', { method: 'POST', headers: { 'x-admin-token': 'secret' }, body: JSON.stringify(payload) });
}

function body() {
  return { ip: '1.2.3.4', ttl_seconds: 3600, reason: 'rate-limit flood' };
}
