/**
 * generateAllStylesWithPersist 包装层测试。
 *
 * 关键失败语义：
 * - persist 挂时仍返 reports（用户至少能拿到生成内容）
 * - persist 挂时 fire-and-forget P0 告警
 * - generateAllStyles 永不抛（内部 fallback 兜底）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateAllStylesWithPersist,
  type ReportPersistClient,
} from '@/lib/report';
import * as alerts from '@/lib/alerts';
import * as tracker from '@/lib/api/tracker';
import type { MatchData } from '@/lib/prompts';

const MATCH: MatchData = {
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛',
  date: '2026-06-22',
  final_score: '2:1',
  events: [],
  stats: {},
};

let notifySpy: ReturnType<typeof vi.spyOn>;
type PersistAlertCall = {
  payload: alerts.AlertPayload;
  opts: alerts.NotifyOpsOptions;
};

beforeEach(() => {
  notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);
  // generateAllStyles 真跑会调 callLLM，但没 env 会全 provider 失败 → 全走 fallbackReport（这正是我们想要的稳定 fallback 路径）
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeClient(opts: { error?: string } = {}): ReportPersistClient {
  return {
    from: () => ({
      upsert: async () => ({
        error: opts.error ? { message: opts.error } : null,
      }),
    }),
  };
}

function persistAlerts(): alerts.AlertPayload[] {
  return persistAlertCalls().map((call: PersistAlertCall) => call.payload);
}

function persistAlertCalls(): PersistAlertCall[] {
  return notifySpy.mock.calls
    .map((call: unknown[]) => ({
      payload: call[0] as alerts.AlertPayload,
      opts: call[1] as alerts.NotifyOpsOptions,
    }) satisfies PersistAlertCall)
    .filter((call: PersistAlertCall) => call.payload.tags?.includes('report-persist'));
}

describe('generateAllStylesWithPersist', () => {
  it('成功路径：返 persisted=true + 3 风格 reports', async () => {
    const client = makeClient();
    const result = await generateAllStylesWithPersist(client, 'match-uuid-1', MATCH);

    expect(result.persisted).toBe(true);
    expect(result.persistError).toBeUndefined();
    expect(Object.keys(result.reports).sort()).toEqual(['duanzi', 'emotion', 'hardcore']);
    expect(persistAlerts()).toHaveLength(0);
  }, 30_000);

  it('persist 挂时仍返 reports + persisted=false + persistError', async () => {
    const client = makeClient({ error: 'unique violation match_id+style' });
    const result = await generateAllStylesWithPersist(client, 'match-uuid-2', MATCH);

    expect(result.persisted).toBe(false);
    expect(result.persistError).toMatch(/unique violation/);
    expect(Object.keys(result.reports)).toHaveLength(3);
    // 用户仍能拿到 reports
    expect(result.reports.hardcore).toBeDefined();
    expect(result.reports.duanzi).toBeDefined();
    expect(result.reports.emotion).toBeDefined();
  }, 30_000);

  it('persist 挂时触发 fire-and-forget P0 告警', async () => {
    const client = makeClient({ error: 'connection timeout' });
    await generateAllStylesWithPersist(client, 'match-uuid-3', MATCH);

    expect(persistAlerts()).toHaveLength(1);
    const payload = persistAlerts()[0]!;
    expect(payload.severity).toBe('P0');
    expect(payload.title).toContain('report 落库失败');
    expect(payload.title).toContain('巴西 vs 西班牙');
    expect(payload.body).toContain('match-uuid-3');
    expect(payload.body).toContain('connection timeout');
    expect(payload.tags).toContain('report-persist');
    expect(payload.tags).toContain('p0');
    expect(persistAlertCalls()[0]!.opts).toEqual({
      dedupKey: 'report-persist-fail:match-uuid-3',
      dedupWindowMs: 5 * 60 * 1000,
    });
  }, 30_000);

  it('persist 挂时同 matchId 使用稳定 dedup key', async () => {
    const client = makeClient({ error: 'connection timeout' });
    await generateAllStylesWithPersist(client, 'match-uuid-same', MATCH);
    await generateAllStylesWithPersist(client, 'match-uuid-same', MATCH);

    expect(persistAlertCalls().map((call: PersistAlertCall) => call.opts)).toEqual([
      { dedupKey: 'report-persist-fail:match-uuid-same', dedupWindowMs: 5 * 60 * 1000 },
      { dedupKey: 'report-persist-fail:match-uuid-same', dedupWindowMs: 5 * 60 * 1000 },
    ]);
  }, 30_000);

  it('persist 挂时不同 matchId 独立 dedup', async () => {
    const client = makeClient({ error: 'connection timeout' });
    await generateAllStylesWithPersist(client, 'match-uuid-a', MATCH);
    await generateAllStylesWithPersist(client, 'match-uuid-b', MATCH);

    expect(persistAlertCalls().map((call: PersistAlertCall) => call.opts)).toEqual([
      { dedupKey: 'report-persist-fail:match-uuid-a', dedupWindowMs: 5 * 60 * 1000 },
      { dedupKey: 'report-persist-fail:match-uuid-b', dedupWindowMs: 5 * 60 * 1000 },
    ]);
  }, 30_000);

  it('upsert 抛错（非 error 字段）时同样兜底 P0 + 返 reports', async () => {
    const client: ReportPersistClient = {
      from: () => ({
        upsert: async () => {
          throw new Error('network unreachable');
        },
      }),
    };
    const result = await generateAllStylesWithPersist(client, 'match-uuid-4', MATCH);

    expect(result.persisted).toBe(false);
    expect(result.persistError).toMatch(/network unreachable/);
    expect(persistAlerts()).toHaveLength(1);
    expect(Object.keys(result.reports)).toHaveLength(3);
  }, 30_000);

  it('每次调用至多一次告警（持久化失败 1 次 = 告警 1 次，不重发）', async () => {
    const client = makeClient({ error: 'boom' });
    await generateAllStylesWithPersist(client, 'match-uuid-5', MATCH);
    expect(persistAlerts()).toHaveLength(1);
  }, 30_000);

  it('E041 fires for each fallback-triggered style', async () => {
    // 真跑 generateAllStyles 无 LLM env → 3 风格全 fallback → 期望 3 次 E041
    const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);
    const client = makeClient();
    await generateAllStylesWithPersist(client, 'match-uuid-e041', MATCH);

    const e041 = trackSpy.mock.calls.filter((c) => (c[0] as tracker.ServerEvent).eventId === 'E041');
    expect(e041).toHaveLength(3);
    const styles = e041.map((c) => (c[0] as tracker.ServerEvent).properties!.style).sort();
    expect(styles).toEqual(['duanzi', 'emotion', 'hardcore']);
    e041.forEach((c) => {
      const props = (c[0] as tracker.ServerEvent).properties!;
      expect(props.match).toBe(MATCH.match);
      expect(props.competition).toBe(MATCH.competition);
      expect(props.reason).toBeDefined();
    });
  }, 30_000);
});
