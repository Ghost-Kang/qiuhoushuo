/**
 * API-Football /standings 接入(赛事小组积分榜)。
 *
 * 真实响应:response[0].league.standings = 各小组数组(2026 制 12 组×4 + 1 个 "Group Stage" 汇总组)。
 * 行:{ rank, team:{name}, points, goalsDiff, group:"Group A", form, description:"Round of 32"|null,
 *   all:{played,win,draw,lose,goals:{for,against}} }。
 * ⚠️ group 名 "Group A" / league.name 为该赛事英文名 → 卡片层须脱敏;description 为数据源官方出线分类(可空)。
 * 仅取字母组(Group A..L),剔除 "Group Stage" 汇总。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';

export interface StandingRow {
  rank: number;
  team: string; // 原始英文队名(card 层 translateTeam)
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsDiff: number;
  points: number;
  description: string | null; // 数据源官方出线分类(如 "Round of 32"),可空
}

export interface GroupStanding {
  group: string; // 原始 "Group A"(card 层脱敏成 "A组")
  rows: StandingRow[];
}

interface RawStandingRow {
  rank?: number | null;
  team?: { name?: string | null };
  points?: number | null;
  goalsDiff?: number | null;
  group?: string | null;
  description?: string | null;
  all?: { played?: number | null; win?: number | null; draw?: number | null; lose?: number | null };
}
interface RawStandingsResponse {
  league?: { standings?: RawStandingRow[][] };
}

/** 仅保留字母组(Group A、Group B…),剔除 "Group Stage" 汇总组;行按 rank 升序。 */
export function parseStandings(response: RawStandingsResponse[]): GroupStanding[] {
  const groups = response?.[0]?.league?.standings ?? [];
  const out: GroupStanding[] = [];
  for (const g of groups) {
    const groupName = g?.[0]?.group || '';
    if (!/^Group\s+[A-L]$/i.test(groupName)) continue; // 仅 12 字母组 A–L,剔除 "Group Stage" 等汇总
    const rows: StandingRow[] = (g || []).map((r) => ({
      rank: r.rank ?? 0,
      team: (r.team?.name || '').trim(),
      played: r.all?.played ?? 0,
      win: r.all?.win ?? 0,
      draw: r.all?.draw ?? 0,
      lose: r.all?.lose ?? 0,
      goalsDiff: r.goalsDiff ?? 0,
      points: r.points ?? 0,
      description: r.description ?? null,
    })).sort((a, b) => a.rank - b.rank);
    out.push({ group: groupName, rows });
  }
  return out;
}

export async function fetchStandings(
  params: { league?: number; season?: number } = {},
  opts: ApiFootballGetOptions = {},
): Promise<GroupStanding[]> {
  const { response } = await apiFootballGet<RawStandingsResponse[]>(
    '/standings',
    { league: params.league ?? 1, season: params.season ?? 2026 },
    opts,
  );
  return parseStandings(response ?? []);
}

/** 取指定字母组(大小写不敏感);未找到返 undefined。 */
export function pickGroup(groups: GroupStanding[], letter: string): GroupStanding | undefined {
  const want = `group ${letter}`.toLowerCase().trim();
  return groups.find((g) => g.group.toLowerCase() === want);
}

export interface KnockoutMatch {
  home: string; // 原始英文队名(客户端 teamZh/flagOf)
  away: string;
  kickoffAt: string; // ISO
  round: string; // "Round of 32" 等
  status: string; // NS/1H/FT…
}

interface RawKoFixture {
  fixture?: { date?: string | null; status?: { short?: string | null } };
  league?: { round?: string | null };
  teams?: { home?: { name?: string | null }; away?: { name?: string | null } };
}

/** 取淘汰赛对阵(默认 Round of 32):返回 {home,away,kickoffAt,round,status}。队名待定(TBD/空)的剔除。 */
export async function fetchKnockoutMatchups(
  params: { league?: number; season?: number; round?: string } = {},
  opts: ApiFootballGetOptions = {},
): Promise<KnockoutMatch[]> {
  const { response } = await apiFootballGet<RawKoFixture[]>(
    '/fixtures',
    { league: params.league ?? 1, season: params.season ?? 2026, round: params.round ?? 'Round of 32' },
    opts,
  );
  const out: KnockoutMatch[] = [];
  for (const f of response ?? []) {
    const home = (f.teams?.home?.name || '').trim();
    const away = (f.teams?.away?.name || '').trim();
    if (!home || !away) continue; // 对阵未定(抽签未出)→ 跳过
    out.push({
      home,
      away,
      kickoffAt: f.fixture?.date || '',
      round: f.league?.round || params.round || 'Round of 32',
      status: f.fixture?.status?.short || 'NS',
    });
  }
  return out;
}
