import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('/api/admin/report/[id]', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { PUT } = await loadEditRoute();
    const res = await PUT(editReq(validEdit()), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(401);
  });

  it('rejects when no fields except reviewer_note in body', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { PUT } = await loadEditRoute();
    const res = await PUT(adminReq({ reviewer_note: '运营补救 fallback' }), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: 'NO_FIELDS_TO_UPDATE' });
  });

  it('updates only provided fields and leaves others untouched', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const updates: Record<string, unknown>[] = [];
    const { PUT } = await loadEditRoute({ updates });
    const res = await PUT(adminReq(validEdit({ lead: '这是一段人工补写的导语，长度足够覆盖原来的 fallback 文案，并保留其它字段不动。' })), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      lead: '这是一段人工补写的导语，长度足够覆盖原来的 fallback 文案，并保留其它字段不动。',
      human_reviewed: true,
      is_fallback: false,
    });
    expect(updates[0]).not.toHaveProperty('title');
    expect(updates[0]).not.toHaveProperty('share_quote');
  });

  it('sets human_reviewed=true and is_fallback=false after edit', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const updates: Record<string, unknown>[] = [];
    const events: unknown[] = [];
    const { PUT } = await loadEditRoute({ updates, events });
    const res = await PUT(adminReq(validEdit()), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      human_reviewed: true,
      is_fallback: false,
      prompt_version: 'manual-edit-2026.05.09-v1',
    });
    expect(updates[0]!.tags).toEqual(['fallback', 'reviewer:运营补救 fallback']);
    expect(events[0]).toMatchObject({ eventId: 'E046' });
  });

  it('returns 404 when report_id does not exist', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { PUT } = await loadEditRoute({ existing: null });
    const res = await PUT(adminReq(validEdit()), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('rejects 400 when id is not a uuid', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { PUT } = await loadEditRoute();
    const res = await PUT(adminReq(validEdit()), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('BAD_REQUEST');
  });

  it('returns 503 when service client unavailable', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => null }));
    const { PUT } = await import('@/app/api/admin/report/[id]/route');
    const res = await PUT(adminReq(validEdit()), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'DB_UNAVAILABLE' });
  });

  it('preserves existing tags array when body.tags omitted and writes reviewer tag', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const updates: Record<string, unknown>[] = [];
    const { PUT } = await loadEditRoute({ updates });
    const res = await PUT(adminReq(validEdit()), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(200);
    const tags = updates[0]?.tags as string[];
    expect(tags[tags.length - 1]).toMatch(/^reviewer:/);
  });

  it('clamps reviewer note when crafting reviewer tag', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const updates: Record<string, unknown>[] = [];
    const { PUT } = await loadEditRoute({ updates });
    const longNote = '运营补救 ' + 'a'.repeat(80);
    const res = await PUT(adminReq(validEdit({ reviewer_note: longNote })), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(200);
    const tags = updates[0]?.tags as string[];
    const reviewerTag = tags.find((t) => t.startsWith('reviewer:'))!;
    // 'reviewer:' (9) + 30 chars = 39
    expect(reviewerTag.length).toBeLessThanOrEqual(9 + 30);
  });
});

describe('/api/admin/report/[id]/raw', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRawRoute();
    const res = await GET(req(`/api/admin/report/${REPORT_ID}/raw`), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(401);
  });

  it('returns full report row including internal fields', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRawRoute();
    const res = await GET(req(`/api/admin/report/${REPORT_ID}/raw`, { headers: { 'x-admin-token': 'secret' } }), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      report_id: REPORT_ID,
      id: REPORT_ID,
      match_id: 'match-1',
      style: 'duanzi',
      llm_provider: 'fallback',
      is_fallback: true,
      is_premium: false,
      human_reviewed: false,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    });
  });

  it('rejects 400 when id is not a uuid', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRawRoute();
    const res = await GET(
      req(`/api/admin/report/bad-id/raw`, { headers: { 'x-admin-token': 'secret' } }),
      { params: Promise.resolve({ id: 'bad-id' }) },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('BAD_REQUEST');
  });

  it('returns 503 when service client unavailable', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => null }));
    const { GET } = await import('@/app/api/admin/report/[id]/raw/route');
    const res = await GET(
      req(`/api/admin/report/${REPORT_ID}/raw`, { headers: { 'x-admin-token': 'secret' } }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'DB_UNAVAILABLE' });
  });

  it('returns 404 when report row not found', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await loadRawRoute({ existing: null });
    const res = await GET(
      req(`/api/admin/report/${REPORT_ID}/raw`, { headers: { 'x-admin-token': 'secret' } }),
      { params: Promise.resolve({ id: REPORT_ID }) },
    );
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });
});

async function loadEditRoute(opts: { existing?: ReportRow | null; updates?: Record<string, unknown>[]; events?: unknown[] } = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => reportClient(opts) }));
  vi.doMock('@/lib/api/tracker', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/tracker')>('@/lib/api/tracker');
    return {
      ...actual,
      trackServerEventGlobal: (event: unknown) => opts.events?.push(event),
    };
  });
  return import('@/app/api/admin/report/[id]/route');
}

async function loadRawRoute(opts: { existing?: ReportRow | null } = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => reportClient(opts) }));
  return import('@/app/api/admin/report/[id]/raw/route');
}

function reportClient(opts: { existing?: ReportRow | null; updates?: Record<string, unknown>[] }) {
  const existing = opts.existing === undefined ? reportRow() : opts.existing;
  return {
    from(table: string) {
      if (table !== 'reports') return {};
      return {
        select: () => query(existing),
        update: (values: Record<string, unknown>) => {
          opts.updates?.push(values);
          return query(existing ? { id: existing.id } : null);
        },
      };
    },
  };
}

function query(data: unknown) {
  return {
    select: () => query(data),
    eq: () => query(data),
    maybeSingle: async () => ({ data }),
  };
}

type ReportRow = ReturnType<typeof reportRow>;

function reportRow() {
  return {
    id: REPORT_ID,
    match_id: 'match-1',
    style: 'duanzi',
    title: '兜底战报标题',
    subtitle: '副标题',
    lead: 'fallback lead',
    body: ['fallback body'],
    ending: 'fallback ending',
    share_quote: 'fallback quote',
    tags: ['fallback'],
    prompt_version: '2026.05.09-v1',
    llm_provider: 'fallback',
    is_fallback: true,
    is_premium: false,
    human_reviewed: false,
    created_at: '2026-05-14T00:00:00Z',
    updated_at: '2026-05-14T00:00:00Z',
  };
}

function editReq(payload: unknown) {
  return req(`/api/admin/report/${REPORT_ID}`, { method: 'PUT', body: JSON.stringify(payload) });
}

function adminReq(payload: unknown) {
  return req(`/api/admin/report/${REPORT_ID}`, {
    method: 'PUT',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(payload),
  });
}

function validEdit(overrides: Record<string, unknown> = {}) {
  return {
    lead: '这是一段人工补写的导语，长度足够覆盖原来的 fallback 文案，并保留其它字段不动。',
    reviewer_note: '运营补救 fallback',
    ...overrides,
  };
}
