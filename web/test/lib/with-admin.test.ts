import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withAdmin, withAdminGet } from '@/lib/api/with-admin';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { json, req } from '../api/_utils';

const Body = z.object({ name: z.string().min(2) }).strict();

afterEach(() => {
  vi.restoreAllMocks();
  __resetQuotaMemoryForTests();
  delete process.env.ADMIN_TOKEN;
});

describe('withAdmin', () => {
  it('rejects when rate limit exceeded', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const post = withAdmin(Body, async () => Response.json({ ok: true }));
    let res: Response | undefined;
    for (let i = 0; i < 11; i += 1) {
      res = await post(adminReq({ name: 'ok' }));
    }
    expect(res!.status).toBe(429);
    expect(await json(res!)).toMatchObject({ error: 'RATE_LIMIT_ADMIN' });
  });

  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const post = withAdmin(Body, async () => Response.json({ ok: true }));
    const res = await post(req('/api/admin/test', { method: 'POST', body: JSON.stringify({ name: 'ok' }) }));
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'NO_AUTH' });
  });

  it('rejects oversized body', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const post = withAdmin(Body, async () => Response.json({ ok: true }), { bodyLimitBytes: 16 });
    const res = await post(adminReq({ name: 'x'.repeat(100) }));
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: 'PAYLOAD_TOO_LARGE', limit: 16 });
  });

  it('rejects body failing zod', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const post = withAdmin(Body, async () => Response.json({ ok: true }));
    const res = await post(adminReq({ name: 'x' }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'BAD_REQUEST' });
  });

  it('calls handler with parsed body and ip when all checks pass', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const handler = vi.fn(async ({ body, ip }) => Response.json({ body, ip }));
    const post = withAdmin(Body, handler);
    const res = await post(adminReq({ name: 'ok' }, { 'x-forwarded-for': '9.8.7.6, 1.1.1.1' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ body: { name: 'ok' }, ip: '9.8.7.6' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('catches synchronous handler throw and returns 500 with requestId', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const post = withAdmin(Body, () => {
      throw new Error('sync boom');
    });
    const res = await post(adminReq({ name: 'ok' }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ error: 'INTERNAL' });
    expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[admin] handler failed:', 'sync boom');
  });

  it('catches async handler rejection and returns 500 with requestId', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const post = withAdmin(Body, async () => {
      throw new Error('async boom');
    });
    const res = await post(adminReq({ name: 'ok' }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ error: 'INTERNAL' });
    expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[admin] handler failed:', 'async boom');
  });
});

describe('withAdminGet', () => {
  it('skips body parsing and zod', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const handler = vi.fn(async ({ ip }) => Response.json({ ok: true, ip }));
    const get = withAdminGet(handler);
    const res = await get(req('/api/admin/test', { headers: { 'x-admin-token': 'secret', 'x-real-ip': '5.5.5.5' } }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, ip: '5.5.5.5' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('catches synchronous handler throw and returns 500 with requestId', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = withAdminGet(() => {
      throw new Error('sync boom');
    });
    const res = await get(req('/api/admin/test', { headers: { 'x-admin-token': 'secret' } }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ error: 'INTERNAL' });
    expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[admin] handler failed:', 'sync boom');
  });

  it('catches async handler rejection and returns 500 with requestId', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = withAdminGet(async () => {
      throw new Error('async boom');
    });
    const res = await get(req('/api/admin/test', { headers: { 'x-admin-token': 'secret' } }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ error: 'INTERNAL' });
    expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[admin] handler failed:', 'async boom');
  });
});

function adminReq(payload: unknown, headers: Record<string, string> = {}) {
  return req('/api/admin/test', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret', ...headers },
    body: JSON.stringify(payload),
  });
}
