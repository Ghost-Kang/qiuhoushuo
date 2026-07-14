import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { authed, json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetFlagsForTests();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.FEATURE_FLAG_HOST_INTRO_CARD;
  delete process.env.REPORT_PAYWALL_ENABLED;
});

describe('/api/report/[id]', () => {
  it('returns report detail', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    const body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(body.duanzi.title).toBeTruthy();
  });

  it('付费墙默认关:mock 预览路径 premium 文体也解锁(不锁)', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore.premium_locked).toBe(false); // 默认关:mock hardcore 不再锁
  });

  it('rejects bad path id', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    expect((await GET(authed('/api/report/'), { params: Promise.resolve({ id: '' }) })).status).toBe(400);
  });

  it('rejects id with comma', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    expect((await GET(authed('/api/report/abc,is_premium.eq.true'), { params: Promise.resolve({ id: 'abc,is_premium.eq.true' }) })).status).toBe(400);
  });

  it('rejects id with dot', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    expect((await GET(authed('/api/report/abc.eq.true'), { params: Promise.resolve({ id: 'abc.eq.true' }) })).status).toBe(400);
  });

  it('requires x-openid', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    expect((await GET(req('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) })).status).toBe(401);
  });

  it('matches miniprogram detail shape', async () => {
    const { GET } = await import('@/app/api/report/[id]/route');
    const body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(Object.keys(body)).toEqual(['id', 'short_code', 'competition', 'date', 'match', 'home_team', 'away_team', 'home_score', 'away_score', 'highlight_moments', 'hardcore', 'duanzi', 'emotion', 'brief_card']);
    expect(body.highlight_moments[0]).toMatchObject({ id: 'score-turn', kind: 'goal' });
    expect(body.brief_card).toMatchObject({
      schema_version: 'match_brief_card_v1',
      one_sentence_summary: expect.stringContaining('巴西 2:1 西班牙'),
    });
  });

  it('returns host_intro only when host intro flag is enabled', async () => {
    let { GET } = await import('@/app/api/report/[id]/route');
    let body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(body).not.toHaveProperty('host_intro');
    vi.resetModules();
    process.env.FEATURE_FLAG_HOST_INTRO_CARD = '100';
    ({ GET } = await import('@/app/api/report/[id]/route'));
    body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(body.host_intro).toBeTruthy();
  });

  it('omits host_intro field until host_intro_card flag is enabled', async () => {
    let { GET } = await import('@/app/api/report/[id]/route');
    let body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(Object.keys(body)).not.toContain('host_intro');

    process.env.FEATURE_FLAG_HOST_INTRO_CARD = '100';
    __resetFlagsForTests();
    vi.resetModules();
    ({ GET } = await import('@/app/api/report/[id]/route'));
    body = await json(await GET(authed('/api/report/abc123'), { params: Promise.resolve({ id: 'abc123' }) }));
    expect(Object.keys(body)).toContain('host_intro');
  });

  it('returns 404 when match not found in DB', async () => {
    const { GET } = await loadDbRoute('no-match');
    const res = await GET(authed('/api/report/missing'), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('returns 404 when reports are empty in DB', async () => {
    const { GET } = await loadDbRoute('empty-reports');
    const res = await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('appends AIGC footer to ending in returned reports', async () => {
    const { GET } = await loadDbRoute('with-report');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.duanzi.ending).toBe('原结尾\n\n【AI 生成内容】');
  });

  it('详情头部:赛事名商标词清洗(→国际大赛)+ 英文队名翻译为中文', async () => {
    const { GET } = await loadDbRoute('with-report', {}, {
      competition: 'World Cup 2026 - Group Stage - 1', // trademark-allowed
      home_team: 'Canada', away_team: 'South Korea', home_score: 1, away_score: 2,
    });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.competition).toBe('国际大赛 2026 · 小组赛第1轮');
    expect(body.competition).not.toMatch(/world\s*cup/i);
    expect(body.match).toBe('加拿大 1:2 韩国'); // Canada→加拿大, South Korea→韩国
    // 结构化对阵(小程序详情页国旗 VS 用):队名中文化 + 比分
    expect(body.home_team).toBe('加拿大');
    expect(body.away_team).toBe('韩国');
    expect(body.home_score).toBe(1);
    expect(body.away_score).toBe(2);
  });

  it('does not pollute other report fields with AIGC footer', async () => {
    const { GET } = await loadDbRoute('with-report');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.duanzi.title).toBe('原标题');
    expect(body.duanzi.lead).toBe('原导语');
    expect(body.duanzi.body).toEqual(['原正文']);
    expect(body.duanzi.share_quote).toBe('原金句');
  });

  it('returns highlight moments for miniprogram lens cards', async () => {
    const { GET } = await loadDbRoute('with-report');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.highlight_moments).toHaveLength(3);
    expect(body.highlight_moments[0].title).toBe('巴西把比分写进镜头');
    expect(body.highlight_moments[0].image_prompt).toContain('非真实球员肖像');
  });

  it('returns one-image-understand brief card for miniprogram quick scan', async () => {
    const { GET } = await loadDbRoute('with-report');
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.brief_card).toMatchObject({
      schema_version: 'match_brief_card_v1',
      title: '一图看懂：原标题',
      match_line: expect.stringContaining('巴西 2:1 西班牙'),
      share_line: '原金句',
    });
    expect(body.brief_card.key_reasons).toHaveLength(3);
    expect(body.brief_card.data_points).toContainEqual({ label: 'xG', value: '1.9:1.4', note: '巴西更接近高质量机会' });
    expect(body.brief_card.timeline[0]).toMatchObject({ minute: '关键进球' });
  });

  it('adds image_url to highlight moments when generated images already exist in storage', async () => {
    const { GET, storage } = await loadDbRoute('with-report', {
      'highlight-images/match-1/score-turn.jpg': 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.jpg',
    });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(storage.lookups).toEqual([
      'highlight-images/match-1/score-turn.jpg',
      'highlight-images/match-1/pressure-wave.jpg',
      'highlight-images/match-1/final-whistle.jpg',
    ]);
    expect(body.highlight_moments[0]).toMatchObject({
      id: 'score-turn',
      image_url: 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.jpg',
    });
    expect(body.brief_card.highlight_lens).toMatchObject({
      image_url: 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.jpg',
    });
    expect(body.highlight_moments[1]).not.toHaveProperty('image_url');
  });

  it('resolves a match UUID (小程序从赛事卡传 matchId 而非 report.id) to its reports (F58)', async () => {
    const { GET } = await loadDbRoute('with-report');
    const matchUuid = '155ae496-9cb1-46fe-a447-2bedaa531061';
    const res = await GET(authed(`/api/report/${matchUuid}`), { params: Promise.resolve({ id: matchUuid }) });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.duanzi.title).toBe('原标题');
  });
});

type Scenario = 'no-match' | 'empty-reports' | 'with-report';
type StorageHits = Record<string, string>;
type ReportQuery = {
  select(): ReportQuery;
  eq(): ReportQuery | Promise<{ data: ReturnType<typeof reportRow>[] }>;
  maybeSingle(): Promise<{ data: { id: string } | { match_id: string } | null }>;
};

async function loadDbRoute(scenario: Scenario, storageHits: StorageHits = {}, matchOverride: Record<string, unknown> = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  const storage = {
    lookups: [] as string[],
    async exists(key: string) {
      storage.lookups.push(key);
      return storageHits[key] ?? null;
    },
    async put() {
      throw new Error('report detail should not generate highlight images');
    },
  };
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => reportClient(scenario, matchOverride) }));
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => storage }));
  return { ...(await import('@/app/api/report/[id]/route')), storage };
}

function reportClient(scenario: Scenario, matchOverride: Record<string, unknown> = {}) {
  return {
    from(table: string) {
      const query: ReportQuery = {
        select: () => query,
        eq: (col?: string) => {
          if (table === 'reports') {
            // 主查询 eq('match_id') 直接 await；resolveMatchId 的 eq('id').maybeSingle() 走 report.id 解析
            if (col === 'id') return { maybeSingle: async () => ({ data: null }) } as unknown as ReportQuery;
            return Promise.resolve({ data: scenario === 'with-report' ? [reportRow(matchOverride)] : [] });
          }
          return query;
        },
        maybeSingle: async () => {
          if (table === 'users') return { data: null };
          if (table === 'matches') return { data: scenario === 'no-match' ? null : { id: 'match-1' } };
          return { data: null };
        },
      };
      return query;
    },
  };
}

function reportRow(matchOverride: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    match_id: 'match-1',
    style: 'duanzi',
    title: '原标题',
    subtitle: '原副标题',
    lead: '原导语',
    body: ['原正文'],
    ending: '原结尾',
    share_quote: '原金句',
    tags: ['tag'],
    is_premium: false,
    matches: {
      short_code: 'mock001',
      competition: '国际大赛小组赛',
      match_date: '2026-06-16T00:00:00Z',
      home_team: '巴西',
      away_team: '西班牙',
      home_score: 2,
      away_score: 1,
      stats: { shots: { home: 11, away: 14 }, xg: { home: 1.9, away: 1.4 } },
      ...matchOverride,
    },
  };
}

describe('/api/report/[id] · SKU 级权益付费墙', () => {
  it('deep_report（赛事通）解锁全程 premium', async () => {
    const { GET } = await loadEntitlement({ user: { id: 'u1' }, skus: ['deep_report'], reports: [freeReport(), premiumReport([])] });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore).toBeTruthy();
    expect(body.hardcore.premium_locked).toBe(false); // 已付费:不锁
    expect(body.hardcore.body).toEqual(['B1', 'B2']); // 已付费:全文
    expect(body.duanzi).toBeTruthy();
  });

  it('final_column（决赛专栏）解锁带 scenario:final_column 标记的报告', async () => {
    const { GET } = await loadEntitlement({ user: { id: 'u1' }, skus: ['final_column'], reports: [freeReport(), premiumReport(['scenario:final_column'])] });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore).toBeTruthy();
  });

  it('final_column 不解锁未打标的 premium → 锁定(付费墙,非隐藏)', async () => {
    const { GET } = await loadEntitlement({ user: { id: 'u1' }, skus: ['final_column'], reports: [freeReport(), premiumReport(['scenario:other'])] });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore.premium_locked).toBe(true); // 保留但锁定
    expect(body.duanzi).toBeTruthy();
  });

  it('无成功支付时 premium 保持锁定 + 正文仅首段预览(不泄露全文)', async () => {
    const { GET } = await loadEntitlement({ user: { id: 'u1' }, skus: [], reports: [freeReport(), premiumReport([])] });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore).toBeTruthy();
    expect(body.hardcore.premium_locked).toBe(true);
    expect(body.hardcore.body).toEqual(['B1']); // 锁定:正文截断为首段预览
    expect(body.hardcore.ending).toBe(''); // 锁定:收尾不下发
  });

  it('付费墙总开关关(REPORT_PAYWALL_ENABLED 未设)→ 未付费也解锁 premium、给全文(免费让用户用起来)', async () => {
    const { GET } = await loadEntitlement({ user: { id: 'u1' }, skus: [], reports: [freeReport(), premiumReport([])], paywall: false });
    const body = await json(await GET(authed('/api/report/mock001'), { params: Promise.resolve({ id: 'mock001' }) }));
    expect(body.hardcore.premium_locked).toBe(false); // 开关关:不锁
    expect(body.hardcore.body).toEqual(['B1', 'B2']); // 全文(不截断)
    expect(body.hardcore.ending).not.toBe(''); // 收尾照常下发
  });
});

interface EntOpts {
  user: { id: string } | null;
  skus: string[];
  reports: object[];
  paywall?: boolean; // 默认开(=1)以验证锁定逻辑;传 false 验证总开关关→免费解锁
}

function entRow(o: { id: string; style: string; is_premium: boolean; tags: string[] }) {
  return {
    id: o.id,
    match_id: 'match-1',
    style: o.style,
    title: 'T',
    subtitle: 'S',
    lead: 'L',
    body: ['B1', 'B2'],
    ending: 'E',
    share_quote: 'Q',
    tags: o.tags,
    is_premium: o.is_premium,
    matches: { short_code: 'mock001', competition: '国际大赛', match_date: '2026-06-16T00:00:00Z', home_team: 'A', away_team: 'B', home_score: 1, away_score: 0, stats: {} },
  };
}

function freeReport() {
  return entRow({ id: 'free-1', style: 'duanzi', is_premium: false, tags: ['t'] });
}

function premiumReport(tags: string[]) {
  return entRow({ id: 'prem-1', style: 'hardcore', is_premium: true, tags });
}

async function loadEntitlement(opts: EntOpts) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  if (opts.paywall !== false) process.env.REPORT_PAYWALL_ENABLED = '1';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => entitlementClient(opts) }));
  return import('@/app/api/report/[id]/route');
}

function entitlementClient(opts: EntOpts) {
  return {
    from(table: string) {
      if (table === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.user }) }) }) };
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'match-1' } }) }) }) };
      if (table === 'reports') {
        return {
          select: () => ({
            eq: (col: string) => (col === 'match_id' ? Promise.resolve({ data: opts.reports }) : { maybeSingle: async () => ({ data: { match_id: 'match-1' } }) }),
          }),
        };
      }
      if (table === 'payments') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: opts.skus.map((s) => ({ sku: s })) }) }) }) };
      }
      return {};
    },
  };
}
