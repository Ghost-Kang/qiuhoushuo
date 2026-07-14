import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { json, req } from './_utils';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.WX_APPID;
  delete process.env.WX_SECRET;
  delete process.env.FEATURE_FLAG_INTERNAL_ONLY;
  delete process.env.FEATURE_FLAG_PUBLIC_REGISTER;
  delete process.env.INTERNAL_ALLOWED_OPENIDS;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  __resetFlagsForTests();
});

describe('/api/wx/login', () => {
  it('returns deterministic mock openid', async () => {
    const { POST } = await import('@/app/api/wx/login/route');
    const body = await json(await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'abc' }) })));
    expect(body.openid).toMatch(/^mock_/);
  });

  it('rejects bad body', async () => {
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: '' }) }));
    expect(res.status).toBe(400);
  });

  it('does not require x-openid', async () => {
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'no-auth-needed' }) }));
    expect(res.status).toBe(200);
  });

  it('matches miniprogram login shape', async () => {
    const { POST } = await import('@/app/api/wx/login/route');
    const body = await json(await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'shape' }) })));
    expect(Object.keys(body)).toEqual(['openid']);
  });

  it('calls WeChat jscode2session when configured', async () => {
    process.env.WX_APPID = 'appid';
    process.env.WX_SECRET = 'secret';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ openid: 'wx-openid' })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { POST } = await import('@/app/api/wx/login/route');
    const body = await json(await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'wx-code' }) })));
    expect(body).toEqual({ openid: 'wx-openid' });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('jscode2session');
  });

  it('returns bad request when WeChat response has no openid', async () => {
    process.env.WX_APPID = 'appid';
    process.env.WX_SECRET = 'secret';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 40029 }))) as unknown as typeof fetch;
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'bad-wx-code' }) }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'BAD_REQUEST', details: { wx: 40029 } });
  });

  it('returns bad request when request body stream fails', async () => {
    const { POST } = await import('@/app/api/wx/login/route');
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      duplex: 'half',
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('stream down'));
        },
      }),
    };
    const res = await POST(new Request('http://localhost/api/wx/login', init));
    expect(res.status).toBe(400);
  });

  it('allows arbitrary openid when internal_only flag is disabled', async () => {
    process.env.FEATURE_FLAG_INTERNAL_ONLY = '0';
    __resetFlagsForTests();
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'public-user' }) }));
    expect(res.status).toBe(200);
  });

  it('allows whitelisted openid when internal_only flag is enabled', async () => {
    const openid = mockOpenidForCode('allowed-user');
    process.env.FEATURE_FLAG_INTERNAL_ONLY = '100';
    process.env.INTERNAL_ALLOWED_OPENIDS = `other, ${openid}`;
    __resetFlagsForTests();
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'allowed-user' }) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ openid });
  });

  it('rejects non-whitelisted openid when internal_only flag is enabled', async () => {
    process.env.FEATURE_FLAG_INTERNAL_ONLY = '100';
    process.env.INTERNAL_ALLOWED_OPENIDS = 'mock_someone_else';
    __resetFlagsForTests();
    const { POST } = await import('@/app/api/wx/login/route');
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'blocked-user' }) }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'BAD_REQUEST', details: { phase: 'INTERNAL_TEST_ONLY' } });
  });

  it('rejects new DB user when public_register flag is disabled', async () => {
    process.env.FEATURE_FLAG_PUBLIC_REGISTER = '0';
    const { POST, upserts } = await loadDbRoute({ existing: false });
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'new-user' }) }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'BAD_REQUEST', details: { phase: 'REGISTRATION_CLOSED' } });
    expect(upserts).toEqual([]);
  });

  it('allows existing DB user when public_register flag is disabled', async () => {
    process.env.FEATURE_FLAG_PUBLIC_REGISTER = '0';
    const openid = mockOpenidForCode('existing-user');
    const { POST, upserts } = await loadDbRoute({ existing: true });
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'existing-user' }) }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ wx_openid: openid });
  });

  it('lets internal whitelist bypass public_register=0 before DB registration check', async () => {
    const openid = mockOpenidForCode('whitelist-new-user');
    process.env.FEATURE_FLAG_INTERNAL_ONLY = '100';
    process.env.FEATURE_FLAG_PUBLIC_REGISTER = '0';
    process.env.INTERNAL_ALLOWED_OPENIDS = openid;
    const { POST, upserts } = await loadDbRoute({ existing: false });
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'whitelist-new-user' }) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ openid });
    expect(upserts[0]).toMatchObject({ wx_openid: openid });
  });

  it('creates a DB user record when public registration is open', async () => {
    process.env.FEATURE_FLAG_PUBLIC_REGISTER = '100';
    const openid = mockOpenidForCode('fresh-open-user');
    const { POST, upserts } = await loadDbRoute({ existing: false });
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'fresh-open-user' }) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ openid });
    expect(upserts[0]).toMatchObject({ wx_openid: openid });
    expect(typeof upserts[0]?.last_active_at).toBe('string');
  });

  it('returns 500 when DB user upsert fails after login gates pass', async () => {
    process.env.FEATURE_FLAG_PUBLIC_REGISTER = '100';
    const { POST } = await loadDbRoute({ existing: false, upsertError: 'db down' });
    const res = await POST(req('/api/wx/login', { method: 'POST', body: JSON.stringify({ code: 'upsert-fail' }) }));
    expect(res.status).toBe(500);
  });
});

async function loadDbRoute(opts: { existing: boolean; upsertError?: string }) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  __resetFlagsForTests();
  const upserts: Record<string, unknown>[] = [];
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => userClient(opts, upserts) }));
  const route = await import('@/app/api/wx/login/route');
  return { ...route, upserts };
}

function userClient(opts: { existing: boolean; upsertError?: string }, upserts: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.existing ? { id: 'user-1' } : null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: opts.upsertError ? null : { id: 'user-1', wx_openid: row.wx_openid },
              error: opts.upsertError ? { message: opts.upsertError } : null,
            }),
          }),
        };
      },
    }),
  };
}

function mockOpenidForCode(code: string) {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
  return `mock_${hash}`;
}
