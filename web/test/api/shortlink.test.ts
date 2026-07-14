import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const SHORT_CODE = '2345678';
const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('/m/[shortCode]', () => {
  it('confirms only route.ts is present in /m/[shortCode] segment', () => {
    const files = readdirSync(resolve(process.cwd(), 'app/m/[shortCode]')).sort();
    expect(files).toContain('route.ts');
    expect(files).not.toContain('page.tsx');
    expect(files).not.toContain('page.ts');
    expect(files).not.toContain('page.jsx');
  });

  it('rejects invalid short_code', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req('/m/badcode'), { params: Promise.resolve({ shortCode: 'badcode' }) });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'BAD_REQUEST' });
  });

  it('redirects to /report/[id]?utm_source=shortlink on hit', async () => {
    const { GET } = await loadRoute();
    const res = await GET(shortReq(), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`http://localhost/report/${REPORT_ID}?utm_source=shortlink`);
  });

  it('returns 404 when short_code not found', async () => {
    const { GET } = await loadRoute({ noMatch: true });
    const res = await GET(shortReq(), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('inserts landings row with user_agent and referrer fingerprint fields', async () => {
    const landings: Record<string, unknown>[] = [];
    const { GET } = await loadRoute({ landings });
    await GET(shortReq(), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(landings[0]).toMatchObject({
      short_code: SHORT_CODE,
      match_id: MATCH_ID,
      utm_source: 'kol',
      utm_kol: 'li',
      ua_fingerprint: 'Vitest UA',
    });
    expect(landings[0]!.ip_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fires E013 when shortlink resolves', async () => {
    const events: unknown[] = [];
    const { GET } = await loadRoute({ events });
    await GET(shortReq(), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(events[0]).toMatchObject({ eventId: 'E013' });
  });

  it('returns 404 when hardcore report is missing', async () => {
    const { GET } = await loadRoute({ noReport: true });
    const res = await GET(shortReq(), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('uses default utm_source and fallback IP when headers are absent', async () => {
    const landings: Record<string, unknown>[] = [];
    const { GET } = await loadRoute({ landings });
    await GET(req('/m/2345678'), { params: Promise.resolve({ shortCode: SHORT_CODE }) });
    expect(landings[0]).toMatchObject({ utm_source: 'shortlink', utm_kol: null });
    expect(landings[0]!.ip_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

async function loadRoute(opts: { noMatch?: boolean; noReport?: boolean; landings?: Record<string, unknown>[]; events?: unknown[] } = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client(opts) }));
  vi.doMock('@/lib/api/tracker', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/tracker')>('@/lib/api/tracker');
    return { ...actual, trackServerEventGlobal: (event: unknown) => opts.events?.push(event) };
  });
  return import('@/app/m/[shortCode]/route');
}

function client(opts: { noMatch?: boolean; noReport?: boolean; landings?: Record<string, unknown>[] }) {
  return {
    from(table: string) {
      if (table === 'landings') return { insert: (row: Record<string, unknown>) => opts.landings?.push(row) };
      return {
        select: () => query(table, opts),
      };
    },
  };
}

function query(table: string, opts: { noMatch?: boolean; noReport?: boolean }) {
  const state: Record<string, string> = {};
  const q = {
    eq: (column: string, value: string) => {
      state[column] = value;
      return q;
    },
    maybeSingle: async () => {
      if (table === 'matches') return { data: opts.noMatch ? null : { id: MATCH_ID } };
      if (table === 'reports') return { data: !opts.noReport && state.style === 'hardcore' ? { id: REPORT_ID } : null };
      return { data: null };
    },
  };
  return q;
}

function shortReq() {
  return req('/m/2345678?utm_source=kol&utm_kol=li', {
    headers: {
      'user-agent': 'Vitest UA',
      referer: 'https://ref.example',
      'x-forwarded-for': '203.0.113.10',
    },
  });
}
