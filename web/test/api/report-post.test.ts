import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';
import type { ReportStyle } from '@/lib/prompts';
import type { ServerEvent } from '@/lib/api/tracker';

const payload = {
  matchId: 'match-1',
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛',
  date: '2026-06-16',
  final_score: '2-1',
  events: [],
  stats: {},
};

const reports = {
  hardcore: report('hardcore'),
  duanzi: report('duanzi'),
  emotion: report('emotion'),
};

type ReportPostCall =
  | { op: 'ensureShortCode'; matchId: string }
  | { op: 'updateShortCode'; matchId: string; short_code?: string }
  | { op: 'generateAllStylesWithPersist'; matchId: string }
  | { op: 'notify'; payload: unknown }
  | { op: 'track'; eventId: ServerEvent['eventId']; properties?: Record<string, unknown> };

const calls: ReportPostCall[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  calls.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('POST /api/report persistence', () => {
  it('writes 3 rows when USE_DB=true', async () => {
    const { POST } = await loadRoute();
    const body = await json(await POST(reportReq()));
    expect(body.ok).toBe(true);
    expect(calls).toContainEqual({ op: 'ensureShortCode', matchId: 'match-1' });
    expect(calls).toContainEqual({ op: 'generateAllStylesWithPersist', matchId: 'match-1' });
  });

  it('generates short_code on matches if missing before persist', async () => {
    const { POST } = await loadRoute();
    await POST(reportReq());
    expect(calls).toContainEqual(expect.objectContaining({ op: 'updateShortCode', matchId: 'match-1', short_code: expect.any(String) }));
  });

  it('returns 500 when match row does not exist before generating short_code', async () => {
    const { POST } = await loadRoute(true, false, false, { missingMatch: true });
    const res = await POST(reportReq());
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'match not found: match-1' });
  });

  it('does not call short_code update when match row is missing', async () => {
    const { POST } = await loadRoute(true, false, false, { missingMatch: true });
    await POST(reportReq());
    expect(calls.some((c) => c.op === 'updateShortCode')).toBe(false);
  });

  it('does not update short_code when match already has one', async () => {
    const { POST } = await loadRoute(true, false, false, { existingShortCode: '2345678' });
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.op === 'updateShortCode')).toBe(false);
  });

  it('retries short_code generation once on unique conflict', async () => {
    const { POST } = await loadRoute(true, false, false, { conflictOnce: true });
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.op === 'updateShortCode')).toHaveLength(2);
  });

  it('tracks E040 after report persist succeeds', async () => {
    const { POST } = await loadRoute();
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E040' }));
  });

  it('skips DB write when USE_DB=false', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { POST } = await loadRoute(false);
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.op === 'generateAllStylesWithPersist')).toBe(false);
    expect(log).toHaveBeenCalledWith('[api/report] USE_DB=false, skip report persist', { matchId: 'match-1' });
  });

  it('returns 500 when persist helper reports failure', async () => {
    const { POST } = await loadRoute(true, true);
    const res = await POST(reportReq());
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'persist failed' });
    expect(calls).not.toContainEqual(expect.objectContaining({ op: 'notify' }));
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E042' }));
  });

  it('returns 200 with degraded=true when persist fails and finals_mode is ON', async () => {
    const { POST } = await loadRoute(true, true, true);
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      ok: true,
      degraded: true,
      persisted: false,
      warning: 'persist failed but reports generated; user should expect manual recovery within 30min',
    });
    expect(Object.keys(body.reports)).toEqual(['hardcore', 'duanzi', 'emotion']);
  });

  it('fires E042 and E047 when finals degraded', async () => {
    const { POST } = await loadRoute(true, true, true);
    await POST(reportReq());
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E042' }));
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E047' }));
  });
});

describe('POST /api/report internal token', () => {
  it('rejects missing token', async () => {
    const { POST } = await loadRoute(false);
    expect((await POST(req('/api/report', { method: 'POST', body: JSON.stringify(payload) }))).status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const { POST } = await loadRoute(false);
    expect((await POST(req('/api/report', { method: 'POST', headers: { 'x-internal-token': 'wrong' }, body: JSON.stringify(payload) }))).status).toBe(401);
  });
});

describe('POST /api/report hardening', () => {
  it('rejects payload > 64KB', async () => {
    const { POST } = await loadRoute(false);
    const res = await POST(req('/api/report', {
      method: 'POST',
      headers: { 'x-internal-token': 'dev-internal-token' },
      body: JSON.stringify({ huge: 'a'.repeat(70 * 1024) }),
    }));
    expect(res.status).toBe(413);
  });

  it('rejects unknown fields', async () => {
    const { POST } = await loadRoute(false);
    const res = await POST(req('/api/report', {
      method: 'POST',
      headers: { 'x-internal-token': 'dev-internal-token' },
      body: JSON.stringify({ ...payload, system_override: 'bypass' }),
    }));
    expect(res.status).toBe(400);
  });
});

function reportReq() {
  return req('/api/report', {
    method: 'POST',
    headers: { 'x-internal-token': 'dev-internal-token' },
    body: JSON.stringify(payload),
  });
}

async function loadRoute(
  useDb = true,
  failPersist = false,
  degrade = false,
  opts: { missingMatch?: boolean; existingShortCode?: string; conflictOnce?: boolean } = {},
) {
  if (useDb) {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
  }
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => serviceClient(opts) }));
  vi.doMock('@/lib/report', () => ({
    generateAllStyles: vi.fn(async () => reports),
    generateAllStylesWithPersist: vi.fn(async (_client, matchId) => {
      calls.push({ op: 'generateAllStylesWithPersist', matchId });
      return failPersist
        ? { reports, persisted: false, persistError: 'persist exploded' }
        : { reports, persisted: true };
    }),
  }));
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: (payload: unknown) => calls.push({ op: 'notify', payload }),
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => calls.push({ op: 'track', eventId: event.eventId, properties: event.properties }),
  }));
  vi.doMock('@/lib/api/finals-fallback', () => ({
    shouldDegradeGracefully: () => degrade,
  }));
  return import('@/app/api/report/route');
}

function serviceClient(opts: { missingMatch?: boolean; existingShortCode?: string; conflictOnce?: boolean } = {}) {
  let updateCount = 0;
  return {
    from(table: string) {
      if (table === 'matches') {
        return {
          select: () => ({
            eq: (_column: string, matchId: string) => ({
              maybeSingle: async () => {
                calls.push({ op: 'ensureShortCode', matchId });
                return { data: opts.missingMatch ? null : { short_code: opts.existingShortCode ?? null } };
              },
            }),
          }),
          update: (row: { short_code?: string }) => ({
            eq: async (_column: string, matchId: string) => {
              calls.push({ op: 'updateShortCode', matchId, short_code: row.short_code });
              updateCount += 1;
              if (opts.conflictOnce && updateCount === 1) return { error: { code: '23505', message: 'duplicate short_code' } };
              return { error: null };
            },
          }),
        };
      }
      return { table };
    },
  };
}

function report(style: ReportStyle) {
  return {
    style,
    title: `${style} title`,
    subtitle: '',
    lead: 'lead',
    body: ['body'],
    ending: 'ending',
    share_quote: 'quote',
    tags: [style],
    promptVersion: 'test',
    meta: { provider: 'test', model: 'mock', latencyMs: 1, safetyPassed: true },
  };
}
