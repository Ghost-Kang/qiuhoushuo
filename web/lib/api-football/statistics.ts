/**
 * API-Football /fixtures/statistics 接入（一图看懂「数据证据」的真实数据源）。
 *
 * 此前 matches.stats 从没被技术统计填过 → 一图看懂「数据证据」只能降级成一个「比分」占位。
 * 终场后统计已稳定,auto-report 在生成前拉一次并落 matches.stats(与 events 同构),
 * 供「数据证据」/分享卡/战报 prompt 复用。拉取/落库失败不抛,主链路照常走。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';
import { pickHomeAway } from './team-entry';

/** 数据证据可用的技术统计(都为 {home, away} 成对;缺一不成对则不落该项)。 */
export interface FixtureStats {
  possession?: { home: number; away: number };
  shots?: { home: number; away: number };
  shots_on_target?: { home: number; away: number };
  corners?: { home: number; away: number };
  fouls?: { home: number; away: number };
  offsides?: { home: number; away: number };
  pass_accuracy?: { home: number; away: number };
  saves?: { home: number; away: number };
  xg?: { home: number; away: number };
}

/** API-Football 统计名(小写) → 我们的 stats 键。不认识的统计项丢弃。 */
const STAT_TYPE_TO_KEY: Record<string, keyof FixtureStats> = {
  'ball possession': 'possession',
  'total shots': 'shots',
  'shots on goal': 'shots_on_target',
  'corner kicks': 'corners',
  'fouls': 'fouls',
  'offsides': 'offsides',
  'passes %': 'pass_accuracy',
  'goalkeeper saves': 'saves',
  'expected_goals': 'xg',
};

const STAT_KEYS: Array<keyof FixtureStats> = [
  'possession', 'shots', 'shots_on_target', 'corners', 'fouls', 'offsides', 'pass_accuracy', 'saves', 'xg',
];

interface RawTeamStats {
  team?: { id?: number; name?: string };
  statistics?: Array<{ type?: string; value?: number | string | null }>;
}

/** "58%" / 16 / "1.91" / null → number | null。统一去掉百分号,非数丢弃。 */
function parseStatValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** 一支球队的 statistics 数组 → {键: 值}(只收认识且有值的)。 */
function teamStatsDict(statistics: RawTeamStats['statistics']): Partial<Record<keyof FixtureStats, number>> {
  const dict: Partial<Record<keyof FixtureStats, number>> = {};
  for (const entry of statistics ?? []) {
    const key = STAT_TYPE_TO_KEY[(entry?.type ?? '').toLowerCase()];
    if (!key) continue;
    const value = parseStatValue(entry?.value);
    if (value !== null) dict[key] = value;
  }
  return dict;
}

/**
 * /fixtures/statistics 响应 → FixtureStats。
 * 主客队映射优先用 team id(sync 已落 stats.apiFootball.homeTeamId/awayTeamId);
 * 拿不到 id 时退回 API 约定顺序(response[0]=主、response[1]=客)。
 */
export function parseStatisticsResponse(
  response: unknown,
  homeTeamId?: number | null,
  awayTeamId?: number | null,
): FixtureStats {
  if (!Array.isArray(response) || response.length < 2) return {};
  const entries = response as RawTeamStats[];
  const [homeEntry, awayEntry] = pickHomeAway(entries, homeTeamId, awayTeamId);
  const home = teamStatsDict(homeEntry?.statistics);
  const away = teamStatsDict(awayEntry?.statistics);
  const out: FixtureStats = {};
  for (const key of STAT_KEYS) {
    const h = home[key];
    const a = away[key];
    if (h != null && a != null) out[key] = { home: h, away: a };
  }
  return out;
}

export async function fetchFixtureStatistics(
  fixtureId: string | number,
  homeTeamId?: number | null,
  awayTeamId?: number | null,
  opts: ApiFootballGetOptions = {},
): Promise<FixtureStats> {
  const { response } = await apiFootballGet<unknown>('/fixtures/statistics', { fixture: fixtureId }, opts);
  return parseStatisticsResponse(response, homeTeamId, awayTeamId);
}
