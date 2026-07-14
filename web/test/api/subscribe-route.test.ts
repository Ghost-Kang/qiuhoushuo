import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, json, req } from './_utils';

const UUID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

interface UpsertCall { rows: unknown; opts: unknown }

async function loadRoute(capture: UpsertCall[]) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: () => ({
        upsert: async (rows: unknown, opts: unknown) => { capture.push({ rows, opts }); return { error: null }; },
      }),
    }),
  }));
  return import('@/app/api/subscribe/route');
}

describe('POST /api/subscribe', () => {
  it('无 x-openid → 401', async () => {
    const { POST } = await loadRoute([]);
    const res = await POST(req('/api/subscribe', { method: 'POST', body: JSON.stringify({ match_id: UUID, kinds: ['match_start'] }) }));
    expect(res.status).toBe(401);
  });

  it('坏 body(缺 kinds / 非 uuid)→ 400', async () => {
    const { POST } = await loadRoute([]);
    expect((await POST(authed('/api/subscribe', { method: 'POST', body: JSON.stringify({ match_id: UUID }) }))).status).toBe(400);
    expect((await POST(authed('/api/subscribe', { method: 'POST', body: JSON.stringify({ match_id: 'not-uuid', kinds: ['match_start'] }) }))).status).toBe(400);
    expect((await POST(authed('/api/subscribe', { method: 'POST', body: JSON.stringify({ match_id: UUID, kinds: ['bogus'] }) }))).status).toBe(400);
  });

  it('合法 → upsert(openid,match_id,kind,sent_at=null)+ onConflict,返回 subscribed', async () => {
    const calls: UpsertCall[] = [];
    const { POST } = await loadRoute(calls);
    const res = await POST(authed('/api/subscribe', { method: 'POST', body: JSON.stringify({ match_id: UUID, kinds: ['match_start', 'report_ready'] }) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ subscribed: ['match_start', 'report_ready'] });
    expect(calls).toHaveLength(1);
    const rows = calls[0]!.rows as Array<{ openid: string; match_id: string; kind: string; sent_at: null }>;
    expect(rows).toEqual([
      { openid: 'mock_openid_001', match_id: UUID, kind: 'match_start', sent_at: null },
      { openid: 'mock_openid_001', match_id: UUID, kind: 'report_ready', sent_at: null },
    ]);
    expect(calls[0]!.opts).toEqual({ onConflict: 'openid,match_id,kind' });
  });
});
