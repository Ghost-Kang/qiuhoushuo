/**
 * F26 闭环：card-prerender.ts edge branch 覆盖（branches 64.5 → ≥ 85）
 *
 * 既有测试覆盖 happy path（生成 9 cards + 9 puts）/ failOne / failAll / missingMatch / blocker。
 * 本文件补 edge branches：
 * - db === null 早 return
 * - outer try/catch 兜底（matches query throws）
 * - toCardPayload 内 ~10 个 nullish branches（stats null / xg null / short_code null / subtitle null / body 非数组）
 * - reportIds.get(style) === undefined → fallback to matchId
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertPayload, NotifyOpsOptions } from '@/lib/alerts';
import type { ServerEvent } from '@/lib/api/tracker';

type Call =
  | { op: 'render'; style: string; platform: string; payload: Record<string, unknown> }
  | { op: 'put'; key: string }
  | { op: 'notify'; payload: AlertPayload; opts?: NotifyOpsOptions }
  | { op: 'track'; eventId: ServerEvent['eventId'] };

const calls: Call[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function reports() {
  return {
    hardcore: report('hardcore'),
    duanzi: report('duanzi'),
    emotion: report('emotion'),
  };
}
function report(style: 'hardcore' | 'duanzi' | 'emotion') {
  return {
    style,
    title: `${style} title`,
    subtitle: 'sub',
    lead: 'lead',
    body: ['body'],
    ending: 'ending',
    share_quote: 'quote',
    tags: [style],
    promptVersion: 'test',
    meta: { provider: 'test', model: 'mock', latencyMs: 1, safetyPassed: true },
  };
}

function storage() {
  return {
    exists: vi.fn(async () => null),
    put: vi.fn(async (key: string) => {
      calls.push({ op: 'put', key });
      return `memory://${key}`;
    }),
  };
}

function storageWithHighlightImage(url: string) {
  return {
    exists: vi.fn(async (key: string) => (
      key === 'highlight-images/match-img/score-turn.jpg' ? url : null
    )),
    put: vi.fn(async (key: string) => {
      calls.push({ op: 'put', key });
      return `memory://${key}`;
    }),
  };
}

function defaultMocks(client: unknown) {
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
  vi.doMock('@/lib/share-cards', () => ({
    renderShareCard: vi.fn(async (style: string, platform: string, payload: Record<string, unknown>) => {
      calls.push({ op: 'render', style, platform, payload });
      return Buffer.from('png');
    }),
    flagUrl: (n: string) => (n ? `https://qiuhoushuo.com/flags/${n}.png` : undefined),
  }));
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: (payload: AlertPayload, opts?: NotifyOpsOptions) =>
      calls.push({ op: 'notify', payload, opts }),
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_c: unknown, e: ServerEvent) => calls.push({ op: 'track', eventId: e.eventId }),
  }));
}

describe('card-prerender edge branches', () => {
  it('returns early when service client is null (USE_DB=false)', async () => {
    vi.unstubAllEnvs();
    defaultMocks(null);
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-x', reports(), storage());
    expect(calls.some((c) => c.op === 'put')).toBe(false);
    expect(calls.some((c) => c.op === 'notify')).toBe(false);
    expect(calls.some((c) => c.op === 'track')).toBe(false);
  });

  it('outer catch swallows throw from matches query (does not crash)', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error('boom');
            },
          }),
        }),
      }),
    };
    defaultMocks(client);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await expect(prerenderCardsForReport('match-1', reports(), storage())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[api/report] card prerender batch failed:'), expect.any(String));
  });

  it('toCardPayload handles null stats / null xg / null short_code / null match_date', async () => {
    const matchRow = {
      short_code: null,
      competition: 'C',
      home_team: 'H',
      away_team: 'A',
      home_score: 0,
      away_score: 0,
      match_date: null,
      stats: null,
    };
    const client = mkClient(matchRow, [{ id: 'r-hc', style: 'hardcore' }]);
    defaultMocks(client);

    const reps = reports();
    reps.hardcore = { ...reps.hardcore, subtitle: null as unknown as string, body: 'not-array' as unknown as string[] };

    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-noscore', reps, storage());

    // 12 renders:9 张(3 style × 3 platform) + 3 张微信带码版(wechat × 3 style,引流 -qr 键)
    expect(calls.filter((c) => c.op === 'render')).toHaveLength(12);
    const hardcoreCall = calls.find((c) => c.op === 'render' && c.style === 'hardcore' && c.platform === 'wechat');
    expect(hardcoreCall).toBeDefined();
    const payload = (hardcoreCall as Extract<Call, { op: 'render' }>).payload;
    expect(payload.subtitle).toBe('');
    expect(payload.bodyExcerpt).toBe('');
    expect(payload.shortUrl).toBe('qiuhoushuo.com/m/match-noscore');
    expect(payload.date).toBe('');
    expect(payload.homePoss).toBeUndefined();
    expect(payload.homeXG).toBeUndefined();
  });

  it('toCardPayload handles xg with null inner home / string xg value', async () => {
    const matchRow = {
      short_code: 'SC1',
      competition: 'C',
      home_team: 'H',
      away_team: 'A',
      home_score: 1,
      away_score: 1,
      match_date: '2026-06-22T12:00:00Z',
      stats: {
        possession: { home: 50, away: 50 },
        shots: { home: 10, away: 10 },
        shots_on_target: { home: 5, away: 5 },
        xg: { home: null, away: '1.4' },
        pass_accuracy: { home: 80, away: 82 },
      },
    };
    const client = mkClient(matchRow, [{ id: 'r-hc', style: 'hardcore' }]);
    defaultMocks(client);
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-xg', reports(), storage());
    const renderCall = calls.find((c) => c.op === 'render' && c.style === 'hardcore' && c.platform === 'wechat');
    const payload = (renderCall as Extract<Call, { op: 'render' }>).payload;
    expect(payload.homeXG).toBeUndefined();
    expect(payload.awayXG).toBe('1.4');
    expect(payload.shortUrl).toBe('qiuhoushuo.com/m/SC1');
  });

  it('prerendered cards include existing highlight image URL for every platform', async () => {
    const matchRow = {
      short_code: 'SCIMG',
      competition: 'C',
      home_team: 'Argentina',
      away_team: 'Saudi Arabia',
      home_score: 1,
      away_score: 2,
      match_date: '2026-06-22T12:00:00Z',
      stats: {},
    };
    const client = mkClient(matchRow, [{ id: 'r-duanzi', style: 'duanzi' }]);
    defaultMocks(client);
    const cdnUrl = 'https://img.qiuhoushuo.cn/highlight-images/match-img/score-turn.jpg';
    const backingStorage = storageWithHighlightImage(cdnUrl);

    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-img', reports(), backingStorage);

    expect(backingStorage.exists).toHaveBeenCalledWith('highlight-images/match-img/score-turn.jpg');
    const renderCalls = calls.filter((c): c is Extract<Call, { op: 'render' }> => c.op === 'render');
    expect(renderCalls).toHaveLength(12); // 9 + 3 微信带码版
    expect(renderCalls.every((c) =>
      (c.payload.highlightMoment as { image_url?: string } | undefined)?.image_url === cdnUrl,
    )).toBe(true);
    expect(renderCalls[0]?.payload.homeTeam).toBe('阿根廷');
    expect(renderCalls[0]?.payload.awayTeam).toBe('沙特阿拉伯');
  });

  it('reportIds fallback to matchId when style has no row in reports table', async () => {
    const matchRow = {
      short_code: 'SC2',
      competition: 'C',
      home_team: 'H',
      away_team: 'A',
      home_score: 1,
      away_score: 0,
      match_date: '2026-06-22T12:00:00Z',
      stats: {},
    };
    // 只给 hardcore 一行 → duanzi / emotion 走 fallback 到 matchId
    const client = mkClient(matchRow, [{ id: 'r-hc', style: 'hardcore' }]);
    defaultMocks(client);
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-fb', reports(), storage());

    const putKeys = calls.filter((c): c is Extract<Call, { op: 'put' }> => c.op === 'put').map((c) => c.key);
    expect(putKeys).toContain('cards/v34/r-hc/hardcore-wechat.png');
    expect(putKeys).toContain('cards/v34/match-fb/duanzi-wechat.png');
    expect(putKeys).toContain('cards/v34/match-fb/emotion-wechat.png');
  });

  it('reportIds empty array (no reports table rows) falls back to matchId for all styles', async () => {
    const matchRow = {
      short_code: null,
      competition: 'C',
      home_team: 'H',
      away_team: 'A',
      home_score: 0,
      away_score: 0,
      match_date: '2026-06-22T12:00:00Z',
      stats: {},
    };
    const client = mkClient(matchRow, []);
    defaultMocks(client);
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-empty', reports(), storage());

    const putKeys = calls.filter((c): c is Extract<Call, { op: 'put' }> => c.op === 'put').map((c) => c.key);
    expect(putKeys.every((k) => k.startsWith('cards/v34/match-empty/'))).toBe(true);
    expect(putKeys).toHaveLength(12); // 9 + 3 微信带码版(-qr)
    expect(putKeys.filter((k) => k.endsWith('-wechat-qr.png'))).toHaveLength(3); // 三风格各一张微信带码版
  });
});

function mkClient(matchData: Record<string, unknown>, reportRows: Array<{ id: string; style: string }>) {
  return {
    from(table: string) {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: matchData }),
        then: (resolve: (v: { data: typeof reportRows }) => void) => resolve({ data: reportRows }),
      };
      if (table === 'reports') {
        // 让 await db.from('reports').select(...).eq(...) 返回 { data: reportRows }
      }
      return query;
    },
  };
}

describe('warmBriefCard · 一图看懂预热(修冷渲染缺图)', () => {
  it('生产环境 → 自调用容器内回环 brief 端点令其渲染落缓存', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { warmBriefCard } = await import('@/lib/api/card-prerender');
    await warmBriefCard('match-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('127.0.0.1:3000'); // 容器内回环,非公网域名
    expect(url).toContain('/api/card/match-1');
    expect(url).toContain('variant=brief');
    expect(url).toContain('platform=xhs');
    expect(url).toContain('inline=1');
  });

  it('非生产(dev/test)→ 跳过(不自调用,按需渲染兜底)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { warmBriefCard } = await import('@/lib/api/card-prerender');
    await warmBriefCard('match-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warm 失败被吞,不抛(best-effort,不影响主流程)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { warmBriefCard } = await import('@/lib/api/card-prerender');
    await expect(warmBriefCard('match-1')).resolves.toBeUndefined();
  });
});
