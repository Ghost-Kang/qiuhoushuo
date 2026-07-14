import type { MatchData } from '@/lib/prompts';
import type { FixtureStats } from '@/lib/api-football/statistics';
import type { MatchPlayerStats } from '@/lib/api-football/player-stats';
import type { CardStorageClient } from '@/lib/api/card-storage';
import { buildHighlightMoments } from '@/lib/api/highlight-moments';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { translateTeam } from '@qhs/share-cards';
import { lookupPlayerZh } from '@/lib/api-football/player-names-zh';
import {
  buildHighlightImageKey,
  generateHighlightImage,
  toHighlightImageInput,
  type HighlightImageProvider,
} from '@/lib/api/highlight-image';

/**
 * 自动报战报助手（架构审视 R5）。Next.js 路由文件只能导出 GET/POST/config，
 * 故纯逻辑与类型放本 lib，路由 import 使用、测试也 import 本 lib。
 */

export interface MatchRow {
  id: string;
  external_id?: string | null;
  competition: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  match_date: string;
  status: string;
  stats: unknown;
  events: unknown;
}

export type ReportableDb = {
  from(table: 'matches'): {
    select(columns: string): {
      eq(column: 'status', value: string): {
        gte(column: 'match_date', value: string): {
          limit(n: number): PromiseLike<{ data: MatchRow[] | null }>;
        };
      };
    };
    update(values: { events: unknown } | { stats: unknown }): {
      eq(column: 'id', value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  from(table: 'reports'): {
    select(columns: string): {
      in(column: 'match_id', values: string[]): PromiseLike<{ data: { match_id: string }[] | null }>;
    };
  };
};

/**
 * F63:终场后拉一次真实赛事事件(进球者/分钟)并落 matches.events。
 * fixtures 同步只有比分——没有这一步,LLM 战报和镜头 prompt 都在"无料创作"。
 * 拉取/落库失败不抛(返回原 events),战报主链路照常走。
 */
export async function enrichMatchWithEvents(
  db: ReportableDb,
  m: MatchRow,
  fetchEvents: (fixtureId: number) => Promise<unknown[]>,
  fixtureIdOf: (externalId: string) => number | null,
  externalId: string | null | undefined,
  force = false, // 解析器升级(新增 VAR/点球射失)后,一次性重拉老比赛 events 用
): Promise<MatchRow> {
  if (!force && Array.isArray(m.events) && m.events.length > 0) return m; // 已有事件,幂等(force 时强制重拉)
  const fixtureId = externalId ? fixtureIdOf(externalId) : null;
  if (fixtureId == null) return m;
  try {
    const events = await fetchEvents(fixtureId);
    if (!events.length) return m;
    const { error } = await db.from('matches').update({ events }).eq('id', m.id);
    if (error) console.warn(`[auto-report] events 落库失败 match=${m.id}:`, error.message);
    return { ...m, events };
  } catch (err) {
    console.warn(`[auto-report] events 拉取失败 match=${m.id}:`, (err as Error).message);
    return m;
  }
}

/** matches.stats 是否已含真实技术统计(任一统计键)——区分"只有 apiFootball 占位"与"已富集"。 */
function hasRealStats(stats: unknown): boolean {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false;
  const keys = ['possession', 'shots', 'shots_on_target', 'corners', 'fouls', 'offsides', 'pass_accuracy', 'saves', 'xg'];
  return keys.some((k) => (stats as Record<string, unknown>)[k] != null);
}

/**
 * 终场后拉一次真实技术统计(控球/射门/角球/犯规…)并落 matches.stats,喂一图看懂「数据证据」。
 * 幂等:已有真实统计则跳过。**合并而非覆盖**——保留 sync 落的 stats.apiFootball(队徽/阵型依赖)。
 * 拉取/落库失败不抛(返回原 m),战报主链路照常走。
 */
export async function enrichMatchWithStats(
  db: ReportableDb,
  m: MatchRow,
  fetchStats: (fixtureId: number, homeTeamId?: number | null, awayTeamId?: number | null) => Promise<FixtureStats>,
  fixtureIdOf: (externalId: string) => number | null,
  externalId: string | null | undefined,
): Promise<MatchRow> {
  if (hasRealStats(m.stats)) return m; // 已富集,幂等
  const fixtureId = externalId ? fixtureIdOf(externalId) : null;
  if (fixtureId == null) return m;
  const existing = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats)
    ? (m.stats as Record<string, unknown>)
    : {};
  const apiFootball = existing.apiFootball as { homeTeamId?: number; awayTeamId?: number } | undefined;
  try {
    const fetched = await fetchStats(fixtureId, apiFootball?.homeTeamId ?? null, apiFootball?.awayTeamId ?? null);
    if (!fetched || Object.keys(fetched).length === 0) return m;
    const merged = { ...existing, ...fetched }; // 保留 apiFootball,新增/覆盖统计键
    const { error } = await db.from('matches').update({ stats: merged }).eq('id', m.id);
    if (error) console.warn(`[auto-report] stats 落库失败 match=${m.id}:`, error.message);
    return { ...m, stats: merged };
  } catch (err) {
    console.warn(`[auto-report] stats 拉取失败 match=${m.id}:`, (err as Error).message);
    return m;
  }
}

/**
 * 终场后拉球员评分(/fixtures/players)落 matches.stats.players,喂一图看懂「全场最佳」+ 球员评分卡。
 * 幂等(已有 players 则跳过,force 时重拉)。合并写入,保留技术统计与 apiFootball。失败不抛。
 */
export async function enrichMatchWithPlayers(
  db: ReportableDb,
  m: MatchRow,
  fetchPlayers: (fixtureId: number, homeTeamId?: number | null, awayTeamId?: number | null) => Promise<MatchPlayerStats>,
  fixtureIdOf: (externalId: string) => number | null,
  externalId: string | null | undefined,
  force = false,
): Promise<MatchRow> {
  const existing = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats)
    ? (m.stats as Record<string, unknown>)
    : {};
  if (!force && existing.players) return m; // 已富集,幂等
  const fixtureId = externalId ? fixtureIdOf(externalId) : null;
  if (fixtureId == null) return m;
  const apiFootball = existing.apiFootball as { homeTeamId?: number; awayTeamId?: number } | undefined;
  try {
    const players = await fetchPlayers(fixtureId, apiFootball?.homeTeamId ?? null, apiFootball?.awayTeamId ?? null);
    if (!players || (!players.motm && players.home.length === 0 && players.away.length === 0)) return m;
    const merged = { ...existing, players };
    const { error } = await db.from('matches').update({ stats: merged }).eq('id', m.id);
    if (error) console.warn(`[auto-report] players 落库失败 match=${m.id}:`, error.message);
    return { ...m, stats: merged };
  } catch (err) {
    console.warn(`[auto-report] players 拉取失败 match=${m.id}:`, (err as Error).message);
    return m;
  }
}

/** 点球大战逐轮是否已落库(战平场次 minute>120 的 penalty/penalty_missed,与 bracket penScore 同口径)。 */
export function hasPenShootoutEvents(events: unknown): boolean {
  if (!Array.isArray(events)) return false;
  return (events as Array<{ type?: unknown; minute?: unknown }>).some(
    (e) => (e?.type === 'penalty' || e?.type === 'penalty_missed') && typeof e?.minute === 'number' && e.minute > 120,
  );
}

/**
 * PEN 完赛但点球大战逐轮尚未落库 → 战报必须等。
 * 根因(2026-07-04 澳埃战):上游 events 里点球逐轮比终场慢发布,战报先跑,LLM 只见 1:1 猜赢家,
 * hardcore 标题写成「澳大利亚点球晋级」(实际埃及 4:2)——错误内容直通小程序/公众号草稿/社媒文案。
 */
export function isPenShootoutPending(m: MatchRow): boolean {
  const stats = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats) ? (m.stats as Record<string, unknown>) : {};
  if (stats.statusRaw !== 'PEN') return false;
  return !hasPenShootoutEvents(m.events);
}

/** 点球大战比分(主/客),事件不足时 null。只对战平场次计算,运动战点球不掺入(对阵图同规则)。 */
export function penShootoutScore(m: MatchRow): { home: number; away: number } | null {
  if (m.home_score == null || m.away_score == null || m.home_score !== m.away_score) return null;
  if (!Array.isArray(m.events)) return null;
  let home = 0;
  let away = 0;
  let any = false;
  for (const e of m.events as Array<{ type?: unknown; minute?: unknown; team?: unknown }>) {
    if ((e?.type !== 'penalty' && e?.type !== 'penalty_missed') || typeof e?.minute !== 'number' || e.minute <= 120) continue;
    any = true;
    if (e.type !== 'penalty') continue;
    if (typeof e.team === 'string' && e.team.trim().toLowerCase() === m.home_team.trim().toLowerCase()) home += 1;
    else away += 1;
  }
  return any ? { home, away } : null;
}

export function matchRowToMatchData(m: MatchRow): MatchData {
  const home = m.home_score ?? 0;
  const away = m.away_score ?? 0;
  // 喂 LLM 的 prompt 源头就清洗:队名英→中 + 赛事商标词→国际大赛 + **球员名英→中**(lookupPlayerZh,查不到保英文),
  // 避免生成正文带英文队名/球员名或境外赛事商标词(正文在端上是原样输出;2026-07-03 用户报战报正文球员名出英文)。
  const zhP = (n: unknown): unknown => (typeof n === 'string' && n ? (lookupPlayerZh(n) ?? n) : n);
  const events = Array.isArray(m.events)
    ? (m.events as Array<Record<string, unknown>>).map((e) => ({
        ...e,
        team: typeof e.team === 'string' && e.team ? translateTeam(e.team) || e.team : e.team,
        player: zhP(e.player),
        assist: zhP(e.assist),
      }))
    : [];
  // stats.players(home/away 数组 + motm)一并译名——整个 stats 会 JSON.stringify 进 prompt。
  let stats = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats) ? (m.stats as Record<string, unknown>) : {};
  const players = stats.players as { home?: Array<Record<string, unknown>>; away?: Array<Record<string, unknown>>; motm?: Record<string, unknown> } | undefined;
  if (players && typeof players === 'object') {
    const zhList = (l?: Array<Record<string, unknown>>) => (Array.isArray(l) ? l.map((p) => ({ ...p, name: zhP(p.name) })) : l);
    stats = {
      ...stats,
      players: {
        ...players,
        home: zhList(players.home),
        away: zhList(players.away),
        motm: players.motm && typeof players.motm === 'object'
          ? { ...players.motm, name: zhP(players.motm.name), team: typeof players.motm.team === 'string' ? translateTeam(players.motm.team) || players.motm.team : players.motm.team }
          : players.motm,
      },
    };
  }
  // 点球大战比分显式喂给 LLM(match/final_score 双通道)——只给 1:1 让模型自行判断晋级方,
  // 就是澳埃战「澳大利亚点球晋级」事故的来源;有生成门兜底,这里是第二道保险。
  const pens = penShootoutScore(m);
  const homeZh = translateTeam(m.home_team);
  const awayZh = translateTeam(m.away_team);
  const penNote = pens ? `（点球大战 ${pens.home}:${pens.away}，${pens.home > pens.away ? homeZh : awayZh}晋级）` : '';
  return {
    match: `${homeZh} ${home}:${away} ${awayZh}${penNote}`,
    competition: sanitizeCompetition(m.competition),
    date: new Date(m.match_date).toISOString().slice(0, 10),
    final_score: `${home}-${away}${penNote}`,
    events: events as MatchData['events'],
    stats: stats as MatchData['stats'],
  };
}

export interface HighlightImagesResult {
  generated: number;
  skipped: number;
  failed: number;
}

/**
 * 给一场比赛的镜头卡补生成配图（幂等：COS 已有的跳过）。
 * 6/12 揭幕战实测缺口：auto-report 自动生成战报,但生图原本只有 admin 手动触发,
 * 真实比赛的镜头卡全是无图兜底——战报自动化必须连带镜头图自动化。
 * 单个镜头失败只计数不抛：图是增强项,不能拖垮战报主链路。
 */
export async function generateMissingHighlightImages(
  m: MatchRow,
  deps: { provider: HighlightImageProvider; storage: CardStorageClient },
): Promise<HighlightImagesResult> {
  const stats = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats)
    ? (m.stats as Parameters<typeof buildHighlightMoments>[1])
    : null;
  const moments = buildHighlightMoments(m, stats, Array.isArray(m.events) ? (m.events as Parameters<typeof buildHighlightMoments>[2]) : null);
  const result: HighlightImagesResult = { generated: 0, skipped: 0, failed: 0 };
  for (const moment of moments) {
    try {
      const key = buildHighlightImageKey({ matchId: m.id, momentId: moment.id });
      if (await deps.storage.exists(key)) {
        result.skipped += 1;
        continue;
      }
      await generateHighlightImage(toHighlightImageInput(m.id, moment), deps);
      result.generated += 1;
    } catch (err) {
      result.failed += 1;
      console.warn(`[auto-report] highlight image fail match=${m.id} moment=${moment.id}:`, (err as Error).message);
    }
  }
  return result;
}

/** 找 status=finished 且尚无战报的比赛（近 sinceIso 起的窗口内）。 */
export async function findReportableMatches(db: ReportableDb, sinceIso: string, limit: number): Promise<MatchRow[]> {
  const { data: matches } = await db
    .from('matches')
    .select('id,external_id,competition,home_team,away_team,home_score,away_score,match_date,status,stats,events')
    .eq('status', 'finished')
    .gte('match_date', sinceIso)
    .limit(limit);
  const rows = matches ?? [];
  if (rows.length === 0) return [];
  const { data: reps } = await db.from('reports').select('match_id').in(
    'match_id',
    rows.map((m) => m.id),
  );
  const reported = new Set((reps ?? []).map((r) => r.match_id));
  return rows.filter((m) => !reported.has(m.id));
}

/**
 * 找 status=finished 的比赛（窗口内,不论是否已有战报）——镜头图补全 pass 用。
 * F67d:report 与 highlight image 生成原本耦合在 findReportableMatches 里,
 * 一旦某场"战报已生成、图当时失败",该场永远滑出 reportable 窗口、镜头图再也补不上
 * （韩国捷克 2:1 捷克:13 事件 + 3 战报俱全,独缺镜头图）。本函数给补图 pass 独立的扫描口,
 * 配合 generateMissingHighlightImages 的 COS 幂等跳过,已有图零成本。
 */
export async function findFinishedMatches(db: ReportableDb, sinceIso: string, limit: number): Promise<MatchRow[]> {
  const { data } = await db
    .from('matches')
    .select('id,external_id,competition,home_team,away_team,home_score,away_score,match_date,status,stats,events')
    .eq('status', 'finished')
    .gte('match_date', sinceIso)
    .limit(limit);
  return data ?? [];
}
