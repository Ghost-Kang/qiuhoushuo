import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchRowToMatchData, findReportableMatches, findFinishedMatches, type MatchRow, type ReportableDb } from '@/lib/api/auto-report';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.MP_DRAFT_AUTO_PUSH;
});

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'm1',
    competition: '国际大赛',
    home_team: 'A',
    away_team: 'B',
    home_score: 2,
    away_score: 1,
    match_date: '2026-06-16T20:00:00Z',
    status: 'finished',
    stats: { possession: { home: 55, away: 45 } },
    events: [{ minute: 10, type: 'goal', team: 'A', player: 'X' }],
    ...over,
  };
}

describe('matchRowToMatchData', () => {
  it('maps columns to MatchData', () => {
    const md = matchRowToMatchData(row());
    expect(md.match).toBe('A 2:1 B');
    expect(md.final_score).toBe('2-1');
    expect(md.date).toBe('2026-06-16');
    expect(md.events).toHaveLength(1);
    expect(md.stats).toMatchObject({ possession: { home: 55, away: 45 } });
  });

  it('defends against null scores / bad events / null stats', () => {
    const md = matchRowToMatchData(row({ home_score: null, away_score: null, events: 'bad', stats: null }));
    expect(md.final_score).toBe('0-0');
    expect(md.events).toEqual([]);
    expect(md.stats).toEqual({});
  });

  // 反向验证：LLM prompt 源头清洗——英文队名→中文,赛事商标词→脱敏,避免生成正文带英文队名或境外赛事商标词
  it('translates team names and sanitizes trademark competition in the LLM prompt source', () => {
    const md = matchRowToMatchData(row({
      home_team: 'Mexico',
      away_team: 'South Africa',
      competition: 'FIFA World Cup 小组赛', // trademark-allowed —— 反向入参
    }));
    expect(md.match).toBe('墨西哥 2:1 南非');
    expect(md.competition).not.toMatch(/world\s*cup/i); // trademark-allowed
    expect(md.competition).not.toMatch(/\bfifa\b/i); // trademark-allowed
    expect(md.competition).toContain('国际大赛');
  });
});

function reportableDb(matches: MatchRow[], reportedIds: string[]): ReportableDb {
  return {
    from(table: string) {
      if (table === 'matches') {
        return { select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: matches }) }) }) }) };
      }
      return { select: () => ({ in: async () => ({ data: reportedIds.map((id) => ({ match_id: id })) }) }) };
    },
  } as unknown as ReportableDb;
}

describe('findReportableMatches', () => {
  it('excludes matches that already have a report', async () => {
    const out = await findReportableMatches(reportableDb([row({ id: 'm1' }), row({ id: 'm2' })], ['m1']), '2026-06-16', 20);
    expect(out.map((m) => m.id)).toEqual(['m2']);
  });

  it('returns empty when no finished matches', async () => {
    const out = await findReportableMatches(reportableDb([], []), '2026-06-16', 20);
    expect(out).toEqual([]);
  });
});

describe('findFinishedMatches', () => {
  it('returns ALL finished matches in window regardless of report status (对比 findReportableMatches 会过滤已报的)', async () => {
    // F67d:补图 pass 必须能看见"已有战报"的比赛,否则缺图永远补不上。
    const out = await findFinishedMatches(reportableDb([row({ id: 'm1' }), row({ id: 'm2' })], ['m1']), '2026-06-16', 20);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('GET /api/cron/auto-report', () => {
  function authedReq(query = '', secret = 'sec') {
    return new Request(`http://localhost/api/cron/auto-report${query}`, { headers: { authorization: `Bearer ${secret}` } });
  }

  it('503 without ADMIN_API_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/auto-report/route');
    expect((await GET(new Request('http://localhost/api/cron/auto-report'))).status).toBe(503);
  });

  it('401 with wrong auth', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    const { GET } = await import('@/app/api/cron/auto-report/route');
    expect((await GET(authedReq('', 'wrong'))).status).toBe(401);
  });

  it('503 when DB unavailable', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    const { GET } = await import('@/app/api/cron/auto-report/route');
    expect((await GET(authedReq())).status).toBe(503);
  });

  it('generates reports for finished unreported matches', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    process.env.SUPABASE_URL = 'https://e.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    const client = {
      from(table: string) {
        if (table === 'matches') return { select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [row({ id: 'm9' })] }) }) }) }) };
        if (table === 'reports') return { select: () => ({ in: async () => ({ data: [] }) }) };
        return { insert: () => Promise.resolve({}) };
      },
    };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    vi.doMock('@/lib/report', () => ({ generateAllStylesWithPersist: async () => ({ persisted: true, reports: {} }) }));
    vi.doMock('@/lib/api/card-prerender', () => ({ prerenderCardsForReport: async () => {}, warmBriefCard: async () => {} }));
    const { GET } = await import('@/app/api/cron/auto-report/route');
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scanned: number; triggered: number };
    expect(body.scanned).toBe(1);
    expect(body.triggered).toBe(1);
  });

  it('backfills highlight images for finished matches that ALREADY have reports (F67d:report 与 image 解耦)', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    process.env.SUPABASE_URL = 'https://e.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    // m1 已有战报(滑出 reportable 窗口) + m2 未报。韩国捷克即 m1 这类:13 事件 3 战报齐全独缺图。
    const matches = [row({ id: 'm1' }), row({ id: 'm2' })];
    const client = {
      from(table: string) {
        if (table === 'matches') return { select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: matches }) }) }) }) };
        if (table === 'reports') return { select: () => ({ in: async () => ({ data: [{ match_id: 'm1' }] }) }) };
        return { insert: () => Promise.resolve({}) };
      },
    };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    vi.doMock('@/lib/report', () => ({ generateAllStylesWithPersist: async () => ({ persisted: true, reports: {} }) }));
    vi.doMock('@/lib/api/card-prerender', () => ({ prerenderCardsForReport: async () => {}, warmBriefCard: async () => {} }));
    const { GET } = await import('@/app/api/cron/auto-report/route');
    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scanned: number;
      image_backfill: { scanned: number; generated: number; matches: { matchId: string }[] };
    };
    expect(body.scanned).toBe(1); // 只有 m2 reportable 走主链路
    expect(body.image_backfill.scanned).toBe(2); // 两场 finished 都被补图 pass 扫到
    const backfilledIds = body.image_backfill.matches.map((m) => m.matchId);
    expect(backfilledIds).toContain('m1'); // 已有战报的 m1 在此被补上图(主修复)
    expect(backfilledIds).not.toContain('m2'); // m2 已在主链路生成,补图 pass 跳过不重复
  });

  it('MP_DRAFT_AUTO_PUSH 开 → 战报落库后(prerender 完成)自动推三版并通知管理员', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    process.env.SUPABASE_URL = 'https://e.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    process.env.MP_DRAFT_AUTO_PUSH = '1';
    const client = {
      from(table: string) {
        if (table === 'matches') return { select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [row({ id: 'm9' })] }) }) }) }) };
        if (table === 'reports') return { select: () => ({ in: async () => ({ data: [] }) }) };
        return { insert: () => Promise.resolve({}) };
      },
    };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    vi.doMock('@/lib/report', () => ({ generateAllStylesWithPersist: async () => ({ persisted: true, reports: {} }) }));
    vi.doMock('@/lib/api/card-prerender', () => ({ prerenderCardsForReport: async () => {}, warmBriefCard: async () => {} }));
    const publishAllStyles = vi.fn(async () => ({ matchId: 'm9', matchLabel: 'A 2:1 B', results: [{ style: 'hardcore', ok: true }] }));
    const notify = vi.fn();
    vi.doMock('@/lib/api/mp-draft-publish', () => ({
      publishAllStyles,
      buildDraftPushedAlert: () => ({ severity: 'P2', title: 't', body: 'b', tags: ['mp-draft'] }),
    }));
    vi.doMock('@/lib/alerts', () => ({ notifyOpsFireAndForget: notify }));
    const { GET } = await import('@/app/api/cron/auto-report/route');
    expect((await GET(authedReq())).status).toBe(200);
    // 自动推是 prerender().then(...) 的游离 promise,等微任务 settle 再断言
    await new Promise((r) => setTimeout(r, 10));
    // 自动链路也带球迷形象门控(第 4 参 opts.fanPortrait),与手动 all 统一
    expect(publishAllStyles).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'm9',
      expect.objectContaining({ fanPortrait: expect.anything() }),
    );
    expect(notify).toHaveBeenCalled();
  });

  it('MP_DRAFT_AUTO_PUSH 关 → 不碰公众号草稿(默认不推)', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    process.env.SUPABASE_URL = 'https://e.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    const client = {
      from(table: string) {
        if (table === 'matches') return { select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [row({ id: 'm9' })] }) }) }) }) };
        if (table === 'reports') return { select: () => ({ in: async () => ({ data: [] }) }) };
        return { insert: () => Promise.resolve({}) };
      },
    };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    vi.doMock('@/lib/report', () => ({ generateAllStylesWithPersist: async () => ({ persisted: true, reports: {} }) }));
    vi.doMock('@/lib/api/card-prerender', () => ({ prerenderCardsForReport: async () => {}, warmBriefCard: async () => {} }));
    const publishAllStyles = vi.fn();
    vi.doMock('@/lib/api/mp-draft-publish', () => ({ publishAllStyles, buildDraftPushedAlert: () => ({}) }));
    const { GET } = await import('@/app/api/cron/auto-report/route');
    expect((await GET(authedReq())).status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(publishAllStyles).not.toHaveBeenCalled();
  });

  it('widens the scan window via ?sinceHours (运维回填口) and bounds it to 1-1000', async () => {
    process.env.ADMIN_API_SECRET = 'sec';
    process.env.SUPABASE_URL = 'https://e.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    const gteValues: string[] = [];
    const client = {
      from(table: string) {
        if (table === 'matches') {
          return { select: () => ({ eq: () => ({ gte: (_col: string, value: string) => { gteValues.push(value); return { limit: async () => ({ data: [] }) }; } }) }) };
        }
        if (table === 'reports') return { select: () => ({ in: async () => ({ data: [] }) }) };
        return { insert: () => Promise.resolve({}) };
      },
    };
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    const { GET } = await import('@/app/api/cron/auto-report/route');

    const before = Date.now();
    const res = await GET(authedReq('?sinceHours=24'));
    expect(res.status).toBe(200);
    const since = new Date(gteValues[0]!).getTime();
    const hoursAgo = (before - since) / 3_600_000;
    expect(hoursAgo).toBeGreaterThan(23.9);
    expect(hoursAgo).toBeLessThan(24.1);

    // 越界与非数字一律 400,不能静默回落默认值
    expect((await GET(authedReq('?sinceHours=0'))).status).toBe(400);
    expect((await GET(authedReq('?sinceHours=720'))).status).toBe(200); // 历史回填:42 天内合法
    expect((await GET(authedReq('?sinceHours=1001'))).status).toBe(400);
    expect((await GET(authedReq('?sinceHours=abc'))).status).toBe(400);
  });
});
