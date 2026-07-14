import { describe, expect, it } from 'vitest';
import { buildRecentReportsGroups, computeTags, type RawRecentRow } from '@/lib/api/recent-reports';

// 固定 now = 2026-06-12 12:00 +08,使 今天/昨天/更早 分组确定。
const NOW = new Date('2026-06-12T04:00:00.000Z'); // = 2026-06-12 12:00 +08

function row(over: {
  id: string; style: string; quote?: string; code: string;
  home?: string; away?: string; hs?: number | null; as?: number | null; date: string; premium?: boolean;
}): RawRecentRow {
  return {
    id: over.id,
    style: over.style,
    share_quote: over.quote ?? `${over.id}-q`,
    created_at: `${over.date}T00:00:00+08:00`,
    is_premium: over.premium ?? false,
    matches: {
      short_code: over.code, competition: '国际大赛小组赛',
      home_team: over.home ?? 'A', away_team: over.away ?? 'B',
      home_score: over.hs === undefined ? 1 : over.hs,
      away_score: over.as === undefined ? 0 : over.as,
      match_date: `${over.date}T12:00:00+08:00`,
    },
  };
}

// 一场比赛 = 3 风格 3 行
function game(code: string, opts: { home?: string; away?: string; hs: number; as: number; date: string; premium?: boolean }) {
  return ['hardcore', 'duanzi', 'emotion'].map((style) =>
    row({ id: `${code}-${style}`, style, code, quote: `${code}-${style}-q`, ...opts }),
  );
}

describe('computeTags', () => {
  it('净胜≥3 → 大胜;进球≥4 → 进球大战;0:0 → 互交白卷;平淡 → 空', () => {
    expect(computeTags(3, 0)).toEqual(['🥅 大胜']);
    expect(computeTags(3, 1)).toEqual(['🔥 进球大战']); // net2 total4
    expect(computeTags(0, 0)).toEqual(['🤝 互交白卷']);
    expect(computeTags(1, 0)).toEqual([]);
  });
  it('maxTags 限制条数', () => {
    expect(computeTags(4, 1, 1)).toHaveLength(1); // net3+total5 命中两条,截 1
    expect(computeTags(4, 1, 2)).toEqual(['🥅 大胜', '🔥 进球大战']);
  });
});

describe('buildRecentReportsGroups', () => {
  it('同场 3 风格行去重为一卡,金句取 duanzi,队名翻译', () => {
    const { groups } = buildRecentReportsGroups(game('m1', { hs: 2, as: 1, date: '2026-06-12' }), NOW);
    const today = groups.find((g) => g.key === 'today')!;
    const all = [today.featured, ...today.items].filter(Boolean);
    expect(all).toHaveLength(1); // 3 行 → 1 卡
    expect(all[0]!.share_quote).toBe('m1-duanzi-q'); // duanzi 优先
    expect(all[0]!.default_style).toBe('duanzi');
  });

  it('分组:今天/昨天/更早(更早按日期二级分段),空组不返回', () => {
    const rows = [
      ...game('today1', { hs: 2, as: 1, date: '2026-06-12' }),
      ...game('yday1', { hs: 1, as: 0, date: '2026-06-11' }),
      ...game('old1', { hs: 1, as: 1, date: '2026-06-09' }),
      ...game('old2', { hs: 0, as: 1, date: '2026-06-08' }),
    ];
    const { groups } = buildRecentReportsGroups(rows, NOW);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'earlier']);
    const earlier = groups.find((g) => g.key === 'earlier')!;
    expect(earlier.subgroups.map((s) => s.date_label)).toEqual(['6月9日', '6月8日']);
  });

  it('今天大胜(3:0)抽为焦点战,带最多 2 标签;平淡场不抽焦点', () => {
    const big = buildRecentReportsGroups([
      ...game('big', { hs: 3, as: 0, date: '2026-06-12' }),
      ...game('norm', { hs: 1, as: 0, date: '2026-06-12' }),
    ], NOW);
    const t = big.groups.find((g) => g.key === 'today')!;
    expect(t.featured?.short_code).toBe('big');
    expect(t.featured?.tags).toContain('🥅 大胜');
    expect(t.items.map((i) => i.short_code)).toEqual(['norm']); // 焦点不重复进 items

    // 今天全是平淡 1:0/0:0 → 无焦点
    const flat = buildRecentReportsGroups(game('f', { hs: 1, as: 0, date: '2026-06-12' }), NOW);
    expect(flat.groups.find((g) => g.key === 'today')!.featured).toBeNull();
  });

  it('无比分行丢弃 / premium 行跳过', () => {
    const rows = [
      ...game('ok', { hs: 2, as: 0, date: '2026-06-12' }),
      row({ id: 'noscore-duanzi', style: 'duanzi', code: 'noscore', hs: null, as: null, date: '2026-06-12' }),
      row({ id: 'prem-duanzi', style: 'duanzi', code: 'prem', hs: 2, as: 2, date: '2026-06-12', premium: true }),
    ];
    const { groups } = buildRecentReportsGroups(rows, NOW);
    const codes = groups.flatMap((g) => [g.featured, ...('items' in g ? g.items : []), ...('subgroups' in g ? g.subgroups.flatMap((s) => s.items) : [])]).filter(Boolean).map((i) => i!.short_code);
    expect(codes).toEqual(['ok']); // noscore + prem 都不出现
  });

  it('limit 限制比赛场数(非行数)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => game(`g${i}`, { hs: 1, as: 0, date: '2026-06-08' })).flat();
    const { groups } = buildRecentReportsGroups(rows, NOW, 3);
    const total = groups.flatMap((g) => 'subgroups' in g ? g.subgroups.flatMap((s) => s.items) : [g.featured, ...g.items]).filter(Boolean).length;
    expect(total).toBe(3); // 5 场截到 3
  });
});
