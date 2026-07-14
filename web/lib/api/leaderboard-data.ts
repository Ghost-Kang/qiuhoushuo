/**
 * 榜单 JSON 数据层(端内页 /api/leaderboard、/api/standings 共用)+ 进程内缓存。
 *
 * 端内页每次进都拉数据 → 若每次都打 API-Football 会"先加载一会"。这里做进程内缓存(小时级 key),
 * 配每小时 warm-leaderboards cron 预热(force 刷新)→ 用户进页命中缓存秒出。
 * 数据随赛程小时级更新(与榜单卡一致),缓存 key 带北京小时戳,自然每小时换新。
 */

import { fetchLeaderboard, type LeaderEntry } from '@/lib/api-football/leaderboard';
import { lookupPlayerZh } from '@/lib/api-football/player-names-zh';
import { fetchStandings, fetchKnockoutMatchups, type GroupStanding } from '@/lib/api-football/standings';
import { isQualified } from '@/lib/api/standings-card';
import { beijingDateParts } from '@/lib/api/scoreboard-card';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';

/**
 * 射手榜/助攻榜**从 matches.events 直接算**(2026-06-30 改):第三方 `/players/topscorers` 聚合接口比单场
 * events 接口滞后(完赛后单场进球已入库,聚合榜还没算进去)→ 完赛刷新也是旧数。改从 events 聚合即时准确。
 * 计数规则(2026-07-04 修):
 * - `goal` 计,但**乌龙球不计**(事件 team=受益方、player=对方后卫,计了就是把乌龙记成人家的进球+挂错队,佛得角博尔赫斯案例);
 * - `penalty` 计**运动战点球**(金靴口径含点球),但**点球大战逐轮不计**(战平场 minute>120,与对阵图/brief 卡同口径)——
 *   旧版一刀切排除全部 penalty,把 C罗 68' 运动战点球也漏了;
 * - apps=该球员进球/助攻分布的场次数。
 */
type RawGoalEvent = { type?: string | null; team?: string | null; player?: string | null; assist?: string | null; minute?: number | null; description?: string | null };
type ScoreRow = { events: RawGoalEvent[] | null; home_score?: number | null; away_score?: number | null };
export function computeScoreLeaderboards(rows: ScoreRow[], limit = 20): { scorers: LeaderEntry[]; assists: LeaderEntry[] } {
  type Agg = { name: string; team: string; count: number; matches: Set<number> };
  const g = new Map<string, Agg>(), a = new Map<string, Agg>();
  const bump = (m: Map<string, Agg>, name: string, team: string, idx: number) => {
    const key = `${name}|${team}`;
    const cur = m.get(key) || { name, team, count: 0, matches: new Set<number>() };
    cur.count += 1; cur.matches.add(idx); m.set(key, cur);
  };
  rows.forEach((r, i) => {
    const evs = Array.isArray(r.events) ? r.events : [];
    const drawn = r.home_score != null && r.home_score === r.away_score;
    for (const e of evs) {
      if (!e || (e.type !== 'goal' && e.type !== 'penalty')) continue;
      if (e.type === 'penalty' && drawn && typeof e.minute === 'number' && e.minute > 120) continue; // 点球大战逐轮
      if (/乌龙|own\s*goal/i.test(e.description || '')) continue; // 乌龙球不计给任何人
      const team = (e.team || '').trim();
      const player = (e.player || '').trim();
      if (player) bump(g, player, team, i);
      const assist = (e.assist || '').trim();
      if (assist) bump(a, assist, team, i);
    }
  });
  const top = (m: Map<string, Agg>): LeaderEntry[] =>
    [...m.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)).slice(0, limit)
      .map((x) => ({ name: x.name, team: x.team, count: x.count, apps: x.matches.size }));
  return { scorers: top(g), assists: top(a) };
}

/** 从 matches 表(已完赛)取 events 算射手榜/助攻榜;无 DB → null(调用方回退第三方聚合接口)。 */
export async function fetchScoreLeaderboardsFromDb(limit = 20): Promise<{ scorers: LeaderEntry[]; assists: LeaderEntry[] } | null> {
  if (!USE_DB) return null;
  const db = getSupabaseService();
  if (!db) return null;
  const { data, error } = await db.from('matches').select('events,home_score,away_score').eq('status', 'finished');
  if (error) throw error;
  return computeScoreLeaderboards((data || []) as ScoreRow[], limit);
}

export interface LeaderboardJson {
  scorers: { name: string; team: string; count: number; apps: number }[];
  assists: { name: string; team: string; count: number; apps: number }[];
  asof: string;
}
export interface StandingsJson {
  groups: { group: string; rows: { rank: number; team: string; played: number; win: number; draw: number; lose: number; goalsDiff: number; points: number; qualified: boolean }[] }[];
  knockout: { home: string; away: string; kickoffAt: string; round: string; status: string }[];
  asof: string;
}

type Cached<T> = { data: T; expiresAt: number };
const cache = new Map<string, Cached<unknown>>();
const TTL_MS = 90 * 60 * 1000; // 90min:配每小时 cron 刷新,小时 key 之间不空窗

function readCache<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) { cache.delete(key); return null; }
  return e.data as T;
}
function writeCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

function toLeaderRow(l: LeaderEntry) {
  // 球员名服务端译中文(lookupPlayerZh,~600 名覆盖各队 Top5,查不到回退英文),队名英文(端 teamZh/flagOf 自解析)
  return { name: lookupPlayerZh(l.name) ?? l.name, team: l.team, count: l.count, apps: l.apps };
}
function groupLetter(group: string): string {
  const m = /^Group\s+([A-L])$/i.exec((group || '').trim());
  return m ? m[1]!.toUpperCase() : '';
}
function toGroup(g: GroupStanding) {
  return {
    group: groupLetter(g.group),
    rows: g.rows.map((r) => ({
      rank: r.rank, team: r.team, played: r.played, win: r.win, draw: r.draw, lose: r.lose,
      goalsDiff: r.goalsDiff, points: r.points, qualified: isQualified(r.description),
    })),
  };
}

/** 射手榜/助攻榜 JSON(缓存命中秒返;force=true 跳缓存重取并回填,供 cron 预热)。 */
export async function getLeaderboardData(force = false): Promise<LeaderboardJson> {
  const { stamp, display } = beijingDateParts();
  const key = `leaderboard:${stamp}`;
  if (!force) { const hit = readCache<LeaderboardJson>(key); if (hit) return hit; }
  // 优先从 matches.events 算(即时准确·不滞后);无 DB 时回退第三方聚合接口。
  const fromDb = await fetchScoreLeaderboardsFromDb(20);
  const { scorers, assists } = fromDb ?? {
    scorers: await fetchLeaderboard('topscorers', {}, {}, 20),
    assists: await fetchLeaderboard('topassists', {}, {}, 20),
  };
  const data: LeaderboardJson = { scorers: scorers.map(toLeaderRow), assists: assists.map(toLeaderRow), asof: display };
  writeCache(key, data);
  return data;
}

/** 12 组积分榜 + 淘汰赛对阵 JSON(缓存命中秒返;淘汰赛抽签未出不拖垮主体)。 */
export async function getStandingsData(force = false): Promise<StandingsJson> {
  const { stamp, display } = beijingDateParts();
  const key = `standings:${stamp}`;
  if (!force) { const hit = readCache<StandingsJson>(key); if (hit) return hit; }
  const [groups, knockout] = await Promise.all([
    fetchStandings(),
    fetchKnockoutMatchups().catch(() => []),
  ]);
  const data: StandingsJson = {
    groups: groups.map(toGroup).filter((g) => g.group),
    knockout: knockout.map((k) => ({ home: k.home, away: k.away, kickoffAt: k.kickoffAt, round: k.round, status: k.status })),
    asof: display,
  };
  writeCache(key, data);
  return data;
}

export function __clearLeaderboardCacheForTests() {
  cache.clear();
}
