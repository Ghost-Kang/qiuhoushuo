import { describe, expect, it, vi } from 'vitest';
import { runSchemaV2Migration, type MigrationClient } from '@/lib/db/migration-v2';

type RpcCall = { fn: string; args: Record<string, unknown> };

describe('runSchemaV2Migration', () => {
  it('returns no-op summary when scenario column already exists', async () => {
    const calls: RpcCall[] = [];
    const summary = await runSchemaV2Migration(client({ exists: true, calls }));
    expect(summary.overallOk).toBe(true);
    expect(summary.results).toEqual([{ step: 'check_column_exists', ok: true, rowsAffected: 0 }]);
    expect(calls).toHaveLength(1);
  });

  it('runs all migration steps when scenario column is missing', async () => {
    const calls: RpcCall[] = [];
    const summary = await runSchemaV2Migration(client({ exists: false, calls }));
    expect(summary.overallOk).toBe(true);
    expect(summary.results).toHaveLength(9);
    expect(calls.filter((call) => call.fn === 'exec_sql_admin')).toHaveLength(8);
  });

  it('stops early when add_scenario_column fails', async () => {
    const calls: RpcCall[] = [];
    const summary = await runSchemaV2Migration(client({
      exists: false,
      calls,
      failStep: 'add_scenario_column',
    }));
    expect(summary.overallOk).toBe(false);
    expect(summary.results).toEqual([
      { step: 'check_column_exists', ok: true, rowsAffected: 0 },
      { step: 'add_scenario_column', ok: false, error: 'add_scenario_column failed' },
    ]);
    expect(calls.filter((call) => call.fn === 'exec_sql_admin')).toHaveLength(1);
  });

  it('treats unpack_scenario zero-row updates as ok because rpc only reports errors', async () => {
    const summary = await runSchemaV2Migration(client({ exists: false, calls: [] }));
    expect(summary.results).toContainEqual({ step: 'unpack_scenario', ok: true });
  });

  it('sets overallOk true when every step succeeds', async () => {
    await expect(runSchemaV2Migration(client({ exists: false, calls: [] }))).resolves.toMatchObject({ overallOk: true });
  });

  it('sets overallOk false when any step fails', async () => {
    await expect(runSchemaV2Migration(client({ exists: false, calls: [], failStep: 'unpack_scenario' })))
      .resolves.toMatchObject({ overallOk: false });
  });

  it('emits ISO timestamps in order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const promise = runSchemaV2Migration(client({ exists: true, calls: [] }));
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'));
    const summary = await promise;
    vi.useRealTimers();
    expect(summary.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(summary.finishedAt)).toBeGreaterThanOrEqual(Date.parse(summary.startedAt));
  });

  it('keeps migration step order stable', async () => {
    const summary = await runSchemaV2Migration(client({ exists: false, calls: [] }));
    expect(summary.results.map((result) => result.step)).toEqual([
      'check_column_exists',
      'add_scenario_column',
      'add_published_at_column',
      'add_reviewer_note_column',
      'add_indexes',
      'drop_old_unique',
      'create_new_unique',
      'unpack_scenario',
      'unpack_published_at',
    ]);
  });
});

function client(opts: { exists: boolean; calls: RpcCall[]; failStep?: string }): MigrationClient {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      opts.calls.push({ fn, args });
      if (fn === 'check_column_exists') {
        return { data: opts.exists as T, error: null };
      }
      const stepName = stepNameFromSql(String(args.sql_query));
      if (opts.failStep === stepName) {
        return { data: null as T, error: { message: `${stepName} failed` } };
      }
      return { data: null as T, error: null };
    },
  };
}

function stepNameFromSql(sql: string): string {
  if (sql.includes('ADD COLUMN IF NOT EXISTS scenario')) return 'add_scenario_column';
  if (sql.includes('ADD COLUMN IF NOT EXISTS published_at')) return 'add_published_at_column';
  if (sql.includes('ADD COLUMN IF NOT EXISTS reviewer_note')) return 'add_reviewer_note_column';
  if (sql.includes('idx_reports_match_scenario')) return 'add_indexes';
  if (sql.includes('DROP CONSTRAINT')) return 'drop_old_unique';
  if (sql.includes('idx_reports_match_style_scenario_uniq')) return 'create_new_unique';
  if (sql.includes('UPDATE reports SET scenario')) return 'unpack_scenario';
  if (sql.includes('UPDATE reports SET published_at')) return 'unpack_published_at';
  return 'unknown';
}
