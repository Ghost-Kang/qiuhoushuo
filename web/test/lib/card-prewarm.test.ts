import { afterEach, describe, expect, it, vi } from 'vitest';

// prewarmCardsForMatch:已完赛比赛「所有可下载卡」预热(9 风格×平台 + 一图看懂 + 战术图),
// 幂等(已预热则 exists 跳过),用户点存图即命中缓存秒出。仅生产自调用。

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function storageWith(existsResult: string | null) {
  return { exists: vi.fn(async () => existsResult), put: vi.fn(), getBytes: vi.fn() };
}
function dbWith(rows: Array<{ id: string; style: string }>) {
  return { from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) };
}

describe('prewarmCardsForMatch', () => {
  it('非生产环境 → 跳过(non-prod),不碰 DB/渲染', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { prewarmCardsForMatch } = await import('@/lib/api/card-prerender');
    const r = await prewarmCardsForMatch('m1', storageWith(null) as never);
    expect(r.skipped).toBe('non-prod');
  });

  it('已预热(duanzi-xhs 当前版本存在)→ 跳过,不自调用渲染', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('@/lib/api/mode', () => ({ getSupabaseService: () => dbWith([{ id: 'rd', style: 'duanzi' }]), USE_DB: true }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { prewarmCardsForMatch } = await import('@/lib/api/card-prerender');
    const r = await prewarmCardsForMatch('m1', storageWith('https://cdn/x.png') as never);
    expect(r.skipped).toBe('already-warm');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未预热 → 自调用 12 个下载卡路由(9 卡 + 一图看懂 + 球员评分 + 战术图)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('@/lib/api/mode', () => ({
      getSupabaseService: () => dbWith([{ id: 'rh', style: 'hardcore' }, { id: 'rd', style: 'duanzi' }, { id: 're', style: 'emotion' }]),
      USE_DB: true,
    }));
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { prewarmCardsForMatch } = await import('@/lib/api/card-prerender');
    const r = await prewarmCardsForMatch('m1', storageWith(null) as never);
    expect(r.warmed).toBe(12);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => /\/api\/card\/m1\?style=/.test(u) && !u.includes('variant=')).length).toBe(9); // 9 风格×平台卡(不含 brief/ratings)
    expect(urls.some((u) => u.includes('variant=brief'))).toBe(true); // 一图看懂
    expect(urls.some((u) => u.includes('variant=ratings'))).toBe(true); // 球员评分
    expect(urls.some((u) => u.includes('/tactics/m1'))).toBe(true); // 战术图
  });

  it('无战报 → 跳过(no-report)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('@/lib/api/mode', () => ({ getSupabaseService: () => dbWith([]), USE_DB: true }));
    const { prewarmCardsForMatch } = await import('@/lib/api/card-prerender');
    const r = await prewarmCardsForMatch('m1', storageWith(null) as never);
    expect(r.skipped).toBe('no-report');
  });
});
