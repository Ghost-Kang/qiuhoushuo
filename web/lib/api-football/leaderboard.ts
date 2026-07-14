/**
 * API-Football /players/topscorers + /players/topassists 接入(赛事级射手榜/助攻榜)。
 *
 * 真实响应:response[].{ player:{name}, statistics:[{ team:{name}, league:{name 为该赛事英文名},
 *   games:{appearences,minutes,position}, goals:{total,assists} }] }。已按相关计数降序。
 * ⚠️ league.name 为该赛事英文名 → 卡片层须 sanitizeCompetition;name 形如 "L. Messi"(可带变音符)。
 * statistics[0] 即该赛事统计(国家队每人单队,取首条)。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';

export interface LeaderEntry {
  name: string; // 原始名(card 层 fontSafe/compactName)
  team: string; // 原始英文队名(card 层 translateTeam)
  count: number; // 进球数(射手榜)或助攻数(助攻榜)
  apps: number; // 出场场次
}

export type LeaderboardKind = 'topscorers' | 'topassists';

interface RawLeaderEntry {
  player?: { name?: string | null };
  statistics?: Array<{
    team?: { name?: string | null };
    league?: { id?: number | null };
    games?: { appearences?: number | null };
    goals?: { total?: number | null; assists?: number | null };
  }>;
}

/** 取本赛事的统计条(转会球员 statistics 可能多条);优先 league.id 命中,回退首条。 */
function pickLeagueStat(stats: RawLeaderEntry['statistics'], leagueId: number) {
  if (!stats || !stats.length) return undefined;
  return stats.find((s) => s.league?.id === leagueId) ?? stats[0];
}

/**
 * 解析单种榜(进球或助攻):取本赛事统计条、剔除计数≤0,**按计数降序自排**(不信 API 顺序,
 * 否则金靴领跑/榜首可能错),最多 limit 条。V8 sort 稳定,同分保留原序。
 */
export function parseLeaderboard(kind: LeaderboardKind, response: RawLeaderEntry[], limit = 10, leagueId = 1): LeaderEntry[] {
  const all: LeaderEntry[] = [];
  for (const e of response || []) {
    const stat = pickLeagueStat(e.statistics, leagueId);
    if (!stat) continue;
    const count = kind === 'topscorers' ? stat.goals?.total ?? 0 : stat.goals?.assists ?? 0;
    if (!count || count <= 0) continue;
    all.push({
      name: (e.player?.name || '').trim(),
      team: (stat.team?.name || '').trim(),
      count,
      apps: stat.games?.appearences ?? 0,
    });
  }
  all.sort((a, b) => b.count - a.count);
  return all.slice(0, limit);
}

export async function fetchLeaderboard(
  kind: LeaderboardKind,
  params: { league?: number; season?: number } = {},
  opts: ApiFootballGetOptions = {},
  limit = 10,
): Promise<LeaderEntry[]> {
  const league = params.league ?? 1;
  const { response } = await apiFootballGet<RawLeaderEntry[]>(
    `/players/${kind}`,
    { league, season: params.season ?? 2026 },
    opts,
  );
  return parseLeaderboard(kind, response ?? [], limit, league);
}
