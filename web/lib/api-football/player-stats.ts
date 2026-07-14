/**
 * API-Football /fixtures/players 接入（球员评分 + 全场最佳 MOTM）。
 *
 * 一图看懂用 MOTM 当代表镜头说明 + 「球员评分卡」用每队 Top 评分。
 * 真实响应:response[2 队].players[].statistics[0] = { games:{minutes,position,rating:"7.2",captain},
 *   goals:{total,assists,saves}, passes:{total,key,accuracy}, shots/dribbles/duels/tackles... }。
 * ⚠️ 大量字段为 null(门将无 shots、未出场无 rating);rating 是字符串;务必防御解析。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';
import { pickHomeAway } from './team-entry';

export interface PlayerLine {
  name: string;
  rating: number | null;
  minutes: number;
  position: string; // 中文位置:门将/后卫/中场/前锋(原始 G/D/M/F 映射后)
  goals: number;
  assists: number;
}

export interface MatchPlayerStats {
  /** 全场最佳:两队评分最高且出场够久者。无可用评分则 null。 */
  motm: { name: string; team: string; rating: number; position: string } | null;
  /** 各队按评分降序 Top（落库截前 5,够球员评分卡用）。 */
  home: PlayerLine[];
  away: PlayerLine[];
}

interface RawPlayerEntry {
  player?: { id?: number; name?: string };
  statistics?: Array<{
    games?: { minutes?: number | null; position?: string | null; rating?: string | null; captain?: boolean };
    goals?: { total?: number | null; assists?: number | null; saves?: number | null };
  }>;
}
interface RawTeamPlayers {
  team?: { id?: number; name?: string };
  players?: RawPlayerEntry[];
}

const POSITION_ZH: Record<string, string> = { G: '门将', D: '后卫', M: '中场', F: '前锋' };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toLine(entry: RawPlayerEntry): PlayerLine | null {
  const st = entry.statistics?.[0];
  const name = (entry.player?.name ?? '').trim();
  if (!st || !name) return null;
  const minutes = num(st.games?.minutes) ?? 0;
  const posRaw = (st.games?.position ?? '').trim().charAt(0).toUpperCase();
  return {
    name,
    rating: num(st.games?.rating),
    minutes,
    position: POSITION_ZH[posRaw] ?? '',
    goals: num(st.goals?.total) ?? 0,
    assists: num(st.goals?.assists) ?? 0,
  };
}

function teamLines(entry: RawTeamPlayers | undefined): PlayerLine[] {
  return (entry?.players ?? [])
    .map(toLine)
    // 出场即收:有评分 或 出场时间 >0(API 偶发 rating 有值但 minutes 为 null,不能因 minutes 缺失误杀)
    .filter((l): l is PlayerLine => l !== null && (l.rating != null || l.minutes > 0))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

/** 全场最佳:出场 ≥45 分钟里评分最高;无则放宽到 ≥30,再无则任意出场最高。 */
function pickMotm(home: PlayerLine[], teamHome: string, away: PlayerLine[], teamAway: string): MatchPlayerStats['motm'] {
  const all = [...home.map((l) => ({ l, team: teamHome })), ...away.map((l) => ({ l, team: teamAway }))]
    .filter((x) => x.l.rating != null);
  if (!all.length) return null;
  const byMin = (min: number) => all.filter((x) => x.l.minutes >= min).sort((a, b) => (b.l.rating ?? 0) - (a.l.rating ?? 0))[0];
  const best = byMin(45) ?? byMin(30) ?? all.sort((a, b) => (b.l.rating ?? 0) - (a.l.rating ?? 0))[0];
  if (!best) return null;
  return { name: best.l.name, team: best.team, rating: best.l.rating!, position: best.l.position };
}

export function parsePlayersResponse(
  response: unknown,
  homeTeamId?: number | null,
  awayTeamId?: number | null,
): MatchPlayerStats {
  const empty: MatchPlayerStats = { motm: null, home: [], away: [] };
  if (!Array.isArray(response) || response.length < 2) return empty;
  const entries = response as RawTeamPlayers[];
  const [homeEntry, awayEntry] = pickHomeAway(entries, homeTeamId, awayTeamId);
  const home = teamLines(homeEntry);
  const away = teamLines(awayEntry);
  const motm = pickMotm(home, homeEntry?.team?.name ?? '主队', away, awayEntry?.team?.name ?? '客队');
  return { motm, home: home.slice(0, 5), away: away.slice(0, 5) };
}

export async function fetchFixturePlayers(
  fixtureId: string | number,
  homeTeamId?: number | null,
  awayTeamId?: number | null,
  opts: ApiFootballGetOptions = {},
): Promise<MatchPlayerStats> {
  const { response } = await apiFootballGet<unknown>('/fixtures/players', { fixture: fixtureId }, opts);
  return parsePlayersResponse(response, homeTeamId, awayTeamId);
}
