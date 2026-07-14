/**
 * API-Football /fixtures/lineups 接入（战术图解数据源）。
 *
 * 上游约定：
 * - lineups 通常开球前 ~20-40 分钟才可用；之前调用返回空数组（不是错误）。
 * - response 为两队条目，但官方未承诺主队在前，须用 fixture 已知的
 *   home team id 对齐（matches.stats.apiFootball.homeTeamId）。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';

export interface LineupTeam {
  teamId: number | null;
  teamName: string;
  formation: string | null;
}

export interface MatchFormations {
  homeFormation: string;
  awayFormation: string;
}

interface RawLineupEntry {
  team?: { id?: number; name?: string };
  formation?: string | null;
}

export function parseLineupsResponse(response: unknown): LineupTeam[] {
  if (!Array.isArray(response)) return [];
  return (response as RawLineupEntry[]).map((entry) => ({
    teamId: typeof entry?.team?.id === 'number' ? entry.team.id : null,
    teamName: entry?.team?.name ?? '',
    formation: typeof entry?.formation === 'string' && entry.formation.trim() !== '' ? entry.formation.trim() : null,
  }));
}

/**
 * matches.external_id（sync 写入格式 `apifoot:215662`）→ lineups API 要求的纯整数 fixture id。
 * 不可解析返回 null（调用方走"暂无阵容"，不打上游）。
 * 6/11 生产 smoke 实测：透传带前缀 id → body.errors "The Fixture field must contain an integer."
 */
export function externalIdToFixtureId(externalId: string): number | null {
  const m = /^(?:apifoot:)?(\d+)$/.exec((externalId ?? '').trim());
  return m ? Number(m[1]) : null;
}

export async function fetchFixtureLineups(
  fixtureId: string | number,
  opts: ApiFootballGetOptions = {},
): Promise<LineupTeam[]> {
  const { response } = await apiFootballGet<unknown>('/fixtures/lineups', { fixture: fixtureId }, opts);
  return parseLineupsResponse(response);
}

/**
 * 两队条目 → 主/客阵型。homeTeamId 已知时按 id 对齐；未知时按 response 顺序
 * （API-Football 实际返回主队在前）。任一侧缺阵型即返回 null，调用方走"暂无阵容"。
 */
export function pickFormations(teams: LineupTeam[], homeTeamId?: number): MatchFormations | null {
  if (teams.length < 2) return null;
  let home = teams[0]!;
  let away = teams[1]!;
  if (homeTeamId != null && teams.some((t) => t.teamId === homeTeamId)) {
    home = teams.find((t) => t.teamId === homeTeamId)!;
    away = teams.find((t) => t.teamId !== homeTeamId) ?? away;
  }
  if (!home.formation || !away.formation) return null;
  return { homeFormation: home.formation, awayFormation: away.formation };
}
