/**
 * 服务号草稿「编排层」:取战报行 + 取图字节(一图看懂封面 + 战术图)→ 逐风格建草稿,共用给:
 *   - 单风格手动:POST /api/admin/mp-draft  (运营 curl / mp-draft.sh)
 *   - 全三版自动:auto-report cron 在战报+卡就绪后自动推(战术/好笑/追剧)
 *   - 全三版手动:POST /api/admin/mp-draft { all:true }
 *
 * 一次 loadContext 取齐战报行 + 封面/战术字节,三版复用同一份图(封面=一图看懂,取「段子手」report id 下的 brief)。
 * 推完用 buildDraftPushedAlert 汇成一条管理员提醒(notifyOps 企微/钉钉机器人),逐版成败一目了然。
 */
import { CARD_RENDER_CACHE_VERSION, type CardStorageClient } from '@/lib/api/card-storage';
import { buildTacticsCardKey } from '@/lib/api/tactics-card';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { translateTeam } from '@qhs/share-cards';
import { pushReportToMpDraft, type ArticleInput } from '@/lib/api/mp-draft';
import {
  ensureFanPortraitBytes,
  createFanPortraitProviderFromEnv,
  type FanPortraitProvider,
} from '@/lib/api/fan-portrait';
import type { AlertPayload } from '@/lib/alerts';

export type MpDraftStyle = 'hardcore' | 'duanzi' | 'emotion';
/** 推送/展示顺序:战术 → 好笑 → 追剧。 */
export const MP_DRAFT_STYLES: MpDraftStyle[] = ['hardcore', 'duanzi', 'emotion'];
export const STYLE_LABEL: Record<MpDraftStyle, string> = {
  hardcore: '战术版',
  duanzi: '好笑版',
  emotion: '追剧版',
};

/** 结构化 db 句柄(供 supabase service client 结构匹配,也便于单测注入)。 */
export interface MpDraftDb {
  from(table: string): {
    select(cols: string): { eq(col: string, val: string): PromiseLike<{ data: unknown }> };
  };
}

interface MatchJoin {
  short_code?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  competition?: string | null;
}
interface ReportRow {
  id: string;
  style: string;
  title: string | null;
  lead: string | null;
  body: string[] | null;
  share_quote: string | null;
  matches: MatchJoin | null;
}

export interface MpDraftStyleResult {
  style: MpDraftStyle;
  ok: boolean;
  draftId?: string;
  error?: string;
}
export interface MpDraftPublishSummary {
  matchId: string;
  matchLabel: string; // 「巴西 2:1 西班牙」
  results: MpDraftStyleResult[];
}

interface PublishContext {
  rows: ReportRow[];
  briefBytes: Buffer | null;
  tacticsBytes: Buffer | null;
  ratingsBytes: Buffer | null; // 球员评分卡(可选,正文内)
  matchLabel: string;
  homeTeam: string; // 中文,供球迷形象 prompt
  awayTeam: string;
}

/**
 * 球迷形象注入。**默认不附**——只有调用方显式 `enabled:true` 才生成。
 * 这样自动链路(auto-report cron,不传 opts)永不带球迷形象,只有手动 all 路由按 MP_DRAFT_FAN_PORTRAIT 决定 enabled。
 * provider 省略则从 env(FAN_PORTRAIT_PROVIDER)解析。
 */
export interface FanPortraitDeps {
  enabled: boolean;
  provider?: FanPortraitProvider;
}
export interface PublishAllOpts {
  fanPortrait?: FanPortraitDeps;
}

const REPORT_COLS =
  'id,style,title,lead,body,share_quote,matches(short_code,home_team,away_team,home_score,away_score,competition)';

/** 卡片未命中 COS 时按需渲染兜底:自调用 inline 卡路由(渲染 + 回填 COS),返回字节。失败/无图 → null。 */
async function renderCardBytesFallback(path: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`http://127.0.0.1:3000${path}`);
    if (!res.ok) return null; // 战术卡无阵容 404 / 灰度关 403 → 正常 null(可选图,跳过)
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** 取齐某场战报行 + 封面(一图看懂)/战术图字节。无战报返回 null。 */
async function loadContext(
  db: MpDraftDb,
  storage: CardStorageClient,
  matchId: string,
): Promise<PublishContext | null> {
  const { data } = await db.from('reports').select(REPORT_COLS).eq('match_id', matchId);
  const rows = (data ?? []) as unknown as ReportRow[];
  const first = rows[0];
  if (!first) return null;
  // 一图看懂存于「段子手」report id 下(卡路由 brief 以 style=duanzi 解析);缺则退回首行。
  const duanziId = (rows.find((r) => r.style === 'duanzi') ?? first).id;
  // 优先读已预热的 COS 字节;未命中(如升缓存版/未预热/战术卡所在场补晚出阵容)→ 按需渲染兜底,
  // 否则草稿会**静默缺图**(战术图尤甚:可选图、getBytes 拿不到就丢,用户报修"草稿缺战术图")。
  const briefBytes = (await storage.getBytes?.(`cards/${CARD_RENDER_CACHE_VERSION}/${duanziId}/brief-full-xhs.png`))
    ?? (await renderCardBytesFallback(`/api/card/${matchId}?style=duanzi&platform=xhs&variant=brief&inline=1`));
  const tacticsBytes = (await storage.getBytes?.(buildTacticsCardKey(matchId)))
    ?? (await renderCardBytesFallback(`/api/card/tactics/${matchId}?inline=1`));
  // 球员评分卡(与一图看懂同存于「段子手」report id 下,变量 ratings);未命中→按需渲染兜底。
  // 无 stats.players(未出评分数据)时卡路由 404,兜底返回 null,正文不渲染该图(可选)。
  const ratingsBytes = (await storage.getBytes?.(`cards/${CARD_RENDER_CACHE_VERSION}/${duanziId}/ratings-full-xhs.png`))
    ?? (await renderCardBytesFallback(`/api/card/${matchId}?style=duanzi&platform=xhs&variant=ratings&inline=1`));
  const m = first.matches ?? {};
  const homeTeam = translateTeam(m.home_team ?? '');
  const awayTeam = translateTeam(m.away_team ?? '');
  const matchLabel = `${homeTeam} ${m.home_score ?? 0}:${m.away_score ?? 0} ${awayTeam}`;
  return { rows, briefBytes, tacticsBytes, ratingsBytes, matchLabel, homeTeam, awayTeam };
}

function buildInput(row: ReportRow, matchId: string): ArticleInput {
  const m = row.matches ?? {};
  return {
    title: row.title ?? '',
    homeTeam: translateTeam(m.home_team ?? ''),
    awayTeam: translateTeam(m.away_team ?? ''),
    homeScore: m.home_score ?? 0,
    awayScore: m.away_score ?? 0,
    competition: sanitizeCompetition(m.competition ?? undefined) || '国际大赛',
    lead: row.lead ?? '',
    body: Array.isArray(row.body) ? row.body : [],
    shareQuote: row.share_quote ?? '',
    shortCode: m.short_code ?? matchId,
  };
}

async function publishWithContext(
  ctx: PublishContext,
  matchId: string,
  style: MpDraftStyle,
  fanPortraitBytes?: Array<Buffer | null>,
): Promise<MpDraftStyleResult> {
  const row = ctx.rows.find((r) => r.style === style) ?? ctx.rows[0];
  if (!row) return { style, ok: false, error: 'REPORT_NOT_FOUND' };
  const result = await pushReportToMpDraft({
    input: buildInput(row, matchId),
    briefBytes: ctx.briefBytes,
    tacticsBytes: ctx.tacticsBytes,
    ratingsBytes: ctx.ratingsBytes,
    fanPortraitBytes,
  });
  return { style, ok: result.ok, draftId: result.draftId, error: result.error };
}

/**
 * 取主/客队两张球迷形象字节(仅 all 路径)。要两张齐才返回,缺一张返回 undefined(避免只放一队)。
 * 由 MP_DRAFT_FAN_PORTRAIT 兜底开关 + FAN_PORTRAIT_PROVIDER 控制;best-effort,失败静默(草稿照常建)。
 */
async function resolveFanPortraits(
  ctx: PublishContext,
  matchId: string,
  storage: CardStorageClient,
  opts?: PublishAllOpts,
): Promise<Array<Buffer | null> | undefined> {
  // 默认关:不传 opts(自动链路)永不附;手动 all 路由按 MP_DRAFT_FAN_PORTRAIT 传 enabled。
  const enabled = opts?.fanPortrait?.enabled ?? false;
  if (!enabled) return undefined;
  let provider: FanPortraitProvider;
  try {
    provider = opts?.fanPortrait?.provider ?? createFanPortraitProviderFromEnv();
  } catch {
    return undefined; // provider 配置缺失 → 不附,不拖垮草稿
  }
  const home = await ensureFanPortraitBytes({ matchId, side: 'home', team: ctx.homeTeam }, { provider, storage });
  const away = await ensureFanPortraitBytes({ matchId, side: 'away', team: ctx.awayTeam }, { provider, storage });
  if (!home || !away) return undefined; // 不齐则整段不放
  return [home, away];
}

/** 推单风格草稿。无战报 → {ok:false, error:'REPORT_NOT_FOUND'}(路由据此回 404)。 */
export async function publishStyle(
  db: MpDraftDb,
  storage: CardStorageClient,
  matchId: string,
  style: MpDraftStyle,
): Promise<MpDraftStyleResult> {
  const ctx = await loadContext(db, storage, matchId);
  if (!ctx) return { style, ok: false, error: 'REPORT_NOT_FOUND' };
  return publishWithContext(ctx, matchId, style);
}

/** 推全三版(战术/好笑/追剧)。共用一份封面/战术图 + 一份主客队球迷形象(末尾)。无战报 → null。 */
export async function publishAllStyles(
  db: MpDraftDb,
  storage: CardStorageClient,
  matchId: string,
  opts?: PublishAllOpts,
): Promise<MpDraftPublishSummary | null> {
  const ctx = await loadContext(db, storage, matchId);
  if (!ctx) return null;
  // 球迷形象主/客队各一张,三版复用(生成/缓存一次)。仅 all 路径附带。
  const fanPortraitBytes = await resolveFanPortraits(ctx, matchId, storage, opts);
  const results: MpDraftStyleResult[] = [];
  // 顺序推:首版填充 mp-draft token 缓存,后两版直接命中,避免并发重复取 token。
  for (const style of MP_DRAFT_STYLES) {
    results.push(await publishWithContext(ctx, matchId, style, fanPortraitBytes));
  }
  return { matchId, matchLabel: ctx.matchLabel, results };
}

/** 把三版推送结果汇成一条管理员提醒:全成 P2,有失败 P1,逐版 ✅/❌。 */
export function buildDraftPushedAlert(summary: MpDraftPublishSummary): AlertPayload {
  const failed = summary.results.filter((r) => !r.ok);
  const okCount = summary.results.length - failed.length;
  const lines = summary.results.map(
    (r) => `${r.ok ? '✅' : '❌'} ${STYLE_LABEL[r.style]}${r.ok ? '' : `（${r.error ?? '失败'}）`}`,
  );
  const allOk = failed.length === 0;
  return {
    severity: allOk ? 'P2' : 'P1',
    title: `${allOk ? '公众号草稿已推送' : '公众号草稿部分失败'}：${summary.matchLabel}`,
    body: `${summary.matchLabel}\n${lines.join('\n')}\n\n成功 ${okCount}/${summary.results.length} · 去服务号后台「草稿箱」改两下即可发`,
    tags: ['mp-draft'],
  };
}
