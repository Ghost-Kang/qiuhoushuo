import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetQuotaMemoryForTests();
  delete process.env.ADMIN_TOKEN;
});

describe('/api/admin/banlist', () => {
  it('rejects GET without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await import('@/app/api/admin/banlist/route');
    expect((await GET(req('/api/admin/banlist'))).status).toBe(401);
  });

  it('adds, lists, and deletes an IP ban', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET, POST, DELETE } = await import('@/app/api/admin/banlist/route');
    const headers = { 'x-admin-token': 'secret' };
    expect((await POST(req('/api/admin/banlist', { method: 'POST', headers, body: JSON.stringify({ ip: '1.2.3.4', reason: 'manual-test' }) }))).status).toBe(200);
    const listed = await json(await GET(req('/api/admin/banlist', { headers })));
    expect(listed.items).toEqual([{ ip: '1.2.3.4', reason: 'manual-test' }]);
    expect((await DELETE(req('/api/admin/banlist', { method: 'DELETE', headers, body: JSON.stringify({ ip: '1.2.3.4' }) }))).status).toBe(200);
    expect(await json(await GET(req('/api/admin/banlist', { headers })))).toEqual({ items: [] });
  });

  it('defaults reason to manual and rejects unknown fields', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET, POST } = await import('@/app/api/admin/banlist/route');
    const headers = { 'x-admin-token': 'secret' };
    await POST(req('/api/admin/banlist', { method: 'POST', headers, body: JSON.stringify({ ip: '5.6.7.8' }) }));
    expect((await json(await GET(req('/api/admin/banlist', { headers })))).items[0]).toEqual({ ip: '5.6.7.8', reason: 'manual' });
    const bad = await POST(req('/api/admin/banlist', { method: 'POST', headers, body: JSON.stringify({ ip: '5.6.7.8', extra: true }) }));
    expect(bad.status).toBe(400);
  });

  it('rejects invalid JSON on DELETE', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { DELETE } = await import('@/app/api/admin/banlist/route');
    const res = await DELETE(req('/api/admin/banlist', { method: 'DELETE', headers: { 'x-admin-token': 'secret' }, body: '{bad' }));
    expect(res.status).toBe(400);
  });

  it('rejects POST without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await import('@/app/api/admin/banlist/route');
    const res = await POST(req('/api/admin/banlist', { method: 'POST', body: JSON.stringify({ ip: '1.2.3.4' }) }));
    expect(res.status).toBe(401);
  });

  it('rejects DELETE without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { DELETE } = await import('@/app/api/admin/banlist/route');
    const res = await DELETE(req('/api/admin/banlist', { method: 'DELETE', body: JSON.stringify({ ip: '1.2.3.4' }) }));
    expect(res.status).toBe(401);
  });

  it('rejects POST when ADMIN_TOKEN env not set (production boot guard)', async () => {
    delete process.env.ADMIN_TOKEN;
    const { POST } = await import('@/app/api/admin/banlist/route');
    const res = await POST(req('/api/admin/banlist', { method: 'POST', headers: { 'x-admin-token': 'anything' }, body: JSON.stringify({ ip: '1.2.3.4' }) }));
    expect(res.status).toBe(401);
  });

  it('rejects POST with invalid JSON body', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await import('@/app/api/admin/banlist/route');
    const res = await POST(req('/api/admin/banlist', { method: 'POST', headers: { 'x-admin-token': 'secret' }, body: '{not json' }));
    expect(res.status).toBe(400);
  });
});
