import { afterEach, describe, expect, it, vi } from 'vitest';

const UUID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.WXPAY_SERVICE_APPID;
  delete process.env.WXPAY_SERVICE_SECRET;
});

function reqWith(token: string | undefined, body: unknown) {
  return new Request('http://localhost/api/admin/mp-draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const REPORT_ROW = {
  id: 'rid-duanzi', style: 'duanzi', title: '标题', lead: '导语', body: ['段一', '段二'], share_quote: '金句',
  matches: { short_code: '8a3f', home_team: 'Brazil', away_team: 'Spain', home_score: 2, away_score: 1, competition: 'C' },
};

function mockDeps({ rows = [REPORT_ROW], bytes = Buffer.from('img') } = {}) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) }),
  }));
  vi.doMock('@/lib/api/card-storage', () => ({
    getCardStorage: () => ({ getBytes: async () => bytes }),
    CARD_RENDER_CACHE_VERSION: 'v31',
  }));
}

describe('POST /api/admin/mp-draft', () => {
  it('未配 ADMIN_API_SECRET → 503', async () => {
    mockDeps();
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    expect((await POST(reqWith('x', { match_id: UUID }))).status).toBe(503);
  });

  it('错 token → 401', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps();
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    expect((await POST(reqWith('wrong', { match_id: UUID }))).status).toBe(401);
  });

  it('坏 body(非 uuid)→ 400', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps();
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    expect((await POST(reqWith('secret', { match_id: 'nope' }))).status).toBe(400);
  });

  it('无战报 → 404', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps({ rows: [] });
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    expect((await POST(reqWith('secret', { match_id: UUID }))).status).toBe(404);
  });

  function stubWxFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes('cgi-bin/token') ? { access_token: 'TK', expires_in: 7200 }
        : u.includes('add_material') ? { media_id: 'COVER' }
        : u.includes('uploadimg') ? { url: 'https://mmbiz.qpic.cn/x.png' }
        : u.includes('draft/add') ? { media_id: 'DRAFT1' }
        : { errcode: -1 };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
  }

  it('happy:推草稿成功 → 200 + draftId', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.WXPAY_SERVICE_APPID = 'a';
    process.env.WXPAY_SERVICE_SECRET = 's';
    mockDeps();
    stubWxFetch();
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    const res = await POST(reqWith('secret', { match_id: UUID, style: 'duanzi' }));
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; draftId: string };
    expect(j.ok).toBe(true);
    expect(j.draftId).toBe('DRAFT1');
  });

  it('all:true → 推三版 + 给管理员发汇总提醒', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.WXPAY_SERVICE_APPID = 'a';
    process.env.WXPAY_SERVICE_SECRET = 's';
    const rows = ['hardcore', 'duanzi', 'emotion'].map((style) => ({ ...REPORT_ROW, id: `rid-${style}`, style }));
    mockDeps({ rows });
    const notify = vi.fn();
    vi.doMock('@/lib/alerts', () => ({ notifyOpsFireAndForget: notify }));
    stubWxFetch();
    const { POST } = await import('@/app/api/admin/mp-draft/route');
    const res = await POST(reqWith('secret', { match_id: UUID, all: true }));
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; results: { style: string; ok: boolean }[] };
    expect(j.ok).toBe(true);
    expect(j.results.map((r) => r.style)).toEqual(['hardcore', 'duanzi', 'emotion']);
    expect(notify).toHaveBeenCalledOnce();
    expect((notify.mock.calls[0]![0] as { tags: string[] }).tags).toContain('mp-draft');
  });
});
