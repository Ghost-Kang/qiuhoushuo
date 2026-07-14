import { afterEach, describe, expect, it, vi } from 'vitest';

const MATCH = '22222222-2222-4222-8222-222222222222';

function reportRow(style: string, over: Record<string, unknown> = {}) {
  return {
    id: `rid-${style}`,
    style,
    title: `${style}标题`,
    lead: `${style}导语`,
    body: [`${style}段一`],
    share_quote: `${style}金句`,
    matches: { short_code: 'sc', home_team: 'Brazil', away_team: 'Spain', home_score: 2, away_score: 1, competition: 'C' },
    ...over,
  };
}
const ALL_ROWS = [reportRow('hardcore'), reportRow('duanzi'), reportRow('emotion')];

function makeDb(rows: unknown[]) {
  return { from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) };
}
function makeStorage(bytes: Buffer | null = Buffer.from('img')) {
  return { getBytes: vi.fn(async () => bytes) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mp-draft-publish', () => {
  it('无战报 → publishStyle REPORT_NOT_FOUND / publishAllStyles null', async () => {
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: vi.fn() }));
    const { publishStyle, publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    const one = await publishStyle(makeDb([]) as never, makeStorage() as never, MATCH, 'duanzi');
    expect(one).toEqual({ style: 'duanzi', ok: false, error: 'REPORT_NOT_FOUND' });
    expect(await publishAllStyles(makeDb([]) as never, makeStorage() as never, MATCH)).toBeNull();
  });

  it('publishStyle:取对应风格行、传中文队名 + 共用封面字节', async () => {
    const push = vi.fn(async (_deps: { input: { title: string; homeTeam: string; awayTeam: string }; briefBytes: Buffer | null }) => ({ ok: true, draftId: 'DH' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishStyle } = await import('@/lib/api/mp-draft-publish');
    const out = await publishStyle(makeDb(ALL_ROWS) as never, makeStorage() as never, MATCH, 'hardcore');
    expect(out).toEqual({ style: 'hardcore', ok: true, draftId: 'DH' });
    const arg = push.mock.calls[0]![0];
    expect(arg.input.title).toBe('hardcore标题'); // 选中了 hardcore 行,而非首行
    expect(arg.input.homeTeam).toBe('巴西'); // 反向验证:英文队名已转中文
    expect(arg.input.awayTeam).toBe('西班牙');
    expect(arg.briefBytes).not.toBeNull();
  });

  it('publishAllStyles:按 战术→好笑→追剧 顺序推三版,且封面/战术图只取一次(三版复用)', async () => {
    const push = vi.fn(async () => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    const storage = makeStorage();
    const summary = await publishAllStyles(makeDb(ALL_ROWS) as never, storage as never, MATCH);
    expect(summary!.matchLabel).toBe('巴西 2:1 西班牙');
    expect(summary!.results.map((r) => r.style)).toEqual(['hardcore', 'duanzi', 'emotion']);
    expect(summary!.results.every((r) => r.ok)).toBe(true);
    expect(push).toHaveBeenCalledTimes(3);
    expect(storage.getBytes).toHaveBeenCalledTimes(3); // 一次 loadContext:封面 + 战术 + 球员评分,各取一次(非 9 次)
  });

  it('封面/战术/球员评分未预热(getBytes 拿不到)→ 自调用卡路由按需渲染兜底,草稿不缺图', async () => {
    const push = vi.fn(async (_deps: { briefBytes: Buffer | null; tacticsBytes: Buffer | null; ratingsBytes: Buffer | null }) => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const storage = { getBytes: vi.fn(async () => null) }; // 全未预热 → 触发兜底
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(String(url));
      return { ok: true, arrayBuffer: async () => Buffer.from('RENDERED') };
    }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    const summary = await publishAllStyles(makeDb(ALL_ROWS) as never, storage as never, MATCH);
    expect(summary).not.toBeNull();
    // 兜底自调用了 brief + tactics + ratings 卡路由(渲染 + 回填)
    expect(fetched.some((u) => u.includes('variant=brief'))).toBe(true);
    expect(fetched.some((u) => u.includes('/card/tactics/'))).toBe(true);
    expect(fetched.some((u) => u.includes('variant=ratings'))).toBe(true);
    // 兜底渲染的字节进了草稿(战术图/球员评分不再静默缺失)
    expect(push.mock.calls[0]![0].tacticsBytes).not.toBeNull();
    expect(push.mock.calls[0]![0].ratingsBytes).not.toBeNull();
    expect(push.mock.calls[0]![0].briefBytes).not.toBeNull();
  });

  it('publishAllStyles:某版失败也照样汇总(逐版独立成败)', async () => {
    const push = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, draftId: 'D1' })
      .mockResolvedValueOnce({ ok: false, error: 'DRAFT_ADD_FAIL: 草稿创建失败' })
      .mockResolvedValueOnce({ ok: true, draftId: 'D3' });
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    const summary = await publishAllStyles(makeDb(ALL_ROWS) as never, makeStorage() as never, MATCH);
    expect(summary!.results.filter((r) => r.ok)).toHaveLength(2);
    expect(summary!.results.find((r) => r.style === 'duanzi')).toMatchObject({ ok: false, error: expect.stringContaining('DRAFT_ADD_FAIL') });
  });

  it('publishAllStyles + 球迷形象开:生成主/客两张(仅一次),拼进每版 push', async () => {
    const push = vi.fn(async (_deps: { fanPortraitBytes?: Array<Buffer | null> }) => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    // 球迷 key 未命中(返回 null)走生成;其余 key(封面/战术)给字节
    const storage = { getBytes: vi.fn(async (k: string) => (k.startsWith('fan-portraits/') ? null : Buffer.from('img'))), put: vi.fn(async () => 'u') };
    const provider = { name: 'mock' as const, generate: vi.fn(async () => ({ image: Buffer.from('FAN'), contentType: 'image/jpeg' as const, prompt: 'p' })) };
    await publishAllStyles(makeDb(ALL_ROWS) as never, storage as never, MATCH, { fanPortrait: { enabled: true, provider } });
    expect(provider.generate).toHaveBeenCalledTimes(2); // 主+客各一次,三版复用(非 6 次)
    expect(push).toHaveBeenCalledTimes(3);
    for (const call of push.mock.calls) {
      expect(call[0]!.fanPortraitBytes).toHaveLength(2);
    }
  });

  it('publishAllStyles + 球迷形象关:push 不带球迷字节', async () => {
    const push = vi.fn(async (_deps: { fanPortraitBytes?: Array<Buffer | null> }) => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    const provider = { name: 'mock' as const, generate: vi.fn() };
    await publishAllStyles(makeDb(ALL_ROWS) as never, makeStorage() as never, MATCH, { fanPortrait: { enabled: false, provider } });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(push.mock.calls[0]![0].fanPortraitBytes).toBeUndefined();
  });

  it('publishAllStyles 不传 opts(自动链路)→ 永不附球迷形象(即便 env 开)', async () => {
    vi.stubEnv('MP_DRAFT_FAN_PORTRAIT', '1'); // env 开也不影响:门控只认显式 opts
    const push = vi.fn(async (_deps: { fanPortraitBytes?: Array<Buffer | null> }) => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishAllStyles } = await import('@/lib/api/mp-draft-publish');
    await publishAllStyles(makeDb(ALL_ROWS) as never, makeStorage() as never, MATCH);
    expect(push.mock.calls[0]![0].fanPortraitBytes).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('publishStyle(单风格)从不附球迷形象', async () => {
    const push = vi.fn(async (_deps: { fanPortraitBytes?: Array<Buffer | null> }) => ({ ok: true, draftId: 'D' }));
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: push }));
    const { publishStyle } = await import('@/lib/api/mp-draft-publish');
    await publishStyle(makeDb(ALL_ROWS) as never, makeStorage() as never, MATCH, 'duanzi');
    expect(push.mock.calls[0]![0].fanPortraitBytes).toBeUndefined();
  });

  it('buildDraftPushedAlert:全成 P2 + 三版中文标签;有失败 P1 + ❌带因', async () => {
    vi.doMock('@/lib/api/mp-draft', () => ({ pushReportToMpDraft: vi.fn() }));
    const { buildDraftPushedAlert } = await import('@/lib/api/mp-draft-publish');
    const ok = buildDraftPushedAlert({
      matchId: MATCH,
      matchLabel: '巴西 2:1 西班牙',
      results: [
        { style: 'hardcore', ok: true, draftId: 'a' },
        { style: 'duanzi', ok: true, draftId: 'b' },
        { style: 'emotion', ok: true, draftId: 'c' },
      ],
    });
    expect(ok.severity).toBe('P2');
    expect(ok.title).toContain('已推送');
    expect(ok.body).toContain('战术版');
    expect(ok.body).toContain('好笑版');
    expect(ok.body).toContain('追剧版');
    expect(ok.body).toContain('成功 3/3');
    expect(ok.tags).toContain('mp-draft');

    const partial = buildDraftPushedAlert({
      matchId: MATCH,
      matchLabel: '巴西 2:1 西班牙',
      results: [
        { style: 'hardcore', ok: true, draftId: 'a' },
        { style: 'duanzi', ok: false, error: 'NO_TOKEN' },
        { style: 'emotion', ok: true, draftId: 'c' },
      ],
    });
    expect(partial.severity).toBe('P1');
    expect(partial.title).toContain('部分失败');
    expect(partial.body).toContain('❌ 好笑版（NO_TOKEN）');
    expect(partial.body).toContain('成功 2/3');
  });
});
