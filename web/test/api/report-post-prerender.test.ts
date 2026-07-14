import { afterEach, describe, expect, it, vi } from 'vitest';
import { req } from './_utils';
import type { AlertPayload, NotifyOpsOptions } from '@/lib/alerts';
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

type PrerenderCall =
  | { op: 'generateAllStylesWithPersist' }
  | { op: 'query'; table: string }
  | { op: 'put'; key: string }
  | { op: 'render'; style: string; platform: string }
  | { op: 'notify'; payload: AlertPayload; opts?: NotifyOpsOptions }
  | { op: 'track'; eventId: ServerEvent['eventId']; properties?: Record<string, unknown> };
type PrerenderQuery = {
  columns?: string;
  select(columns: string): PrerenderQuery;
  update(): { eq(): Promise<{ error: null }> };
  eq(): PrerenderQuery;
  maybeSingle(): Promise<{ data: ReturnType<typeof matchRow> | { short_code: null } | null }>;
  then(resolve: (value: { data: ReturnType<typeof reportRows> }) => void): void;
};

const calls: PrerenderCall[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  calls.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('POST /api/report card prerender', () => {
  it('exports maxDuration=60 for Vercel free-tier timeout envelope', async () => {
    const route = await loadRoute();
    expect(route.maxDuration).toBe(60);
  });

  it('prerender starts after persist helper succeeds, does not block response', async () => {
    const blocker = ((): PromiseWithResolvers<{ data: ReturnType<typeof matchRow> }> => {
      let resolve!: PromiseWithResolvers<{ data: ReturnType<typeof matchRow> }>['resolve'];
      let reject!: PromiseWithResolvers<{ data: ReturnType<typeof matchRow> }>['reject'];
      const promise = new Promise<{ data: ReturnType<typeof matchRow> }>((res, rej) => { resolve = res as typeof resolve; reject = rej; });
      return { promise, resolve, reject };
    })();
    const { POST } = await loadRoute({ blocker });
    const res = await POST(reportReq());
    expect(res.status).toBe(200);
    expect(calls).toContainEqual({ op: 'generateAllStylesWithPersist' });
    expect(calls).toContainEqual({ op: 'query', table: 'matches' });
    blocker.resolve({ data: matchRow() });
  });

  it('prerender uses service client to access premium rows', async () => {
    await loadRoute();
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-1', reports(), storage());
    expect(calls).toContainEqual({ op: 'query', table: 'matches' });
    expect(calls).toContainEqual({ op: 'query', table: 'reports' });
    expect(calls.filter((c) => c.op === 'put')).toHaveLength(12); // 9 + 3 微信带码版(-qr 引流键)
    expect(calls.some((c) => c.op === 'put' && c.key === 'cards/v34/r-hardcore/hardcore-wechat.png')).toBe(true);
    expect(calls.some((c) => c.op === 'put' && c.key === 'cards/v34/r-hardcore/hardcore-wechat-qr.png')).toBe(true);
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E051' }));
  });

  it('prerender continues when single render fails', async () => {
    await loadRoute({ failOneRender: true });
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-1', reports(), storage());
    expect(calls.filter((c) => c.op === 'put')).toHaveLength(10); // hardcore-wechat 失败时非qr+qr 两张都跳;余 10
    expect(calls).toContainEqual(expect.objectContaining({
      op: 'notify',
      payload: expect.objectContaining({ severity: 'P2' }),
      opts: { dedupKey: 'card-prerender-done:match-1:ok', dedupWindowMs: 15 * 60 * 1000 },
    }));
  });

  it('missing match alert uses match-scoped 15min dedup', async () => {
    await loadRoute({ missingMatch: true });
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('missing-match-1', reports(), storage());

    expect(calls).toContainEqual(expect.objectContaining({
      op: 'notify',
      payload: expect.objectContaining({
        severity: 'P1',
        title: 'card 预生成跳过',
        tags: ['card-prerender'],
      }),
      opts: { dedupKey: 'card-prerender-missing:missing-match-1', dedupWindowMs: 15 * 60 * 1000 },
    }));
    expect(calls.some((c) => c.op === 'put')).toBe(false);
  });

  it('missing match alert keeps each matchId independent', async () => {
    await loadRoute({ missingMatch: true });
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('missing-a', reports(), storage());
    await prerenderCardsForReport('missing-b', reports(), storage());

    expect(notifyCalls().map((call) => call.opts)).toEqual([
      { dedupKey: 'card-prerender-missing:missing-a', dedupWindowMs: 15 * 60 * 1000 },
      { dedupKey: 'card-prerender-missing:missing-b', dedupWindowMs: 15 * 60 * 1000 },
    ]);
  });

  it('successful prerender done alert uses ok status in dedup key', async () => {
    await loadRoute();
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-ok', reports(), storage());

    expect(notifyCalls()).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ severity: 'P2', title: 'card 预生成完成' }),
      opts: { dedupKey: 'card-prerender-done:match-ok:ok', dedupWindowMs: 15 * 60 * 1000 },
    }));
  });

  it('all-failed prerender done alert uses fail status independent from ok', async () => {
    await loadRoute({ failAllRender: true });
    const { prerenderCardsForReport } = await import('@/lib/api/card-prerender');
    await prerenderCardsForReport('match-fail', reports(), storage());

    expect(notifyCalls()).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ severity: 'P1', title: 'card 预生成全部失败' }),
      opts: { dedupKey: 'card-prerender-done:match-fail:fail', dedupWindowMs: 15 * 60 * 1000 },
    }));
  });

  it('prerender does not run when persist helper fails', async () => {
    const { POST } = await loadRoute({ failPersist: true });
    const res = await POST(reportReq());
    expect(res.status).toBe(500);
    expect(calls.some((c) => c.op === 'query' && c.table === 'reports')).toBe(false);
  });
});

async function loadRoute(opts: {
  failPersist?: boolean;
  failOneRender?: boolean;
  failAllRender?: boolean;
  missingMatch?: boolean;
  blocker?: PromiseWithResolvers<{ data: ReturnType<typeof matchRow> }>;
} = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => serviceClient(opts.blocker, opts.missingMatch) }));
  vi.doMock('@/lib/report', () => ({
    generateAllStyles: vi.fn(async () => reports()),
    generateAllStylesWithPersist: vi.fn(async () => {
      calls.push({ op: 'generateAllStylesWithPersist' });
      return opts.failPersist
        ? { reports: reports(), persisted: false, persistError: 'persist fail' }
        : { reports: reports(), persisted: true };
    }),
  }));
  vi.doMock('@/lib/share-cards', () => ({
    renderShareCard: vi.fn(async (style: string, platform: string) => {
      calls.push({ op: 'render', style, platform });
      if (opts.failAllRender) throw new Error('render fail all');
      if (opts.failOneRender && style === 'hardcore' && platform === 'wechat') throw new Error('render fail');
      return Buffer.from('png');
    }),
    flagUrl: (n: string) => (n ? `https://qiuhoushuo.com/flags/${n}.png` : undefined),
  }));
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: (payload: AlertPayload, opts?: NotifyOpsOptions) => calls.push({ op: 'notify', payload, opts }),
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => calls.push({ op: 'track', eventId: event.eventId, properties: event.properties }),
  }));
  return import('@/app/api/report/route');
}

function notifyCalls() {
  return calls.filter((call): call is Extract<PrerenderCall, { op: 'notify' }> => call.op === 'notify');
}

function serviceClient(blocker?: PromiseWithResolvers<{ data: ReturnType<typeof matchRow> }>, missingMatch = false) {
  return {
    from(table: string) {
      const query: PrerenderQuery = {
        select: (columns: string) => {
          query.columns = columns;
          return query;
        },
        update: () => ({
          eq: async () => ({ error: null }),
        }),
        eq: () => {
          calls.push({ op: 'query', table });
          return query;
        },
        maybeSingle: async () => {
          if (table === 'matches' && query.columns === 'short_code') return { data: { short_code: null } };
          if (table === 'matches' && missingMatch) return { data: null };
          return blocker ? blocker.promise : { data: matchRow() };
        },
        then: (resolve: (value: { data: ReturnType<typeof reportRows> }) => void) => resolve({ data: reportRows() }),
      };
      return query;
    },
  };
}

function storage() {
  return {
    exists: vi.fn(),
    put: vi.fn(async (key: string) => {
      calls.push({ op: 'put', key });
      return `memory://${key}`;
    }),
  };
}

function reportReq() {
  return req('/api/report', {
    method: 'POST',
    headers: { 'x-internal-token': 'dev-internal-token' },
    body: JSON.stringify(payload),
  });
}

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

function matchRow() {
  return {
    short_code: 'mock001',
    competition: '国际大赛小组赛',
    home_team: '巴西',
    away_team: '西班牙',
    home_score: 2,
    away_score: 1,
    match_date: '2026-06-16T00:00:00Z',
    stats: {},
  };
}

function reportRows() {
  return [
    { id: 'r-hardcore', style: 'hardcore' },
    { id: 'r-duanzi', style: 'duanzi' },
    { id: 'r-emotion', style: 'emotion' },
  ];
}
