import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, json, req } from './_utils';

type MatchesQuery = {
  select(): MatchesQuery;
  gte(): MatchesQuery;
  lt(): MatchesQuery;
  eq(): MatchesQuery;
  order(): MatchesQuery;
  limit(): Promise<{ data: ReturnType<typeof matchRow>[] }>;
  then(resolve: (value: { data: ReturnType<typeof matchRow>[] }) => void): void;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
});

describe('/api/matches/today', () => {
  it('returns matches', async () => {
    const { GET } = await import('@/app/api/matches/today/route');
    const body = await json(await GET(authed('/api/matches/today')));
    expect(body.today.length).toBeGreaterThan(0);
    expect(body.upcoming.length).toBeGreaterThan(0);
  });

  it('returns a finished list with scores in mock mode', async () => {
    const { GET } = await import('@/app/api/matches/today/route');
    const body = await json(await GET(authed('/api/matches/today')));
    expect(body.finished.length).toBeGreaterThan(0);
    expect(body.finished[0]).toMatchObject({
      home_score: expect.any(Number),
      away_score: expect.any(Number),
      date_text: expect.any(String),
    });
  });

  it('rejects unknown query', async () => {
    const { GET } = await import('@/app/api/matches/today/route');
    expect((await GET(authed('/api/matches/today?bad=1'))).status).toBe(400);
  });

  it('allows anonymous access', async () => {
    const { GET } = await import('@/app/api/matches/today/route');
    const res = await GET(req('/api/matches/today'));
    expect(res.status).toBe(200);
    expect((await json(res)).today.length).toBeGreaterThan(0);
  });

  it('matches miniprogram key fields', async () => {
    const { GET } = await import('@/app/api/matches/today/route');
    const body = await json(await GET(authed('/api/matches/today')));
    expect(Object.keys(body.today[0])).toEqual(
      expect.arrayContaining(['id', 'home_team', 'away_team', 'competition', 'kickoff', 'status']),
    );
  });

  it('maps DB rows into today (含比分) and finished (倒序带 date_text), never exposing external_id', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => matchesClient() }));
    const { GET } = await import('@/app/api/matches/today/route');
    const body = await json(await GET(authed('/api/matches/today')));

    expect(body.today[0]).not.toHaveProperty('external_id');
    expect(body.today[0]).toMatchObject({ home_score: 2, away_score: 1 });

    expect(body.finished).toHaveLength(1);
    expect(body.finished[0]).not.toHaveProperty('external_id');
    expect(body.finished[0]).toMatchObject({
      id: 'm1',
      home_team: '巴西',
      away_team: '西班牙',
      home_score: 2,
      away_score: 1,
      competition: '国际大赛小组赛',
    });
    expect(body.finished[0].date_text).toMatch(/6\/16/);
  });

  // 时区红线：「今天」按北京时间日界圈定。北京次日凌晨的比赛(UTC 仍属今天)不得算今天,
  // 否则与已完赛混排出现"9点完赛排在3点/6点未开赛之后"的时序错乱(真机实证 6/16)。
  it('scopes 「today」to the Beijing(UTC+8) calendar day, not UTC', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T09:45:00Z')); // 北京 2026-06-16 17:45
    const captured: { gte: string[]; lt: string[] } = { gte: [], lt: [] };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => captureClient(captured) }));
    const { GET } = await import('@/app/api/matches/today/route');
    await json(await GET(authed('/api/matches/today')));
    // today 窗口 = 北京 6/16 00:00 ~ 6/17 00:00 = UTC 6/15T16:00 ~ 6/16T16:00
    expect(captured.gte).toContain('2026-06-15T16:00:00.000Z'); // 北京今日 00:00
    expect(captured.lt).toContain('2026-06-16T16:00:00.000Z'); // 北京明日 00:00(= upcoming 起点)
    // 往期战报排除今天及以后(lt 北京今日 00:00),避免与「今天的比赛」重复
    expect(captured.lt).toContain('2026-06-15T16:00:00.000Z');
    // 反例:绝不能用 UTC 日界(那会把北京次日凌晨场圈进今天)
    expect(captured.gte).not.toContain('2026-06-16T00:00:00.000Z');
  });

  // 反向验证：DB 存英文队名 + 含商标词赛事 → 出口必须是中文队名 + 已脱敏赛事（赛事页全链路清洗）
  it('translates English team names and sanitizes trademark competition across today/upcoming/finished', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => englishMatchesClient() }));
    const { GET } = await import('@/app/api/matches/today/route');
    const body = await json(await GET(authed('/api/matches/today')));

    // today（toMatch）：队名翻译 + 赛事脱敏
    expect(body.today[0]).toMatchObject({ home_team: '巴西', away_team: '西班牙' });
    // upcoming（inline map）：队名翻译（该结构无 competition 字段）
    expect(body.upcoming[0]).toMatchObject({ home_team: '美国', away_team: '巴拉圭' });
    // finished（toFinished）：队名翻译 + 赛事脱敏
    expect(body.finished[0]).toMatchObject({ home_team: '巴西', away_team: '西班牙' });

    // 商标红线：三处出口都不得残留任何境外赛事商标词
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/world\s*cup/i); // trademark-allowed
    expect(blob).not.toMatch(/\bfifa\b/i); // trademark-allowed
    expect(blob).not.toContain('世界杯'); // trademark-allowed
    // 翻译生效（无残留英文原名）
    expect(blob).not.toContain('Brazil');
    expect(blob).not.toContain('Paraguay');
  });
});

// 捕获 today 查询的 gte/lt 边界(校验北京日界)。无 eq → today/upcoming;有 eq → finished。
function captureClient(captured: { gte: string[]; lt: string[] }) {
  return {
    from() {
      const query = {
        select: () => query,
        gte: (_c: string, v: string) => { captured.gte.push(v); return query; },
        lt: (_c: string, v: string) => { captured.lt.push(v); return query; },
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [] }),
        then: (resolve: (value: { data: [] }) => void) => resolve({ data: [] }),
      };
      return query;
    },
  };
}

function matchesClient() {
  return {
    from() {
      let isFinishedQuery = false;
      const query: MatchesQuery = {
        select: () => query,
        gte: () => query,
        lt: () => query,
        eq: () => {
          // 只有已完赛列表用 eq(status)，借此区分三条查询
          isFinishedQuery = true;
          return query;
        },
        order: () => query,
        limit: async () => ({ data: isFinishedQuery ? [matchRow()] : [] }),
        then: (resolve: (value: { data: ReturnType<typeof matchRow>[] }) => void) => resolve({ data: [matchRow()] }),
      };
      return query;
    },
  };
}

function matchRow() {
  return {
    id: 'm1',
    external_id: 'secret-external',
    home_team: '巴西',
    away_team: '西班牙',
    home_score: 2,
    away_score: 1,
    competition: '国际大赛小组赛',
    match_date: '2026-06-16T12:00:00Z',
    status: 'finished',
  };
}

// 反向验证夹具：DB 里存的是英文队名 + 含境外赛事商标词的 competition
const TRADEMARK_COMP = 'FIFA World Cup 小组赛'; // trademark-allowed —— 反向验证入参,出口必须脱敏
function englishRow(homeTeam: string, awayTeam: string) {
  return {
    id: 'm1',
    external_id: 'secret-external',
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: 2,
    away_score: 1,
    competition: TRADEMARK_COMP,
    match_date: '2026-06-16T12:00:00Z',
    status: 'finished',
  };
}

function englishMatchesClient() {
  return {
    from() {
      let isFinishedQuery = false;
      const query: MatchesQuery = {
        select: () => query,
        gte: () => query,
        lt: () => query,
        eq: () => {
          isFinishedQuery = true; // 已完赛列表
          return query;
        },
        order: () => query,
        // limit 无 eq → upcoming(美国/巴拉圭);有 eq → finished(巴西/西班牙)
        limit: async () => ({ data: [isFinishedQuery ? englishRow('Brazil', 'Spain') : englishRow('USA', 'Paraguay')] }),
        // 无 limit 的 thenable → today(巴西/西班牙)
        then: (resolve: (value: { data: ReturnType<typeof matchRow>[] }) => void) => resolve({ data: [englishRow('Brazil', 'Spain')] }),
      };
      return query;
    },
  };
}
