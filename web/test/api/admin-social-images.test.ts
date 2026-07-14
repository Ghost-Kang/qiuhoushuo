import { afterEach, describe, expect, it, vi } from 'vitest';

const UUID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

function reqWith(token: string | undefined, body: unknown) {
  return new Request('http://localhost/api/admin/social-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const fanPush = vi.fn(async () => {});
const costarPush = vi.fn(async () => {});

function mockDeps({ facts = { matchLabel: 'Brazil 2-1 Japan', star: 'Neymar', starTeam: '巴西' } as Record<string, unknown> | null, fan = true, costar = true } = {}) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}) }) }));
  vi.doMock('@/lib/api/social-content', () => ({
    loadSocialFactsFromDb: async () => facts,
    pushFanPortraitSamplesToWecom: fanPush,
    pushCostarShowcaseToWecom: costarPush,
    socialFanPortraitEnabled: () => fan,
    socialCostarShowcaseEnabled: () => costar,
  }));
}

describe('POST /api/admin/social-images', () => {
  it('未配 ADMIN_API_SECRET → 503', async () => {
    mockDeps();
    const { POST } = await import('@/app/api/admin/social-images/route');
    expect((await POST(reqWith('x', { match_id: UUID }))).status).toBe(503);
  });

  it('错 token → 401', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps();
    const { POST } = await import('@/app/api/admin/social-images/route');
    expect((await POST(reqWith('wrong', { match_id: UUID }))).status).toBe(401);
  });

  it('坏 body(非 uuid)→ 400', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps();
    const { POST } = await import('@/app/api/admin/social-images/route');
    expect((await POST(reqWith('secret', { match_id: 'nope' }))).status).toBe(400);
  });

  it('无战报 → 404', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps({ facts: null });
    const { POST } = await import('@/app/api/admin/social-images/route');
    expect((await POST(reqWith('secret', { match_id: UUID }))).status).toBe(404);
  });

  it('happy:触发两类推送 → 200 + 回门控态/球星', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    fanPush.mockClear();
    costarPush.mockClear();
    mockDeps();
    const { POST } = await import('@/app/api/admin/social-images/route');
    const res = await POST(reqWith('secret', { match_id: UUID }));
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; star: string; costarShowcase: { enabled: boolean; willPush: boolean } };
    expect(j.ok).toBe(true);
    expect(j.star).toBe('Neymar');
    expect(j.costarShowcase).toEqual({ enabled: true, willPush: true });
    expect(fanPush).toHaveBeenCalledOnce();
    expect(costarPush).toHaveBeenCalledOnce();
  });

  it('costar 关 + 无球星 → willPush=false(仍 200)', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockDeps({ facts: { matchLabel: 'A 0-0 B', star: undefined }, costar: false });
    const { POST } = await import('@/app/api/admin/social-images/route');
    const res = await POST(reqWith('secret', { match_id: UUID }));
    const j = await res.json() as { costarShowcase: { willPush: boolean }; star: string | null };
    expect(j.star).toBeNull();
    expect(j.costarShowcase.willPush).toBe(false);
  });
});
