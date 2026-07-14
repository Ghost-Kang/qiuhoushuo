import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyEventsPipeline } from '@/scripts/verify-events-pipeline';

type EventsPipelineClient = NonNullable<Parameters<typeof verifyEventsPipeline>[0]>;
type EventQueryCall = { columns: string; column: string; since: string };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyEventsPipeline', () => {
  it('can be invoked with a mock supabase client', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: EventQueryCall[] = [];
    const client: EventsPipelineClient = {
      from: () => ({
        select: (columns: string) => ({
          gte: async (column: string, since: string) => {
            calls.push({ columns, column, since });
            return { data: [{ event_id: 'E040' }, { event_id: 'E040' }, { event_id: 'E051' }] };
          },
        }),
      }),
    };
    const result = await verifyEventsPipeline(client);
    expect(calls[0]).toMatchObject({ columns: 'event_id', column: 'created_at' });
    expect(result.counts).toMatchObject({ E040: 2, E051: 1 });
    expect(result.missing).toEqual(expect.arrayContaining(['E031', 'E032', 'E033', 'E054']));
    expect(result.missing).toEqual(expect.arrayContaining(['E013', 'E044', 'E045', 'E046', 'E047']));
    expect(result.missing).toEqual(expect.arrayContaining(['E070', 'E071', 'E072', 'E073', 'E074']));
    expect(result.missing).toContain('E092');
    expect(result.missing).toContain('E096');
    expect(log).toHaveBeenCalledWith('[events] service_role_read', 'ok');
    expect(warn).toHaveBeenCalled();
  });

  it('skips verification and reports all expected events when client is unavailable', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await verifyEventsPipeline(null);
    expect(result.counts).toEqual({});
    expect(result.missing).toEqual(expect.arrayContaining(['E013', 'E031', 'E032', 'E033', 'E040', 'E044', 'E045', 'E046', 'E047', 'E054', 'E070', 'E071', 'E072', 'E073', 'E074', 'E093', 'E096']));
    expect(result.missing).toHaveLength(34);
    expect(log).toHaveBeenCalledWith('[events] USE_DB=false, skip events pipeline verification');
  });

  it('throws when service role read fails', async () => {
    const client: EventsPipelineClient = {
      from: () => ({
        select: () => ({
          gte: async () => ({ data: null, error: { message: 'permission denied' } }),
        }),
      }),
    };
    await expect(verifyEventsPipeline(client)).rejects.toThrow('permission denied');
  });

  it('keeps event schema, verification script, and dashboard spec on created_at/event_id', () => {
    const schema = readWorkspaceFile('web/db/schema.sql');
    const script = readWorkspaceFile('web/scripts/verify-events-pipeline.ts');
    const metabaseSpec = readWorkspaceFile('tasks/METABASE-DASHBOARD-SPEC.md');

    expect(schema).toContain('event_id TEXT NOT NULL');
    expect(schema).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(schema).toContain('CREATE INDEX idx_events_event_time ON events (event_id, created_at)');
    expect(script).toContain(".select('event_id').gte('created_at'");
    expect(metabaseSpec).toContain('event_id');
    expect(`${schema}\n${script}\n${metabaseSpec}`).not.toContain('occurred_at');
    expect(`${schema}\n${script}\n${metabaseSpec}`).not.toContain('event_code');
  });

  it('tracks report human override as an expected server event', async () => {
    const result = await verifyEventsPipeline(null);
    expect(result.missing).toEqual(expect.arrayContaining(['E044', 'E045', 'E046', 'E047']));
  });

  it('tracks API-Football sync and quota event ids as expected server events', async () => {
    const result = await verifyEventsPipeline(null);
    expect(result.missing).toEqual(expect.arrayContaining(['E070', 'E071', 'E072', 'E073', 'E074']));
  });

  it('tracks DeepSeek empty retry as an expected server event', async () => {
    const result = await verifyEventsPipeline(null);
    expect(result.missing).toContain('E064');
  });

  it('tracks payment and report-read decision events as expected server events', async () => {
    const result = await verifyEventsPipeline(null);
    expect(result.missing).toEqual(expect.arrayContaining(['E031', 'E032', 'E033', 'E054']));
  });
});

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), '..', path), 'utf8');
}
