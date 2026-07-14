import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOpenidToken } from '@/lib/api/openid-token';
import { req } from './_utils';

const originalFetch = globalThis.fetch;

/** 从 /pay?t=<token> 提取 token 并验签出 openid（R4：openid 不再明文进 URL）。 */
function openidFromRedirect(location: string): string | null {
  const t = new URL(location).searchParams.get('t');
  return verifyOpenidToken(t, Date.now());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.WXPAY_SERVICE_APPID;
  delete process.env.WXPAY_SERVICE_SECRET;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  globalThis.fetch = originalFetch;
});

function loc(res: Response): string {
  return res.headers.get('location') ?? '';
}

describe('GET /api/wx/oauth', () => {
  it('START mock mode mints openid and redirects to /pay', async () => {
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?sku=deep_report&reportId=r-1'));
    expect(res.status).toBe(307);
    const l = loc(res);
    expect(l).toContain('/pay?');
    expect(l).not.toContain('openid='); // R4：明文 openid 不进 URL
    expect(openidFromRedirect(l)).toMatch(/^mock_/);
    expect(l).toContain('sku=deep_report');
    expect(l).toContain('reportId=r-1');
  });

  it('CALLBACK mock mode resolves openid from code + state', async () => {
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=abc&state=final_column.r-9'));
    const l = loc(res);
    expect(openidFromRedirect(l)).toMatch(/^mock_/);
    expect(l).toContain('sku=final_column');
    expect(l).toContain('reportId=r-9');
  });

  it('CALLBACK real mode exchanges code for openid', async () => {
    process.env.WXPAY_SERVICE_APPID = 'wxsvc';
    process.env.WXPAY_SERVICE_SECRET = 'secret';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ openid: 'wx-oid' }))) as unknown as typeof fetch;
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=realcode&state=deep_report.r-2'));
    const l = loc(res);
    expect(l).not.toContain('openid=wx-oid'); // 明文 openid 不进 URL
    expect(openidFromRedirect(l)).toBe('wx-oid'); // 验签后取回
    expect(l).toContain('sku=deep_report');
    expect(String((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toContain('sns/oauth2/access_token');
  });

  it('CALLBACK real mode redirects with err when no openid', async () => {
    process.env.WXPAY_SERVICE_APPID = 'wxsvc';
    process.env.WXPAY_SERVICE_SECRET = 'secret';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 40029 }))) as unknown as typeof fetch;
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=bad&state=deep_report.r-3'));
    const l = loc(res);
    expect(l).toContain('err=oauth_failed');
    expect(l).not.toContain('openid=');
  });

  it('START real mode redirects to WeChat authorize', async () => {
    process.env.WXPAY_SERVICE_APPID = 'wxsvc';
    process.env.WXPAY_SERVICE_SECRET = 'secret';
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?sku=deep_report&reportId=r-4'));
    const l = loc(res);
    expect(l).toContain('open.weixin.qq.com/connect/oauth2/authorize');
    expect(l).toContain('appid=wxsvc');
    expect(l).toContain('scope=snsapi_base');
    expect(l).toContain('state=deep_report.r-4');
  });

  it('CALLBACK creates DB user record before redirecting to pay', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    const upserts: Record<string, unknown>[] = [];
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => userClient(upserts) }));
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=db-user&state=deep_report.r-5'));
    const l = loc(res);
    expect(openidFromRedirect(l)).toMatch(/^mock_/);
    expect(upserts[0]?.wx_openid).toMatch(/^mock_/);
  });

  it('CALLBACK redirects with profile_failed when DB user creation fails', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => userClient([], 'db down') }));
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=db-fail&state=deep_report.r-6'));
    const l = loc(res);
    expect(l).toContain('err=profile_failed');
    expect(l).not.toContain('openid=');
  });

  // iOS 球迷形象 H5:to=avatar 回跳 /avatar(新 state 格式 avatar~sku~reportId)
  it('START to=avatar mints openid and redirects to /avatar (not /pay)', async () => {
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?to=avatar&sku=avatar_card'));
    const l = loc(res);
    expect(l).toContain('/avatar?');
    expect(l).not.toContain('/pay?');
    expect(l).not.toContain('openid=');
    expect(openidFromRedirect(l)).toMatch(/^mock_/);
    expect(l).toContain('sku=avatar_card');
  });

  it('CALLBACK avatar state redirects back to /avatar', async () => {
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?code=abc&state=avatar~avatar_card~'));
    const l = loc(res);
    expect(l).toContain('/avatar?');
    expect(openidFromRedirect(l)).toMatch(/^mock_/);
    expect(l).toContain('sku=avatar_card');
  });

  it('START real mode to=avatar carries avatar state to WeChat authorize', async () => {
    process.env.WXPAY_SERVICE_APPID = 'wxsvc';
    process.env.WXPAY_SERVICE_SECRET = 'secret';
    const { GET } = await loadOauth();
    const res = await GET(req('/api/wx/oauth?to=avatar&sku=avatar_card'));
    const l = loc(res);
    expect(l).toContain('open.weixin.qq.com/connect/oauth2/authorize');
    expect(decodeURIComponent(l)).toContain('state=avatar~avatar_card~');
  });
});

async function loadOauth() {
  return import('@/app/api/wx/oauth/route');
}

function userClient(upserts: Record<string, unknown>[], upsertError?: string) {
  return {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: upsertError ? null : { id: 'user-1', wx_openid: row.wx_openid },
              error: upsertError ? { message: upsertError } : null,
            }),
          }),
        };
      },
    }),
  };
}
