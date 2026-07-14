import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { LeaderEntry } from '@/lib/api-football/leaderboard';

// /api/card/scoreboard:赛事级射手榜/助攻榜卡。live 拉 API + 日期戳日级缓存 + inline 直返。

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.CARD_PRERENDER_DISABLE;
});

const SCORERS: LeaderEntry[] = [{ name: 'L. Messi', team: 'Argentina', count: 5, apps: 2 }];
const ASSISTS: LeaderEntry[] = [{ name: 'A. Isak', team: 'Sweden', count: 3, apps: 3 }];

function nextReq(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

async function loadRoute(opts: {
  fetchLeaderboard?: ReturnType<typeof vi.fn>;
  render?: ReturnType<typeof vi.fn>;
  storage?: { exists: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; getBytes?: ReturnType<typeof vi.fn> };
} = {}) {
  const fetchLeaderboard = opts.fetchLeaderboard
    ?? vi.fn(async (kind: string) => (kind === 'topscorers' ? SCORERS : ASSISTS));
  const render = opts.render ?? vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const storage = opts.storage ?? { exists: vi.fn(async () => null), put: vi.fn(async () => 'memory://x') };
  vi.doMock('@/lib/api-football/leaderboard', () => ({ fetchLeaderboard }));
  vi.doMock('@/lib/api/scoreboard-card', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/scoreboard-card')>('@/lib/api/scoreboard-card');
    return { ...actual, renderScoreboardCard: render };
  });
  vi.doMock('@/lib/api/card-storage', () => ({ CARD_RENDER_CACHE_VERSION: 'v31', getCardStorage: () => storage }));
  vi.doMock('@/lib/api/mode', () => ({ getSupabaseService: () => null, USE_DB: false }));
  vi.doMock('@/lib/api/tracker', () => ({ trackServerEvent: vi.fn() }));
  const route = await import('@/app/api/card/scoreboard/route');
  return { ...route, fetchLeaderboard, render, storage };
}

describe('/api/card/scoreboard', () => {
  it('未命中缓存 → 拉双榜、渲染、回填缓存、返 PNG', async () => {
    const { GET, render, storage, fetchLeaderboard } = await loadRoute();
    const res = await GET(nextReq('/api/card/scoreboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(fetchLeaderboard).toHaveBeenCalledWith('topscorers', {}, {}, 8);
    expect(fetchLeaderboard).toHaveBeenCalledWith('topassists', {}, {}, 8);
    // 渲染入参带脱敏赛事名 + 双榜
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      scoreboardCard: expect.objectContaining({
        scorers: [expect.objectContaining({ name: '梅西', team: '阿根廷', count: 5 })],
        assists: [expect.objectContaining({ name: '伊萨克', team: '瑞典', count: 3 })],
      }),
    }));
    // 回填到带日期戳的榜单 key
    expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^cards\/v31\/leaderboard\/scoreboard-\d{10}-xhs\.png$/), expect.any(Buffer), 'image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=1800, must-revalidate'); // 非 immutable(内容每小时变)
  });

  it('命中缓存 + inline=1 → 走 COS getBytes 直返字节,不重渲染', async () => {
    const storage = {
      exists: vi.fn(async () => 'https://cdn/scoreboard.png'),
      put: vi.fn(),
      getBytes: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    };
    const { GET, render } = await loadRoute({ storage });
    const res = await GET(nextReq('/api/card/scoreboard?inline=1'));
    expect(res.status).toBe(200);
    expect(storage.getBytes).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('命中缓存 + 非 inline → 302 跳 CDN', async () => {
    const storage = { exists: vi.fn(async () => 'https://cdn/scoreboard.png'), put: vi.fn() };
    const { GET } = await loadRoute({ storage });
    const res = await GET(nextReq('/api/card/scoreboard'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn/scoreboard.png');
  });

  it('双榜皆空(赛事初期)→ 404 NO_DATA + no-store,不缓存', async () => {
    const fetchLeaderboard = vi.fn(async () => [] as LeaderEntry[]);
    const { GET, render, storage } = await loadRoute({ fetchLeaderboard });
    const res = await GET(nextReq('/api/card/scoreboard'));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NO_DATA' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('API 异常 → 502 + no-store(不缓存坏数据)', async () => {
    const { ApiFootballError } = await import('@/lib/api-football/client');
    const fetchLeaderboard = vi.fn(async () => { throw new ApiFootballError('boom', 502); });
    const { GET, storage } = await loadRoute({ fetchLeaderboard });
    const res = await GET(nextReq('/api/card/scoreboard'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(storage.put).not.toHaveBeenCalled();
  });
});
