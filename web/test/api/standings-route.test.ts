import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { GroupStanding } from '@/lib/api-football/standings';

// /api/card/standings?group=A:赛事级小组积分榜卡。live 拉 API + 组/日期戳缓存 + inline 直返。

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.CARD_PRERENDER_DISABLE;
});

const GROUP_A: GroupStanding = {
  group: 'Group A',
  rows: [
    { rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, description: 'Round of 32' },
    { rank: 4, team: 'Saudi Arabia', played: 3, win: 0, draw: 0, lose: 3, goalsDiff: -7, points: 0, description: null },
  ],
};

function nextReq(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

async function loadRoute(opts: {
  fetchStandings?: ReturnType<typeof vi.fn>;
  render?: ReturnType<typeof vi.fn>;
  storage?: { exists: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; getBytes?: ReturnType<typeof vi.fn> };
} = {}) {
  const fetchStandings = opts.fetchStandings ?? vi.fn(async () => [GROUP_A]);
  const render = opts.render ?? vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const storage = opts.storage ?? { exists: vi.fn(async () => null), put: vi.fn(async () => 'memory://x') };
  vi.doMock('@/lib/api-football/standings', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api-football/standings')>('@/lib/api-football/standings');
    return { ...actual, fetchStandings };
  });
  vi.doMock('@/lib/api/standings-card', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/standings-card')>('@/lib/api/standings-card');
    return { ...actual, renderStandingsCard: render };
  });
  vi.doMock('@/lib/api/card-storage', () => ({ CARD_RENDER_CACHE_VERSION: 'v31', getCardStorage: () => storage }));
  vi.doMock('@/lib/api/mode', () => ({ getSupabaseService: () => null, USE_DB: false }));
  vi.doMock('@/lib/api/tracker', () => ({ trackServerEvent: vi.fn() }));
  const route = await import('@/app/api/card/standings/route');
  return { ...route, fetchStandings, render, storage };
}

describe('/api/card/standings', () => {
  it('未命中缓存 → 拉积分榜、取组、渲染、回填带 组+日期戳 key、返 PNG', async () => {
    const { GET, render, storage } = await loadRoute();
    const res = await GET(nextReq('/api/card/standings?group=A'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      standingsCard: expect.objectContaining({
        title_line: '国际大赛 · A组 积分榜',
        rows: expect.arrayContaining([expect.objectContaining({ team: '墨西哥', points: 9, qualified: true })]),
      }),
    }));
    expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^cards\/v31\/leaderboard\/standings-A-\d{10}-xhs\.png$/), expect.any(Buffer), 'image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=1800, must-revalidate');
  });

  it('group 缺失/非法 → 400', async () => {
    const { GET } = await loadRoute();
    expect((await GET(nextReq('/api/card/standings'))).status).toBe(400);
    expect((await GET(nextReq('/api/card/standings?group=Z'))).status).toBe(400);
    expect((await GET(nextReq('/api/card/standings?group=AA'))).status).toBe(400);
  });

  it('小写 group 归一;命中缓存 + inline → COS getBytes 直返', async () => {
    const storage = {
      exists: vi.fn(async () => 'https://cdn/s.png'),
      put: vi.fn(),
      getBytes: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    };
    const { GET, render } = await loadRoute({ storage });
    const res = await GET(nextReq('/api/card/standings?group=a&inline=1'));
    expect(res.status).toBe(200);
    expect(storage.getBytes).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('该组无数据 → 404 NO_DATA + no-store,不缓存', async () => {
    const fetchStandings = vi.fn(async () => [] as GroupStanding[]); // pickGroup 返 undefined
    const { GET, render, storage } = await loadRoute({ fetchStandings });
    const res = await GET(nextReq('/api/card/standings?group=A'));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NO_DATA' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('API 异常 → 502 + no-store(不缓存坏数据)', async () => {
    const { ApiFootballError } = await import('@/lib/api-football/client');
    const fetchStandings = vi.fn(async () => { throw new ApiFootballError('boom', 502); });
    const { GET, storage } = await loadRoute({ fetchStandings });
    const res = await GET(nextReq('/api/card/standings?group=A'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(storage.put).not.toHaveBeenCalled();
  });
});
