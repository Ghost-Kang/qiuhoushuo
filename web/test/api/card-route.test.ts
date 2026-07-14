import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { ReportStyle } from '@/lib/prompts';
import type { CardPayload, Platform } from '@/lib/share-cards';
import type { ServerEvent } from '@/lib/api/tracker';

type CardDbCall = { table: string; columns?: string; filters: Record<string, string> };
type BaseCardReportRow = ReturnType<typeof reportRow>;
type CardReportRow = BaseCardReportRow | (Omit<BaseCardReportRow, 'matches'> & { matches: BaseCardReportRow['matches'][] | null });
type CardStorage = {
  exists: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};
type CardKeyInput = { reportId: string; style: ReportStyle; platform: Platform };
type BriefSiblingRow = { style: ReportStyle; title: string; lead?: string | null; share_quote: string };
type CardQuery = {
  columns?: string;
  select(columns: string): CardQuery;
  eq(column: string, value: string): CardQuery;
  then(resolve: (v: { data: BriefSiblingRow[] | null }) => void): void;
  maybeSingle(): Promise<{ data: { id: string } | CardReportRow | null }>;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.CARD_PRERENDER_DISABLE;
});

describe('/api/card/[reportId]', () => {
  it('returns 404 when report not found in DB', async () => {
    const { GET } = await loadRoute(null);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('renders payload assembled from reports and matches join', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      competition: '国际大赛小组赛',
      homeTeam: '巴西',
      awayTeam: '西班牙',
      title: '段子标题',
      shareQuote: '金句',
      shortUrl: 'qiuhoushuo.com/m/mock001',
    }), { withQr: true });
  });

  it('红线护栏:站外平台(x/xhs)即便 ?qr=1 也强制 withQr:false;wechat+qr=1 才 true(审查 P3-6)', async () => {
    // 注:多次 loadRoute 间须 resetModules,否则路由模块缓存致后续 doMock 不生效(render 落到上一次的 mock)。
    for (const platform of ['x', 'xhs'] as Platform[]) {
      vi.resetModules();
      const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const { GET } = await loadRoute(reportRow(), render);
      await GET(nextReq(`/api/card/r1?style=duanzi&platform=${platform}&qr=1`), { params: Promise.resolve({ reportId: 'r1' }) });
      // 站外:?qr=1 被收敛到 wechat,withQr 必 false(带微信码=限流封号红线)
      expect(render).toHaveBeenCalledWith('duanzi', platform, expect.anything(), { withQr: false });
    }
    // 正向对照:wechat + qr=1 → withQr:true
    vi.resetModules();
    const renderW = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), renderW);
    await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat&qr=1'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(renderW).toHaveBeenCalledWith('duanzi', 'wechat', expect.anything(), { withQr: true });
  });

  it('adds existing highlight image URL to share-card payload', async () => {
    const storage = {
      exists: vi.fn(async (key: string) => (
        key === 'highlight-images/match-1/score-turn.jpg'
          ? 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.jpg'
          : null
      )),
      put: vi.fn(async () => 'memory://cards/r1/duanzi-wechat.png'),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });

    expect(res.status).toBe(200);
    expect(storage.exists).toHaveBeenCalledWith('highlight-images/match-1/score-turn.jpg');
    expect(render).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      highlightMoment: expect.objectContaining({
        title: '巴西把比分写进镜头',
        image_url: expect.stringMatching(/^data:image\//), // 路由已预取为 data URL
      }),
    }), { withQr: true });
  });

  it('renders payload when Supabase returns joined matches as an array', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute({ ...reportRow(), matches: [reportRow().matches] }, render);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      competition: '国际大赛小组赛',
      shortUrl: 'qiuhoushuo.com/m/mock001',
    }), { withQr: true });
  });

  it('renders stable fallback fields when joined match is absent', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute({ ...reportRow(), matches: null }, render);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      competition: '',
      homeTeam: '',
      awayTeam: '',
      homeScore: 0,
      awayScore: 0,
      shortUrl: 'qiuhoushuo.com/m/r1',
    }), { withQr: true });
  });

  it('rejects reportId with invalid chars', async () => {
    const { GET } = await loadRoute(reportRow());
    const res = await GET(nextReq('/api/card/r1?style=duanzi'), { params: Promise.resolve({ reportId: 'abc.eq.true' }) });
    expect(res.status).toBe(400);
  });

  it('redirects to CDN URL when storage hit', async () => {
    const storage = {
      exists: vi.fn(async () => 'https://cdn.example.com/cards/r1/duanzi-wechat.png'),
      put: vi.fn(),
    };
    const { GET } = await loadRoute(reportRow(), undefined, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn.example.com/cards/r1/duanzi-wechat.png');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('resolves short_code to reports.id before storage lookup', async () => {
    const storage = {
      exists: vi.fn(async () => 'https://cdn.example.com/cards/r1/duanzi-wechat.png'),
      put: vi.fn(),
    };
    const { GET } = await loadRoute(reportRow(), undefined, storage);
    const res = await GET(nextReq('/api/card/mock001?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'mock001' }) });
    expect(res.status).toBe(302);
    expect(storage.exists).toHaveBeenCalledWith('cards/r1/duanzi-wechat-qr.png');
    expect(res.headers.get('location')).toBe('https://cdn.example.com/cards/r1/duanzi-wechat.png');
  });

  it('report.id UUID 经单次 reports.id 确认后命中存储', async () => {
    const reportId = '11111111-1111-4111-8111-111111111111';
    const dbCalls: CardDbCall[] = [];
    const storage = {
      exists: vi.fn(async () => `https://cdn.example.com/cards/${reportId}/duanzi-wechat.png`),
      put: vi.fn(),
    };
    const { GET } = await loadRoute(reportRow({ id: reportId }), undefined, storage, dbCalls);
    const res = await GET(nextReq(`/api/card/${reportId}?style=duanzi&platform=wechat`), { params: Promise.resolve({ reportId }) });
    expect(res.status).toBe(302);
    expect(storage.exists).toHaveBeenCalledWith(`cards/${reportId}/duanzi-wechat-qr.png`);
    // F53 修复：UUID 不再无条件当 report.id 短路，先做一次 reports.id 确认（命中即用）
    expect(dbCalls).toEqual([{ table: 'reports', columns: 'id', filters: { id: reportId } }]);
  });

  it('match.id UUID(小程序从赛事卡传 matchId)解析到 reports.id 再查存储 (F53)', async () => {
    const reportUuid = '22222222-2222-4222-8222-222222222222';
    const matchUuid = '33333333-3333-4333-8333-333333333333';
    const dbCalls: CardDbCall[] = [];
    const storage = {
      exists: vi.fn(async () => `https://cdn.example.com/cards/${reportUuid}/duanzi-wechat.png`),
      put: vi.fn(),
    };
    const { GET } = await loadRoute(reportRow({ id: reportUuid, matchId: matchUuid }), undefined, storage, dbCalls);
    const res = await GET(nextReq(`/api/card/${matchUuid}?style=duanzi&platform=wechat`), { params: Promise.resolve({ reportId: matchUuid }) });
    expect(res.status).toBe(302);
    // 关键：存储 key 用解析后的 reports.id，而非传入的 matchId（旧逻辑用 matchId → 404）
    expect(storage.exists).toHaveBeenCalledWith(`cards/${reportUuid}/duanzi-wechat-qr.png`);
    expect(res.headers.get('location')).toBe(`https://cdn.example.com/cards/${reportUuid}/duanzi-wechat.png`);
    // 解析顺序：reports.id(matchUuid) 落空 → reports.match_id(matchUuid, style) 命中
    expect(dbCalls).toEqual([
      { table: 'reports', columns: 'id', filters: { id: matchUuid } },
      { table: 'reports', columns: 'id', filters: { match_id: matchUuid, style: 'duanzi' } },
    ]);
  });

  it('falls back to live render when storage misses, then back-fills storage（镜头图已就位）', async () => {
    const storage = {
      // 镜头图已生成(highlight-images key 命中),卡缓存未命中 → 渲染后允许回填
      exists: vi.fn(async (key: string) => (key.startsWith('highlight-images/') ? `https://img.example.com/${key}` : null)),
      put: vi.fn(async () => 'memory://cards/r1/duanzi-wechat.png'),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(storage.exists).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith('cards/r1/duanzi-wechat-qr.png', expect.any(Buffer), 'image/png');
  });

  it('skips back-fill when the moment image prefetch fails（F65:CDN 超时不许钉死兜底卡）', async () => {
    const storage = {
      exists: vi.fn(async (key: string) => (key.startsWith('highlight-images/') ? `https://img.example.com/${key}` : null)),
      put: vi.fn(),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { GET } = await loadRoute(reportRow(), render, storage);
    // 覆写全局 fetch:模拟 CDN 拉图超时/失败
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200); // 照常出图(模板兜底)
    expect(storage.put).not.toHaveBeenCalled(); // 但绝不缓存
    expect(warn).toHaveBeenCalled();
    // 且渲染收到的 image_url 是 undefined(显式降级,而非把坏 URL 留给渲染层静默失败)
    expect(render).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      highlightMoment: expect.objectContaining({ image_url: undefined }),
    }), { withQr: true });
  });

  it('skips back-fill while the moment image is still pending（6/12:防"先渲染后生图"钉死无图卡）', async () => {
    const storage = {
      exists: vi.fn(async () => null), // 镜头图未生成
      put: vi.fn(),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200); // 照常出图给用户
    expect(storage.put).not.toHaveBeenCalled(); // 但不落 immutable 缓存
  });

  it('renders downloadable one-image-understand card with an isolated cache key', async () => {
    const storage = {
      exists: vi.fn(async (key: string) => (key.startsWith('highlight-images/') ? `https://img.example.com/${key}` : null)),
      put: vi.fn(async () => 'memory://cards/v8/r1/brief-full-xhs.png'),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=brief'), { params: Promise.resolve({ reportId: 'r1' }) });

    expect(res.status).toBe(200);
    expect(storage.exists).toHaveBeenCalledWith('cards/v8/r1/brief-full-xhs.png');
    expect(storage.put).toHaveBeenCalledWith('cards/v8/r1/brief-full-xhs.png', expect.any(Buffer), 'image/png');
    expect(render).toHaveBeenCalledWith('brief', 'xhs', expect.objectContaining({
      title: '一图看懂：段子标题',
      subtitle: expect.stringContaining('巴西 2:1 西班牙'),
      bodyExcerpt: expect.stringContaining('巴西把比分优势守到终场'),
      shareQuote: '金句',
      brand: '超帧球后说 · 一图看懂 · AI 生成',
      briefCard: expect.objectContaining({
        title: '一图看懂：段子标题',
        key_reasons: expect.arrayContaining([
          expect.objectContaining({ title: '巴西把比分优势守到终场' }),
          expect.objectContaining({ title: '西班牙控球占优却效率告负' }),
        ]),
        timeline: expect.arrayContaining([
          expect.objectContaining({ minute: '关键进球' }),
        ]),
        data_points: expect.arrayContaining([
          expect.objectContaining({ label: 'xG', value: '1.9:1.4' }),
        ]),
      }),
      highlightMoment: expect.objectContaining({ title: '巴西把比分写进镜头' }),
    }), { withQr: false });
  });

  it('rejects brief variant on non-xhs platforms because the full card is vertical', async () => {
    const { GET } = await loadRoute(reportRow());
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=x&variant=brief'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'brief variant only supports xhs platform' });
  });

  it('renders 球员评分 card: 队名英→中、名字 fontSafe(去豆腐块)+ 控长,独立 ratings 缓存 key', async () => {
    const storage = {
      exists: vi.fn(async () => null),
      put: vi.fn(async () => 'memory://cards/v8/r1/ratings-full-xhs.png'),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(ratingsRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=ratings'), { params: Promise.resolve({ reportId: 'r1' }) });

    expect(res.status).toBe(200);
    // 与 brief 隔离的独立 key(不复用 style-platform,bump 同 cache 版本)
    expect(storage.exists).toHaveBeenCalledWith('cards/v8/r1/ratings-full-xhs.png');
    expect(storage.put).toHaveBeenCalledWith('cards/v8/r1/ratings-full-xhs.png', expect.any(Buffer), 'image/png');
    expect(render).toHaveBeenCalledWith('ratings', 'xhs', expect.objectContaining({
      brand: '超帧球后说 · 球员评分 · AI 生成',
      ratingsCard: expect.objectContaining({
        match_line: expect.stringContaining('土耳其 3:2 美国'),
        // 优先中文译名(lookupPlayerZh);字典 miss 回退 compactName(fontSafe)
        motm: expect.objectContaining({ name: '恰尔汗奥卢', team: '土耳其', rating: 8.1 }),
        home: expect.objectContaining({
          team: '土耳其',
          players: expect.arrayContaining([
            expect.objectContaining({ name: '阿尔达·居莱尔', rating: 8.7, goals: 1, assists: 1 }),
            expect.objectContaining({ name: '耶尔德兹', rating: 7.4 }),
          ]),
        }),
        // 全员字典覆盖后 Sebastian Berhalter 也有中文译名
        away: expect.objectContaining({
          players: expect.arrayContaining([
            expect.objectContaining({ name: '贝哈尔特', rating: 7.2 }),
          ]),
        }),
      }),
    }), { withQr: false });
  });

  it('反向验证:带商标词的原始赛事名经 sanitizeCompetition 脱敏后才进 ratingsCard.match_line', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const row = ratingsRow();
    row.matches.competition = 'FIFA World Cup 2026 - Group Stage'; // trademark-allowed:模拟上游脏赛事名
    const { GET } = await loadRoute(row, render);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=ratings'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    const payload = (render.mock.calls[0] as unknown as [string, Platform, CardPayload])[2];
    const matchLine = payload.ratingsCard!.match_line;
    expect(matchLine).toContain('国际大赛'); // 脱敏后中性名
    expect(matchLine).not.toMatch(/world\s*cup/i); // 商标词清零
    expect(matchLine).not.toContain('FIF' + 'A');
  });

  it('rejects ratings variant on non-xhs platforms(竖版卡仅 xhs)', async () => {
    const { GET } = await loadRoute(ratingsRow());
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat&variant=ratings'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'ratings variant only supports xhs platform' });
  });

  it('ratings 卡无 stats.players → 404 NO_DATA + no-store,不渲不缓存(小程序据此隐藏入口)', async () => {
    const storage = { exists: vi.fn(async () => null), put: vi.fn(async () => 'memory://x') };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage); // reportRow 无 players
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=ratings'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NO_DATA' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('inline=1 命中缓存时直返 PNG 字节而非 302(真机 wx.downloadFile 不跟跨域 302)', async () => {
    const storage = {
      exists: vi.fn(async () => 'https://cdn.example.com/cards/v31/r1/brief-full-xhs.png'),
      put: vi.fn(),
      getBytes: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])), // COS API 读字节(容器内可达,不碰 CDN)
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=brief&inline=1'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(storage.getBytes).toHaveBeenCalled(); // 命中缓存 → 走 COS getBytes 直返字节
    expect(render).not.toHaveBeenCalled(); // 不重渲染
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('inline=1 未命中缓存时渲染直返 PNG(不 302)', async () => {
    const storage = { exists: vi.fn(async () => null), put: vi.fn(async () => 'memory://x') };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat&inline=1'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalled();
  });

  it('F67f brief 跨风格合成:同场 hardcore/duanzi/emotion 全部喂入,标题取 hardcore、过程条回退取 hardcore 导语', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const siblings: BriefSiblingRow[] = [
      { style: 'hardcore', title: '硬核标题', lead: '硬核导语', share_quote: '硬核金句' },
      { style: 'duanzi', title: '段子标题', lead: '段子导语', share_quote: '段子金句' },
      { style: 'emotion', title: '情绪标题', lead: '瓜达拉哈拉的夏夜，记分牌在第59分钟定格，那一刻看台陷入沉寂。', share_quote: '情绪金句' },
    ];
    const { GET } = await loadRoute(reportRow(), render, undefined, [], [], siblings);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=brief'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    const payload = (render.mock.calls[0] as unknown as [string, Platform, CardPayload])[2];
    const reasons = payload.briefCard!.key_reasons;
    // reportRow 无事件 → 过程条(第3条)回退取 hardcore 导语(跨风格喂入才有),而非单 style 默认短句
    expect(reasons[2]!.evidence).toBe('硬核导语');
    // coreTitle 跨风格取 hardcore 标题
    expect(payload.briefCard!.title).toBe('一图看懂：硬核标题');
  });

  it('反向锚点:brief 无 sibling(单 style)时过程条回退到默认短句 — 证明上面差异确来自跨风格喂入', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute(reportRow(), render); // 不传 siblings
    await GET(nextReq('/api/card/r1?style=duanzi&platform=xhs&variant=brief'), { params: Promise.resolve({ reportId: 'r1' }) });
    const payload = (render.mock.calls[0] as unknown as [string, Platform, CardPayload])[2];
    // 无 hardcore 导语可取 → 第3条回退到默认短句(而非 hardcore 导语)
    expect(payload.briefCard!.key_reasons[2]!.evidence).toBe('谁先把节奏、效率和关键回合串起来，谁就掌握了胜负。');
  });

  it('tracks E053 when realtime render fallback is used', async () => {
    const track: ServerEvent[] = [];
    const storage = {
      exists: vi.fn(async () => null),
      put: vi.fn(async () => 'memory://cards/r1/duanzi-wechat.png'),
    };
    const { GET } = await loadRoute(reportRow(), undefined, storage, [], track);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(track).toContainEqual(expect.objectContaining({ eventId: 'E053' }));
  });

  it('returns PNG when storage.put back-fill throws', async () => {
    const storage = {
      // 镜头图已就位(否则会按"等图中"跳过 put,测不到 put 异常分支)
      exists: vi.fn(async (key: string) => (key.startsWith('highlight-images/') ? `https://img.example.com/${key}` : null)),
      put: vi.fn(async () => {
        throw new Error('storage down');
      }),
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { GET } = await loadRoute(reportRow(), render, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(storage.put).toHaveBeenCalledWith('cards/r1/duanzi-wechat-qr.png', expect.any(Buffer), 'image/png');
    expect(warn).toHaveBeenCalledWith('[api/card] lazy back-fill failed:', 'storage down');
  });

  it('CARD_PRERENDER_DISABLE=1 always skips storage check', async () => {
    process.env.CARD_PRERENDER_DISABLE = '1';
    const storage = {
      exists: vi.fn(async () => 'https://cdn.example.com/cards/r1/duanzi-wechat.png'),
      put: vi.fn(),
    };
    const { GET } = await loadRoute(reportRow(), undefined, storage);
    const res = await GET(nextReq('/api/card/r1?style=duanzi&platform=wechat'), { params: Promise.resolve({ reportId: 'r1' }) });
    expect(res.status).toBe(200);
    expect(storage.exists).not.toHaveBeenCalledWith('cards/r1/duanzi-wechat.png');
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe('/api/card/[reportId] USE_DB=false mock fallback', () => {
  it('renders hardcore style with mock payload when USE_DB=false', async () => {
    const { GET, render } = await loadRouteWithoutDb();
    const res = await GET(nextReq('/api/card/mock-fallback?style=hardcore&platform=wechat'), {
      params: Promise.resolve({ reportId: 'mock-fallback' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledWith('hardcore', 'wechat', expect.objectContaining({
      title: '传控大师败给了 xG 效率',
      subtitle: '巴西用 11 次射门换 1.9 xG',
      bodyExcerpt: '',
      shareQuote: 'xG 1.9 vs 1.4，比分公平，叙事不公平。',
      brand: '超帧球后说 · AI 生成',
      shortUrl: 'qiuhoushuo.com/m/mock-fallback',
    }), { withQr: true });
  });

  it('renders duanzi style with mock payload when USE_DB=false', async () => {
    const { GET, render } = await loadRouteWithoutDb();
    const res = await GET(nextReq('/api/card/mock-fallback?style=duanzi&platform=xhs'), {
      params: Promise.resolve({ reportId: 'mock-fallback' }),
    });

    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith('duanzi', 'xhs', expect.objectContaining({
      title: expect.stringContaining('打不死的小强'),
      subtitle: '',
      bodyExcerpt: expect.stringContaining('老板让我加班'),
      shareQuote: '西班牙赢了控球率，输给了想象力。',
      brand: '超帧球后说 · AI 生成',
      shortUrl: 'qiuhoushuo.com/m/mock-fallback',
    }), { withQr: false });
  });

  it('renders emotion style with mock payload when USE_DB=false', async () => {
    const { GET, render } = await loadRouteWithoutDb();
    const res = await GET(nextReq('/api/card/mock-fallback?style=emotion&platform=x'), {
      params: Promise.resolve({ reportId: 'mock-fallback' }),
    });

    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith('emotion', 'x', expect.objectContaining({
      title: expect.stringContaining('19 岁'),
      subtitle: expect.stringContaining('0.3 秒'),
      bodyExcerpt: expect.stringContaining('4 年后'),
      shareQuote: '他没救得了比赛，救得了 19 岁的自己。',
      brand: '超帧球后说 · AI 生成',
      shortUrl: 'qiuhoushuo.com/m/mock-fallback',
    }), { withQr: false });
  });
});

async function loadRoute(
  row: CardReportRow | null,
  render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  storage: CardStorage = {
    exists: vi.fn(async () => null),
    put: vi.fn(async () => 'memory://cards/r1/duanzi-wechat.png'),
  },
  dbCalls: CardDbCall[] = [],
  track: ServerEvent[] = [],
  siblings?: BriefSiblingRow[],
) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service';
  process.env.SUPABASE_ANON_KEY = 'anon';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => createClient(row, dbCalls, siblings) }));
  // 路由的镜头图 prefetch 走全局 fetch:默认返回一张极小 PNG(失败场景由用例自行覆写)
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = new ArrayBuffer(TINY_PNG.byteLength);
    new Uint8Array(body).set(TINY_PNG);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }));
  vi.doMock('@/lib/share-cards', () => ({ renderShareCard: render, flagUrl: (n: string) => (n ? `https://qiuhoushuo.com/flags/${n}.png` : undefined) }));
  vi.doMock('@/lib/api/card-storage', () => ({
    CARD_RENDER_CACHE_VERSION: 'v8',
    buildCardKey: ({ reportId, style, platform }: CardKeyInput) => `cards/${reportId}/${style}-${platform}.png`,
    getCardStorage: () => storage,
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => track.push(event),
  }));
  return import('@/app/api/card/[reportId]/route');
}

async function loadRouteWithoutDb(
  render = vi.fn(async (_style: ReportStyle, _platform: Platform, _payload: CardPayload) => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
) {
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_KEY', '');
  vi.stubEnv('SUPABASE_ANON_KEY', '');
  vi.stubEnv('CARD_PRERENDER_DISABLE', '1');
  vi.resetModules();
  vi.doMock('@/lib/share-cards', () => ({ renderShareCard: render, flagUrl: (n: string) => (n ? `https://qiuhoushuo.com/flags/${n}.png` : undefined) }));
  vi.doMock('@/lib/api/card-storage', () => ({
    CARD_RENDER_CACHE_VERSION: 'v8',
    buildCardKey: ({ reportId, style, platform }: CardKeyInput) => `cards/${reportId}/${style}-${platform}.png`,
    getCardStorage: () => ({
      exists: vi.fn(async () => null),
      put: vi.fn(async () => 'memory://unused.png'),
    }),
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: vi.fn(),
  }));
  const route = await import('@/app/api/card/[reportId]/route');
  return { ...route, render };
}

function nextReq(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function createClient(row: CardReportRow | null, calls: CardDbCall[], siblings?: BriefSiblingRow[]) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const query: CardQuery = {
        select(columns: string) {
          query.columns = columns;
          return query;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        // brief 跨风格合成的 sibling 列表查直接 await builder(无 maybeSingle):reports + match_id 过滤返回全风格行。
        then(resolve: (v: { data: BriefSiblingRow[] | null }) => void) {
          calls.push({ table, columns: query.columns, filters: { ...filters } });
          resolve({ data: table === 'reports' && filters.match_id ? siblings ?? null : null });
        },
        maybeSingle: async () => {
          calls.push({ table, columns: query.columns, filters: { ...filters } });
          if (!row) return { data: null };
          if (table === 'matches') {
            const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
            return { data: filters.short_code === match?.short_code ? { id: 'match-1' } : null };
          }
          if (table === 'reports' && filters.match_id) {
            const matchOk = filters.match_id === 'match-1' || filters.match_id === (row as { matchId?: string }).matchId;
            return { data: matchOk && filters.style === row.style ? { id: row.id } : null };
          }
          if (table === 'reports') {
            return { data: filters.id === row.id ? row : null };
          }
          return { data: null };
        },
      };
      return {
        select: query.select,
      };
    },
  };
}

function reportRow(overrides: Partial<{ id: string; matchId: string }> = {}) {
  return {
    id: overrides.id ?? 'r1',
    match_id: overrides.matchId ?? 'match-1',
    matchId: overrides.matchId, // 仅 F53 用例：模拟 reports.match_id → reports.id 解析

    title: '段子标题',
    subtitle: '副标题',
    lead: '原导语',
    body: ['正文第一段'],
    share_quote: '金句',
    style: 'duanzi' as ReportStyle,
    matches: {
      short_code: 'mock001',
      competition: '国际大赛小组赛',
      home_team: '巴西',
      away_team: '西班牙',
      home_score: 2,
      away_score: 1,
      match_date: '2026-06-16T00:00:00Z',
      stats: {
        possession: { home: 42, away: 58 },
        shots: { home: 11, away: 14 },
        shots_on_target: { home: 5, away: 4 },
        xg: { home: 1.9, away: 1.4 },
        pass_accuracy: { home: 84, away: 89 },
      },
    },
  };
}

// 球员评分卡用例:matches.stats.players 带真变音符名字(验证 fontSafe 去豆腐块 + compactName 控长)。
function ratingsRow() {
  const base = reportRow();
  return {
    ...base,
    matches: {
      ...base.matches,
      home_team: 'Turkey',
      away_team: 'United States',
      home_score: 3,
      away_score: 2,
      stats: {
        ...base.matches.stats,
        players: {
          motm: { name: 'Hakan Çalhanoğlu', team: 'Turkey', rating: 8.1, position: '中场' },
          home: [
            { name: 'Arda Güler', rating: 8.7, position: '前锋', goals: 1, assists: 1 },
            { name: 'Kenan Yıldız', rating: 7.4, position: '中场', goals: 0, assists: 1 },
          ],
          away: [
            { name: 'Sebastian Berhalter', rating: 7.2, position: '中场', goals: 1, assists: 0 },
          ],
        },
      },
    },
  };
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=',
  'base64',
);
