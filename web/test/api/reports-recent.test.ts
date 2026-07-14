import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, json, req } from './_utils';

type ReportsQuery = {
  select(): ReportsQuery;
  eq(): ReportsQuery;
  order(): ReportsQuery;
  limit(): Promise<{ data: ReturnType<typeof row>[] }>;
};
type Item = { short_code: string; home_team: string; home_score: number; default_style: string };
type Group = { key: string; featured: Item | null; items?: Item[]; subgroups?: { items: Item[] }[] };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
});

/** 摊平所有分组里的 item(含 featured / items / 更早组 subgroups)。 */
function allItems(body: { groups: Group[] }): Item[] {
  return body.groups.flatMap((g) => [
    ...(g.featured ? [g.featured] : []),
    ...(g.items ?? []),
    ...(g.subgroups?.flatMap((s) => s.items) ?? []),
  ]);
}

describe('/api/reports/recent', () => {
  it('mock 模式返回分组结构,同场去重为一卡,焦点战为今天大胜', async () => {
    const { GET } = await import('@/app/api/reports/recent/route');
    const body = await json(await GET(authed('/api/reports/recent')));
    expect(Array.isArray(body.groups)).toBe(true);
    const today = body.groups.find((g: Group) => g.key === 'today');
    expect(today.featured.short_code).toBe('mockA'); // 3:0 大胜 → 焦点
    // mockA 三风格行去重为一卡(只出现一次)
    expect(allItems(body).filter((i) => i.short_code === 'mockA')).toHaveLength(1);
    expect(allItems(body).every((i) => i.default_style === 'duanzi')).toBe(true);
  });

  it('rejects invalid limit', async () => {
    const { GET } = await import('@/app/api/reports/recent/route');
    expect((await GET(authed('/api/reports/recent?limit=bad'))).status).toBe(400);
  });

  it('allows anonymous access', async () => {
    const { GET } = await import('@/app/api/reports/recent/route');
    const res = await GET(req('/api/reports/recent'));
    expect(res.status).toBe(200);
    expect((await json(res)).groups.length).toBeGreaterThan(0);
  });

  it('DB 模式:premium 行排除 + 同 short_code 去重 + 数组 join 归一', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => reportsClient() }));
    const { GET } = await import('@/app/api/reports/recent/route');
    const body = await json(await GET(authed('/api/reports/recent?limit=6')));
    const items = allItems(body);
    const codes = items.map((i) => i.short_code).sort();
    expect(codes).toEqual(['free-1', 'free-2']); // prem-1 排除;free-1 三风格去重为一
    expect(items.find((i) => i.short_code === 'free-1')!.home_team).toBe('巴西');
  });
});

// free-1 三风格(测去重)+ free-2 单条 + premium 一条(测排除)
function reportsClient() {
  return {
    from() {
      const query: ReportsQuery = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [
          row('free-1', 'hardcore', false),
          row('free-1', 'duanzi', false),
          row('free-1', 'emotion', false),
          row('free-2', 'duanzi', false),
          row('prem-1', 'duanzi', true),
        ] }),
      };
      return query;
    },
  };
}

function row(code: string, style: string, premium: boolean) {
  return {
    id: `${code}-${style}`,
    style,
    is_premium: premium,
    share_quote: `${code}-${style} quote`,
    created_at: '2026-06-16T00:00:00Z',
    matches: { short_code: code, competition: '国际大赛小组赛', home_team: '巴西', away_team: '西班牙', home_score: 2, away_score: 1, match_date: '2026-06-16T00:00:00Z' },
  };
}
