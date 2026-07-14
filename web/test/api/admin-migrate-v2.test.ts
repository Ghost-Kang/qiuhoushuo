import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { json, req } from './_utils';

const okSummary = {
  startedAt: '2026-05-15T12:00:00.000Z',
  finishedAt: '2026-05-15T12:00:01.000Z',
  overallOk: true,
  results: [{ step: 'check_column_exists', ok: true }],
};

const failSummary = {
  ...okSummary,
  overallOk: false,
  results: [{ step: 'add_scenario_column', ok: false, error: 'boom' }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetQuotaMemoryForTests();
  delete process.env.ADMIN_TOKEN;
});

describe('POST /api/admin/migrate-v2', () => {
  it('rejects missing admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute();
    const res = await POST(req('/api/admin/migrate-v2', { method: 'POST', body: JSON.stringify(validBody()) }));
    expect(res.status).toBe(401);
  });

  it('rejects wrong confirmText', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute();
    const res = await POST(adminReq({ confirmText: 'wrong' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when service db is unavailable', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute({ db: null });
    const res = await POST(adminReq(validBody()));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'db_unavailable' });
  });

  it('returns 200 with migration summary when migration succeeds', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST, runMigration } = await loadRoute({ summary: okSummary });
    const res = await POST(adminReq(validBody()));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(okSummary);
    expect(runMigration).toHaveBeenCalledOnce();
  });

  it('returns 500 with migration summary when migration fails', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { POST } = await loadRoute({ summary: failSummary });
    const res = await POST(adminReq(validBody()));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual(failSummary);
  });
});

function validBody() {
  return { confirmText: 'I-UNDERSTAND-MIGRATION-IS-IRREVERSIBLE' };
}

function adminReq(body: unknown) {
  return req('/api/admin/migrate-v2', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(body),
  });
}

async function loadRoute(opts: { db?: unknown; summary?: typeof okSummary } = {}) {
  vi.resetModules();
  const db = opts.db === undefined ? { from: () => ({}) } : opts.db;
  const runMigration = vi.fn(async () => opts.summary ?? okSummary);
  vi.doMock('@/lib/api/mode', () => ({
    getSupabaseService: () => db,
  }));
  vi.doMock('@/lib/db/migration-v2', () => ({
    runSchemaV2Migration: runMigration,
  }));
  const route = await import('@/app/api/admin/migrate-v2/route');
  return { POST: route.POST, runMigration };
}
