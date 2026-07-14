import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('/api/admin/report-preset', () => {
  it('exports maxDuration=60 for Vercel free-tier timeout envelope', async () => {
    const route = await loadRoute();
    expect(route.maxDuration).toBe(60);
  });

  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute();
    const res = await POST(req('/api/admin/report-preset', { method: 'POST', body: JSON.stringify(body()) }));
    expect(res.status).toBe(401);
  });

  it('creates preset with scenario tag and human_reviewed=true', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const inserts: Record<string, unknown>[] = [];
    const events: unknown[] = [];
    const { POST } = await loadRoute({ inserts, events });
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ report_id: REPORT_ID, scenario: 'home_wins', status: 'preset_ready' });
    expect(inserts[0]).toMatchObject({
      match_id: MATCH_ID,
      style: 'hardcore',
      tags: ['finals', 'scenario:home_wins'],
      prompt_version: 'manual-preset-v1',
      llm_provider: 'manual',
      is_fallback: false,
      is_premium: true,
      human_reviewed: true,
    });
    expect(events[0]).toMatchObject({ eventId: 'E044' });
  });

  it('returns 409 on duplicate match_id, scenario, style', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute({ duplicate: true });
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'PRESET_EXISTS' });
  });

  it('rejects body > 4KB', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute();
    const res = await POST(adminReq(body({ report: { ...body().report, lead: 'a'.repeat(5 * 1024) } })));
    expect(res.status).toBe(413);
  });

  it('returns 503 when service client unavailable', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => null }));
    const { POST } = await import('@/app/api/admin/report-preset/route');
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'DB_UNAVAILABLE' });
  });

  it('returns 500 when insert returns error', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute({ insertError: true });
    const res = await POST(adminReq(body()));
    expect(res.status).toBe(500);
    expect((await json(res)).error).toBe('PRESET_CREATE_FAILED');
  });

  it('mergeTags filters existing scenario:* tags and clamps to 5', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const inserts: Record<string, unknown>[] = [];
    const { POST } = await loadRoute({ inserts });
    const res = await POST(adminReq(body({
      report: {
        ...body().report,
        // 6 tags 含 scenario:away_wins 应被过滤，clamp 到 5 + scenario:home_wins
        tags: ['finals', 'scenario:away_wins', 't1', 't2', 't3', 't4'],
      },
    })));
    expect(res.status).toBe(200);
    const tags = (inserts[0]?.tags as string[]);
    expect(tags).not.toContain('scenario:away_wins');
    expect(tags[tags.length - 1]).toBe('scenario:home_wins');
    expect(tags).toHaveLength(6); // 5 non-scenario + 1 new scenario
  });

  it('writes subtitle=null when omitted from body', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const inserts: Record<string, unknown>[] = [];
    const { POST } = await loadRoute({ inserts });
    const payload = body();
    delete (payload.report as Record<string, unknown>).subtitle;
    const res = await POST(adminReq(payload));
    expect(res.status).toBe(200);
    expect(inserts[0]?.subtitle).toBeNull();
  });
});

async function loadRoute(opts: { duplicate?: boolean; inserts?: Record<string, unknown>[]; events?: unknown[]; insertError?: boolean } = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client(opts) }));
  vi.doMock('@/lib/api/tracker', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/tracker')>('@/lib/api/tracker');
    return { ...actual, trackServerEventGlobal: (event: unknown) => opts.events?.push(event) };
  });
  return import('@/app/api/admin/report-preset/route');
}

function client(opts: { duplicate?: boolean; inserts?: Record<string, unknown>[]; insertError?: boolean }) {
  return {
    from(table: string) {
      if (table !== 'reports') return {};
      return {
        select: () => duplicateQuery(opts.duplicate),
        insert: (row: Record<string, unknown>) => {
          opts.inserts?.push(row);
          return {
            select: () => ({
              maybeSingle: async () => opts.insertError
                ? { data: null, error: { message: 'db boom' } }
                : { data: { id: REPORT_ID }, error: null },
            }),
          };
        },
      };
    },
  };
}

function duplicateQuery(duplicate = false) {
  return {
    eq: () => duplicateQuery(duplicate),
    contains: () => duplicateQuery(duplicate),
    maybeSingle: async () => ({ data: duplicate ? { id: REPORT_ID } : null }),
  };
}

function adminReq(payload: unknown) {
  return req('/api/admin/report-preset', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(payload),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    match_id: MATCH_ID,
    scenario: 'home_wins',
    report: {
      style: 'hardcore',
      title: '人工预案战报标题',
      subtitle: '决赛日预案',
      lead: '这是一段人工提前写好的决赛日预案导语，长度明确满足审核边界，便于赛后快速发布，也方便运营在最终比分确认后快速复核。',
      body: ['这是一段人工预案正文，长度明确满足边界要求，用于覆盖决赛日不同结果下的发布准备工作，并给运营留出充分的人审空间，同时保留可追溯的人工确认内容。'],
      ending: '这是一段人工预案结尾，长度明确满足边界要求，用于在发布前保留完整叙事收束和人工确认痕迹，确保推送前状态清晰。',
      share_quote: '人工预案金句已备好',
      tags: ['finals'],
      is_premium: true,
    },
    ...overrides,
  };
}
