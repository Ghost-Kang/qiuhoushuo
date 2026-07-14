import { describe, expect, it, vi } from 'vitest';
import {
  persistReport,
  toReportRow,
  type GeneratedReport,
  type ReportPersistClient,
  type ReportRow,
} from '@/lib/report';
import type { ReportStyle } from '@/lib/prompts';

function makeReport(style: ReportStyle, overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    style,
    title: `${style} 战报`,
    subtitle: 'sub',
    lead: 'lead 200 字摘要',
    body: ['段一', '段二'],
    ending: '收尾',
    share_quote: '一句话金句',
    tags: ['战报', style],
    promptVersion: '2026.05.09-v1',
    meta: {
      provider: 'doubao',
      model: 'doubao-pro-128k',
      latencyMs: 1234,
      safetyPassed: true,
      inputTokens: 800,
      outputTokens: 600,
    },
    ...overrides,
  };
}

function makeClient(): {
  client: ReportPersistClient;
  upsert: ReturnType<typeof vi.fn>;
  capturedRows: () => ReportRow[];
  capturedOpts: () => { onConflict: string } | undefined;
} {
  const upsert = vi.fn(async (_rows: ReportRow[], _options: { onConflict: string }) => ({
    error: null as { message: string } | null,
  }));
  let capturedRows: ReportRow[] = [];
  let capturedOpts: { onConflict: string } | undefined;
  const client: ReportPersistClient = {
    from: () => ({
      upsert: async (rows, options) => {
        capturedRows = rows;
        capturedOpts = options;
        return upsert(rows, options);
      },
    }),
  };
  return {
    client,
    upsert,
    capturedRows: () => capturedRows,
    capturedOpts: () => capturedOpts,
  };
}

describe('toReportRow', () => {
  it('maps GeneratedReport → reports schema columns', () => {
    const row = toReportRow('m-uuid-1', makeReport('hardcore'));
    expect(row).toMatchObject({
      match_id: 'm-uuid-1',
      style: 'hardcore',
      title: 'hardcore 战报',
      subtitle: 'sub',
      body: ['段一', '段二'],
      tags: ['战报', 'hardcore'],
      prompt_version: '2026.05.09-v1',
      llm_provider: 'doubao',
      llm_model: 'doubao-pro-128k',
      is_fallback: false,
    });
  });

  it('marks is_fallback=true when provider=fallback (template 兜底)', () => {
    const row = toReportRow('m-1', makeReport('duanzi', { meta: { provider: 'fallback', model: 'template', latencyMs: 0, safetyPassed: true } }));
    expect(row.is_fallback).toBe(true);
    expect(row.llm_provider).toBe('fallback');
  });

  it('coerces null subtitle / empty tags rather than undefined', () => {
    const row = toReportRow('m-1', makeReport('emotion', { subtitle: undefined, tags: undefined }));
    expect(row.subtitle).toBeNull();
    expect(row.tags).toEqual([]);
  });
});

describe('persistReport', () => {
  it('upserts 3 rows with onConflict=match_id,style', async () => {
    const { client, upsert, capturedRows, capturedOpts } = makeClient();
    const result = await persistReport(client, 'm-uuid-1', {
      hardcore: makeReport('hardcore'),
      duanzi: makeReport('duanzi'),
      emotion: makeReport('emotion'),
    });
    expect(result.inserted).toBe(3);
    expect(upsert).toHaveBeenCalledOnce();
    expect(capturedRows().map((r) => r.style).sort()).toEqual(['duanzi', 'emotion', 'hardcore']);
    expect(capturedOpts()).toEqual({ onConflict: 'match_id,style' });
  });

  it('embeds match_id on every row (FK to matches.id)', async () => {
    const { client, capturedRows } = makeClient();
    await persistReport(client, 'm-uuid-7', {
      hardcore: makeReport('hardcore'),
      duanzi: makeReport('duanzi'),
      emotion: makeReport('emotion'),
    });
    for (const row of capturedRows()) {
      expect(row.match_id).toBe('m-uuid-7');
    }
  });

  it('persists fallback rows alongside real ones (is_fallback flag preserved)', async () => {
    const { client, capturedRows } = makeClient();
    await persistReport(client, 'm-uuid-9', {
      hardcore: makeReport('hardcore'),
      duanzi: makeReport('duanzi', { meta: { provider: 'fallback', model: 'template', latencyMs: 0, safetyPassed: true } }),
      emotion: makeReport('emotion'),
    });
    const duanzi = capturedRows().find((r) => r.style === 'duanzi')!;
    expect(duanzi.is_fallback).toBe(true);
    expect(capturedRows().filter((r) => r.is_fallback === false)).toHaveLength(2);
  });

  it('throws when supabase returns an error (route handler 兜 500 + 告警)', async () => {
    const client: ReportPersistClient = {
      from: () => ({
        upsert: async () => ({ error: { message: 'duplicate key match_id,style' } }),
      }),
    };
    await expect(
      persistReport(client, 'm-uuid-x', {
        hardcore: makeReport('hardcore'),
        duanzi: makeReport('duanzi'),
        emotion: makeReport('emotion'),
      }),
    ).rejects.toThrow(/persistReport upsert failed: duplicate key/);
  });

  it('targets the reports table, not anything else', async () => {
    const from = vi.fn().mockReturnValue({ upsert: async () => ({ error: null }) });
    const client = { from } as unknown as ReportPersistClient;
    await persistReport(client, 'm-1', {
      hardcore: makeReport('hardcore'),
      duanzi: makeReport('duanzi'),
      emotion: makeReport('emotion'),
    });
    expect(from).toHaveBeenCalledWith('reports');
  });
});
