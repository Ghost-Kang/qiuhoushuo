import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { ServerEvent } from '@/lib/api/tracker';
import type { LineupTeam } from '@/lib/api-football/lineups';

const MATCH_UUID = '44444444-4444-4444-8444-444444444444';

type Storage = { exists: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; getBytes?: ReturnType<typeof vi.fn> };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.CARD_PRERENDER_DISABLE;
  delete process.env.FEATURE_FLAG_TACTICS_CARD;
});

describe('tacticsMatchToPayload (F67h 赛事名合规清洗)', () => {
  it('境外赛事商标词→中性国际大赛', async () => {
    const { tacticsMatchToPayload } = await import('@/lib/api/tactics-card');
    const p = tacticsMatchToPayload({
      id: 'm1', competition: 'World Cup 2026 - Group Stage - 1', // trademark-allowed
      home_team: '韩国', away_team: '捷克', home_score: 2, away_score: 1, match_date: '2026-06-12',
    });
    expect(p.competition).toBe('国际大赛 2026 · 小组赛第1轮');
    expect(p.competition).not.toMatch(/world\s*cup/i);
  });
  it('短链用 short_code(非 match id,/m 只认 short_code);缺则兜底 id', async () => {
    const { tacticsMatchToPayload } = await import('@/lib/api/tactics-card');
    const withCode = tacticsMatchToPayload({ id: 'm-uuid', short_code: '8a3f', home_team: 'A', away_team: 'B' });
    expect(withCode.shortUrl).toBe('qiuhoushuo.com/m/8a3f');
    const noCode = tacticsMatchToPayload({ id: 'm-uuid', home_team: 'A', away_team: 'B' });
    expect(noCode.shortUrl).toBe('qiuhoushuo.com/m/m-uuid');
  });
});

describe('/api/card/tactics/[matchId]', () => {
  it('returns 403 FEATURE_DISABLED when feature.tactics_card flag is absent (default off)', async () => {
    const { GET } = await loadRoute({});
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'FEATURE_DISABLED' });
  });

  it('rejects matchId with invalid chars', async () => {
    const { GET } = await loadRoute({ flag: '100' });
    const res = await GET(req('abc.eq.true'), routeParams('abc.eq.true'));
    expect(res.status).toBe(400);
  });

  it('renders demo formations in mock mode (USE_DB=false)', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET } = await loadRoute({ flag: '100', useDb: false, render });
    const res = await GET(req('demo1'), routeParams('demo1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledWith('tactics', 'xhs', expect.objectContaining({
      homeTeam: '巴西',
      awayTeam: '西班牙',
      tactics: expect.objectContaining({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' }),
    }));
  });

  it('returns 404 NOT_FOUND when the match does not exist', async () => {
    const { GET } = await loadRoute({ flag: '100', match: null });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NOT_FOUND' });
  });

  it('redirects to CDN when the tactics card is already stored', async () => {
    const storage: Storage = {
      exists: vi.fn(async () => `https://cdn.example.com/cards/v6/${MATCH_UUID}/tactics-xhs.png`),
      put: vi.fn(),
    };
    const { GET, lineups } = await loadRoute({ flag: '100', storage });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(302);
    expect(storage.exists).toHaveBeenCalledWith(`cards/v6/${MATCH_UUID}/tactics-xhs.png`);
    expect(lineups).not.toHaveBeenCalled();
  });

  it('inline=1 命中缓存 → 走 COS getBytes 直返字节,不拉阵容不重渲染(真机 wx.downloadFile 不跟跨域 302)', async () => {
    const storage: Storage = {
      exists: vi.fn(async () => `https://cdn.example.com/cards/v6/${MATCH_UUID}/tactics-xhs.png`),
      put: vi.fn(async () => 'memory://stored.png'),
      getBytes: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])), // COS API 读字节(容器内可达)
    };
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { GET, lineups } = await loadRoute({ flag: '100', storage, render });
    const res = await GET(req(`${MATCH_UUID}?inline=1`), routeParams(MATCH_UUID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(storage.exists).toHaveBeenCalled(); // inline 也查缓存(此前 bug:inline 直接绕过缓存→每次冷渲染)
    expect(storage.getBytes).toHaveBeenCalled();
    expect(lineups).not.toHaveBeenCalled(); // 命中缓存 → 短路,不拉阵容
    expect(render).not.toHaveBeenCalled(); // 不重渲染
  });

  it('inline=1 渲染后也回填缓存(不再受 inline 门控,后续可命中→不必每次冷渲染)', async () => {
    const storage: Storage = {
      exists: vi.fn(async () => null), // cache miss → 渲染
      put: vi.fn(async () => 'memory://stored.png'),
    };
    const { GET } = await loadRoute({ flag: '100', storage });
    const res = await GET(req(`${MATCH_UUID}?inline=1`), routeParams(MATCH_UUID));
    expect(res.status).toBe(200);
    expect(storage.put).toHaveBeenCalled(); // inline 也回填,修"每次冷渲染"
  });

  it('resolves short_code matchIds against matches.short_code', async () => {
    const dbCalls: Array<Record<string, string>> = [];
    const { GET } = await loadRoute({ flag: '100', dbCalls });
    const res = await GET(req('mock001'), routeParams('mock001'));
    expect(res.status).toBe(200);
    expect(dbCalls[0]).toEqual({ short_code: 'mock001' });
  });

  it('returns 404 NO_LINEUPS (no-store) when match has no external_id', async () => {
    const { GET } = await loadRoute({ flag: '100', match: matchRow({ external_id: null }) });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ error: 'NO_LINEUPS' });
  });

  it('returns 404 NO_LINEUPS when lineups are not yet published (empty response)', async () => {
    const { GET } = await loadRoute({ flag: '100', lineupTeams: [] });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NO_LINEUPS' });
  });

  it('passes a bare integer fixture id upstream（apifoot: 前缀必须剥掉，6/11 生产 bug）', async () => {
    const { GET, lineups } = await loadRoute({ flag: '100' });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(200);
    expect(lineups).toHaveBeenCalledWith(215662);
  });

  it('returns 404 NO_LINEUPS without calling upstream when external_id is unparseable', async () => {
    const { GET, lineups } = await loadRoute({ flag: '100', match: matchRow({ external_id: 'openfootball:xyz' }) });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'NO_LINEUPS' });
    expect(lineups).not.toHaveBeenCalled();
  });

  it('renders, back-fills storage with the tactics key, and tracks E053', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const storage: Storage = {
      exists: vi.fn(async () => null),
      put: vi.fn(async () => 'memory://stored.png'),
    };
    const track: ServerEvent[] = [];
    const { GET } = await loadRoute({ flag: '100', render, storage, track });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledWith('tactics', 'xhs', expect.objectContaining({
      homeTeam: '巴西',
      awayTeam: '西班牙',
      homeScore: 2,
      awayScore: 1,
      brand: '超帧球后说 · 战术图解 · AI 生成',
      tactics: expect.objectContaining({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' }),
    }));
    expect(storage.put).toHaveBeenCalledWith(`cards/v6/${MATCH_UUID}/tactics-xhs.png`, expect.any(Buffer), 'image/png');
    expect(track).toContainEqual(expect.objectContaining({
      eventId: 'E053',
      properties: expect.objectContaining({ style: 'tactics', variant: 'tactics' }),
    }));
  });

  it('aligns formations by stats.apiFootball.homeTeamId when response order is reversed', async () => {
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const reversed: LineupTeam[] = [
      { teamId: 9, teamName: 'Spain', formation: '4-2-3-1' },
      { teamId: 6, teamName: 'Brazil', formation: '4-3-3' },
    ];
    const { GET } = await loadRoute({ flag: '100', render, lineupTeams: reversed });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(200);
    // matchRow 的 homeTeamId=6（巴西）：即使上游客队在前也要解析成主=4-3-3
    expect(render).toHaveBeenCalledWith('tactics', 'xhs', expect.objectContaining({
      tactics: expect.objectContaining({ homeFormation: '4-3-3', awayFormation: '4-2-3-1' }),
    }));
  });

  it('resolves report.id UUIDs via reports.match_id → matches（F53 id 语义对称）', async () => {
    const reportUuid = '55555555-5555-4555-8555-555555555555';
    const render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const dbCalls: Array<Record<string, string>> = [];
    const { GET } = await loadRoute({
      flag: '100',
      render,
      dbCalls,
      dbResolver: (table, filters) => {
        if (table === 'matches' && filters.id === MATCH_UUID) return matchRow();
        if (table === 'reports' && filters.id === reportUuid) return { match_id: MATCH_UUID };
        return null;
      },
    });
    const res = await GET(req(reportUuid), routeParams(reportUuid));
    expect(res.status).toBe(200);
    // 解析顺序：matches.id(reportUuid) 落空 → reports.id → matches.id(match_id)
    expect(dbCalls).toEqual([
      { id: reportUuid },
      { id: reportUuid },
      { id: MATCH_UUID },
    ]);
    expect(render).toHaveBeenCalledWith('tactics', 'xhs', expect.objectContaining({ homeTeam: '巴西' }));
  });

  it('returns 502 LINEUPS_UNAVAILABLE when API-Football fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { GET } = await loadRoute({ flag: '100', lineupsError: 'api-football' });
    const res = await GET(req(MATCH_UUID), routeParams(MATCH_UUID));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ error: 'LINEUPS_UNAVAILABLE' });
    expect(error).toHaveBeenCalled();
  });
});

function req(matchIdWithQuery: string) {
  return new NextRequest(`http://localhost/api/card/tactics/${matchIdWithQuery}`, {
    headers: { 'x-openid': 'openid-1' },
  });
}

function routeParams(matchId: string) {
  return { params: Promise.resolve({ matchId }) };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_UUID,
    external_id: 'apifoot:215662',
    competition: '国际大赛小组赛',
    home_team: '巴西',
    away_team: '西班牙',
    home_score: 2,
    away_score: 1,
    match_date: '2026-06-16T00:00:00Z',
    stats: { apiFootball: { homeTeamId: 6, awayTeamId: 9 } },
    ...overrides,
  };
}

async function loadRoute(opts: {
  flag?: string;
  useDb?: boolean;
  match?: Record<string, unknown> | null;
  render?: ReturnType<typeof vi.fn>;
  storage?: Storage;
  track?: ServerEvent[];
  lineupTeams?: LineupTeam[];
  lineupsError?: 'api-football';
  dbCalls?: Array<Record<string, string>>;
  dbResolver?: (table: string, filters: Record<string, string>) => unknown;
}) {
  const {
    flag,
    useDb = true,
    match = matchRow(),
    render = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    storage = { exists: vi.fn(async () => null), put: vi.fn(async () => 'memory://stored.png') },
    track = [],
    lineupTeams = [
      { teamId: 6, teamName: 'Brazil', formation: '4-3-3' },
      { teamId: 9, teamName: 'Spain', formation: '4-2-3-1' },
    ],
    lineupsError,
    dbCalls = [],
    dbResolver,
  } = opts;

  if (flag != null) vi.stubEnv('FEATURE_FLAG_TACTICS_CARD', flag);
  if (useDb) {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from(table: string) {
          const filters: Record<string, string> = {};
          const query = {
            select: () => query,
            eq(column: string, value: string) {
              filters[column] = value;
              return query;
            },
            maybeSingle: async () => {
              dbCalls.push({ ...filters });
              return { data: dbResolver ? dbResolver(table, filters) : match };
            },
          };
          return { select: query.select };
        },
      }),
    }));
  } else {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_KEY', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
  }

  vi.resetModules();
  vi.doMock('@/lib/share-cards', () => ({ renderShareCard: render, flagUrl: (n: string) => (n ? `https://qiuhoushuo.com/flags/${n}.png` : undefined) }));
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => storage }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => track.push(event),
  }));
  vi.doMock('@/lib/api-football/lineups', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api-football/lineups')>('@/lib/api-football/lineups');
    const fetchFixtureLineups = vi.fn(async () => {
      if (lineupsError === 'api-football') {
        const { ApiFootballError } = await import('@/lib/api-football/client');
        throw new ApiFootballError('[api-football] 限流 (429): /fixtures/lineups', 429);
      }
      return lineupTeams;
    });
    return { ...actual, fetchFixtureLineups };
  });

  const route = await import('@/app/api/card/tactics/[matchId]/route');
  const lineupsModule = await import('@/lib/api-football/lineups');
  return { ...route, render, lineups: lineupsModule.fetchFixtureLineups as ReturnType<typeof vi.fn> };
}
