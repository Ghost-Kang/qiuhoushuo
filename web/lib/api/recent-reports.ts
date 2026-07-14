/**
 * 「最近战报」列表的去重 / 分组 / 标签 / 焦点战 纯逻辑(产品规格 v1,PM 设计)。
 *
 * 解决:reports 表一场比赛 3 行(hardcore/duanzi/emotion)→ 列表同场重复。
 * 这里按 short_code(= 一场比赛)聚合去重,选 duanzi 金句,算看点标签 + 焦点战,
 * 按 今天/昨天/更早(Asia/Shanghai)分组,返回前端零计算的结构。
 *
 * 纯函数:输入原始行 + now,输出分组结构。时区/日期都在此算(端上算易错)。
 */
import { translateTeam } from '@qhs/share-cards';

const TZ_OFFSET_MIN = 480; // Asia/Shanghai = UTC+8

export type RawRecentRow = {
  id: string;
  style?: string | null;
  share_quote?: string | null;
  created_at?: string | null;
  is_premium?: boolean | null;
  matches?: RawRecentMatch | RawRecentMatch[] | null;
};
type RawRecentMatch = {
  short_code?: string | null;
  competition?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  match_date?: string | null;
};

export type RecentItem = {
  short_code: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  share_quote: string;
  tags: string[];
  default_style: 'duanzi';
};
export type RecentGroup =
  | { key: 'today'; label: string; featured: RecentItem | null; items: RecentItem[] }
  | { key: 'yesterday'; label: string; featured: null; items: RecentItem[] }
  | { key: 'earlier'; label: string; featured: null; subgroups: { date_label: string; items: RecentItem[] }[] };

const STYLE_PREF = ['duanzi', 'emotion', 'hardcore'];

function matchOf(row: RawRecentRow): RawRecentMatch | null {
  if (Array.isArray(row.matches)) return row.matches[0] ?? null;
  return row.matches ?? null;
}

/** 移到 UTC+8 再取 YYYY-MM-DD,用于日期比较。 */
function dayKey(dateStr: string): string {
  return new Date(new Date(dateStr).getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}
function dateLabel(dateStr: string): string {
  const d = new Date(new Date(dateStr).getTime() + TZ_OFFSET_MIN * 60000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** 看点标签(后端算,前端纯渲染)。最多 maxTags 个,按优先级取。无可用数据 / 平淡 → 空数组。 */
export function computeTags(home: number, away: number, maxTags = 1): string[] {
  const net = Math.abs(home - away);
  const total = home + away;
  const all: string[] = [];
  if (net >= 3) all.push('🥅 大胜');
  if (total >= 4) all.push('🔥 进球大战');
  if (home === away && total === 0) all.push('🤝 互交白卷');
  return all.slice(0, maxTags);
}

/** 焦点战吸引力评分:净胜球权重高 + 进球数;平局/闷平不够"勾",分低。 */
function interest(home: number, away: number): number {
  const net = Math.abs(home - away);
  const total = home + away;
  return net * 10 + total;
}

type Match = RecentItem & { created_at: number; match_date: string; _interest: number };

/** reports 多风格行 → 按 short_code 聚合成"一场一条"。无比分的场丢弃(赛后速览不该出无分战报)。 */
function dedupeByMatch(rows: RawRecentRow[]): Match[] {
  const byCode = new Map<string, RawRecentRow[]>();
  for (const r of rows) {
    if (r.is_premium) continue;
    const m = matchOf(r);
    const code = m?.short_code || r.id;
    if (m?.home_score == null || m?.away_score == null) continue; // 无比分丢弃
    (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(r);
  }
  const out: Match[] = [];
  for (const [code, group] of byCode) {
    const m = matchOf(group[0]!)!;
    // 选金句:duanzi > emotion > hardcore > 任意非空
    const pick = STYLE_PREF.map((s) => group.find((g) => g.style === s && g.share_quote)).find(Boolean)
      || group.find((g) => g.share_quote);
    const created = Math.max(...group.map((g) => new Date(g.created_at || 0).getTime()));
    const home = Number(m.home_score);
    const away = Number(m.away_score);
    out.push({
      short_code: code,
      home_team: m.home_team ? translateTeam(m.home_team) : '主队',
      away_team: m.away_team ? translateTeam(m.away_team) : '客队',
      home_score: home,
      away_score: away,
      share_quote: pick?.share_quote || '',
      tags: computeTags(home, away, 1),
      default_style: 'duanzi',
      created_at: created,
      match_date: m.match_date || group[0]!.created_at || '',
      _interest: interest(home, away),
    });
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

function toItem(m: Match): RecentItem {
  return {
    short_code: m.short_code,
    home_team: m.home_team,
    away_team: m.away_team,
    home_score: m.home_score,
    away_score: m.away_score,
    share_quote: m.share_quote,
    tags: m.tags,
    default_style: 'duanzi',
  };
}

/**
 * 原始行 → 分组结构。`limit` 指去重后的"比赛场数"。
 * - 今天组:抽 1 场焦点战(净胜≥2 或 进球≥3 才配,否则不抽——不硬捧平淡场),其余为标准卡。
 * - 昨天组:标准卡。
 * - 更早组:按日期二级分段。
 * - 空组不返回。
 */
export function buildRecentReportsGroups(rows: RawRecentRow[], now: Date, limit = 12): { groups: RecentGroup[] } {
  const matches = dedupeByMatch(rows).slice(0, limit);
  const todayKey = dayKey(now.toISOString());
  const yKey = dayKey(new Date(now.getTime() - 86400000).toISOString());

  const today: Match[] = [];
  const yesterday: Match[] = [];
  const earlier: Match[] = [];
  for (const m of matches) {
    const k = dayKey(m.match_date);
    if (k === todayKey) today.push(m);
    else if (k === yKey) yesterday.push(m);
    else earlier.push(m);
  }

  const groups: RecentGroup[] = [];

  if (today.length) {
    // 焦点战:今天最具吸引力且够"勾"(净胜≥2 或 进球≥3)的一场
    const cand = today.slice().sort((a, b) => b._interest - a._interest)[0]!;
    const worthy = Math.abs(cand.home_score - cand.away_score) >= 2 || cand.home_score + cand.away_score >= 3;
    const featuredMatch = worthy ? cand : null;
    const featured = featuredMatch
      ? { ...toItem(featuredMatch), tags: computeTags(featuredMatch.home_score, featuredMatch.away_score, 2) }
      : null;
    const items = today.filter((m) => m !== featuredMatch).map(toItem);
    groups.push({ key: 'today', label: '今天', featured, items });
  }

  if (yesterday.length) {
    groups.push({ key: 'yesterday', label: '昨天', featured: null, items: yesterday.map(toItem) });
  }

  if (earlier.length) {
    const byDate = new Map<string, Match[]>();
    for (const m of earlier) {
      const lbl = dateLabel(m.match_date);
      (byDate.get(lbl) ?? byDate.set(lbl, []).get(lbl)!).push(m);
    }
    const subgroups = [...byDate.entries()].map(([date_label, ms]) => ({ date_label, items: ms.map(toItem) }));
    groups.push({ key: 'earlier', label: '更早', featured: null, subgroups });
  }

  return { groups };
}
