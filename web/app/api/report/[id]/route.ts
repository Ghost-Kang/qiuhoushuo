import { z } from 'zod';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { mockReport } from '@/lib/api/mock';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { findUserByOpenid } from '@/lib/api/users';
import { addAIGCWatermark } from '@/lib/safety';
import type { ReportStyle } from '@/lib/prompts';
import { getCardStorage } from '@/lib/api/card-storage';
import { buildHighlightImageKey } from '@/lib/api/highlight-image';
import { buildHighlightMoments, type HighlightMoment } from '@/lib/api/highlight-moments';
import { buildMatchBriefCard, sanitizeCompetition } from '@/lib/api/match-brief-card';
import { translateTeam } from '@qhs/share-cards';

const Params = z.object({ id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/) });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 深度战报付费墙总开关(默认关 → premium 全解锁、免费):仅 REPORT_PAYWALL_ENABLED=1 时对未付费用户锁 premium。
// 收费链路(赛事通 deep_report ¥19 / 决赛专栏 final_column ¥9)已验证,先关开关让用户免费用起来,可随时翻回。
const REPORT_PAYWALL_ENABLED = process.env.REPORT_PAYWALL_ENABLED === '1';

type MatchRow = {
  id?: string;
  short_code?: string | null;
  competition?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  match_date?: string | null;
  stats?: Record<string, unknown> | null;
  events?: unknown;
};

type ReportRow = {
  id: string;
  match_id: string;
  style: ReportStyle;
  title: string;
  subtitle: string | null;
  lead: string;
  body: string[];
  ending: string;
  share_quote: string;
  tags: string[];
  is_premium: boolean;
  matches?: MatchRow | null;
};

export type ReportDetailDb = {
  from(table: 'users'): ReturnType<import('@/lib/api/users').UsersClient['from']>;
  from(table: 'reports'): {
    select(columns: string): {
      eq(column: 'match_id', value: string): PromiseLike<{ data: ReportRow[] | null }>;
      eq(column: 'id', value: string): {
        maybeSingle(): PromiseLike<{ data: { match_id: string } | null }>;
      };
    };
  };
  from(table: 'matches'): {
    select(columns: string): {
      eq(column: 'short_code', value: string): {
        maybeSingle(): PromiseLike<{ data: { id: string } | null }>;
      };
    };
  };
  from(table: 'payments'): {
    select(columns: string): {
      eq(column: 'user_id', value: string): {
        eq(column: 'status', value: 'success'): PromiseLike<{ data: { sku: string }[] | null }>;
      };
    };
  };
};

function getReportDetailDb(): ReportDetailDb | null {
  const client: object | null = getSupabaseService();
  return client ? client as ReportDetailDb : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestId();
  try {
    const openid = getOpenid(req);
    if (!openid) return unauthorized();
    const parsed = withZod(Params, await ctx.params);
    if ('error' in parsed) return parsed.error;
    const showHostIntro = isFeatureEnabled('feature.host_intro_card', { openid });
    if (!USE_DB) return ok(withHostIntro(withBriefCard(unlockMockPaywall(mockReport(parsed.data.id))), showHostIntro));
    const db = getReportDetailDb()!;
    const user = await findUserByOpenid(db, openid);
    const matchId = await resolveMatchId(db, parsed.data.id);
    if (!matchId) return notFound();
    const { data: rows } = await db.from('reports').select('*,matches(*)').eq('match_id', matchId);
    const all = rows ?? [];
    if (!all.length) return notFound();
    const first = all[0];
    if (!first) return notFound();
    const skus = user ? await successfulSkus(db, user.id) : new Set<string>();
    // 付费墙关 → 一律视为已解锁(免费给全文);开则按 SKU 权益判定。
    const paid = !REPORT_PAYWALL_ENABLED || isPremiumUnlocked(skus, all);
    const highlightMoments = await withExistingHighlightImageUrls(
      first.match_id,
      buildHighlightMoments(
        first.matches ?? {},
        first.matches?.stats ?? null,
        Array.isArray(first.matches?.events) ? first.matches.events : null,
      ),
    );
    // premium 行不再丢弃:保留但锁定(正文截首段预览 + premium_locked=true),前端渲染付费墙;付费后给全文。
    const styles = Object.fromEntries(all.map((r: ReportRow) => [r.style, toStyle(r, first.matches?.stats ?? null, paid)]));
    return ok(withHostIntro({
      id: first.match_id,
      short_code: first.matches?.short_code || parsed.data.id,
      competition: sanitizeCompetition(first.matches?.competition), // 合规:境外赛事商标词→国际大赛
      date: new Date(first.matches?.match_date || '').toISOString().slice(0, 10),
      match: `${translateTeam(first.matches?.home_team || '')} ${first.matches?.home_score}:${first.matches?.away_score} ${translateTeam(first.matches?.away_team || '')}`, // 队名英→中(保留:兼容旧消费)
      // 结构化对阵(小程序详情页头部渲染国旗 VS,复用赛事 tab 的 flagOf):队名英→中,客户端按中文反查国旗
      home_team: translateTeam(first.matches?.home_team || ''),
      away_team: translateTeam(first.matches?.away_team || ''),
      home_score: first.matches?.home_score ?? null,
      away_score: first.matches?.away_score ?? null,
      highlight_moments: highlightMoments,
      brief_card: buildMatchBriefCard({
        id: first.match_id,
        competition: sanitizeCompetition(first.matches?.competition),
        date: new Date(first.matches?.match_date || '').toISOString().slice(0, 10),
        home_team: first.matches?.home_team,
        away_team: first.matches?.away_team,
        home_score: first.matches?.home_score,
        away_score: first.matches?.away_score,
        stats: first.matches?.stats ?? null,
        events: Array.isArray(first.matches?.events) ? first.matches.events : [],
      }, styles, highlightMoments),
      ...styles,
    }, showHostIntro));
  } catch {
    return internal(rid);
  }
}

function notFound() {
  return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}

function toStyle(r: ReportRow, stats: Record<string, unknown> | null, paid: boolean) {
  // 付费墙:premium 行且未付费 → 锁定。锁定时只下发首段做预览(正文/收尾不泄露),前端渲染"赛事通"付费墙。
  const locked = !!r.is_premium && !paid;
  const body = locked && Array.isArray(r.body) ? r.body.slice(0, 1) : r.body;
  return {
    title: r.title,
    subtitle: r.subtitle,
    lead: r.lead,
    body,
    ending: locked ? '' : addAIGCWatermark(r.ending, 'footer'),
    share_quote: r.share_quote,
    tags: r.tags,
    premium_locked: locked,
    stats,
  };
}

// 付费墙关时同步解锁 mock(本地无 DB 预览):浅克隆受影响文体,勿改共享单例。生产走 DB 路径的 `paid`。
function unlockMockPaywall(report: ReturnType<typeof mockReport>): ReturnType<typeof mockReport> {
  if (REPORT_PAYWALL_ENABLED) return report;
  const out = { ...report };
  for (const k of ['hardcore', 'duanzi', 'emotion'] as const) {
    if (out[k].premium_locked) out[k] = { ...out[k], premium_locked: false };
  }
  return out;
}

function withBriefCard<T extends ReturnType<typeof mockReport>>(report: T) {
  return {
    ...report,
    brief_card: buildMatchBriefCard({
      id: report.id,
      competition: report.competition,
      date: report.date,
      match: report.match,
      stats: report.duanzi.stats,
    }, {
      hardcore: report.hardcore,
      duanzi: report.duanzi,
      emotion: report.emotion,
    }, report.highlight_moments as HighlightMoment[]),
  };
}

async function withExistingHighlightImageUrls(matchId: string, moments: HighlightMoment[]): Promise<HighlightMoment[]> {
  try {
    const storage = getCardStorage();
    return Promise.all(moments.map(async (moment) => {
      const key = buildHighlightImageKey({ matchId, momentId: moment.id });
      const imageUrl = await storage.exists(key);
      return imageUrl ? { ...moment, image_url: imageUrl } : moment;
    }));
  } catch {
    return moments;
  }
}

function withHostIntro<T extends Record<string, unknown>>(data: T, enabled: boolean) {
  if (!enabled) return data;
  return {
    ...data,
    host_intro: '老李赛前 30 秒导读',
  };
}

async function resolveMatchId(db: ReportDetailDb, id: string): Promise<string | null> {
  if (UUID_V4.test(id)) {
    // UUID 既可能是 report.id，也可能是 match.id：小程序从赛事卡进战报传的是 matchId。
    // 旧逻辑只当 report.id 查 → matchId 必落空 → 404（与 F53 card 路由同类，记 F58）。
    // 故先按 report.id；落空则把 id 当 matchId（下方按 match_id 查 reports，不存在则 notFound 兜底）。
    const { data } = await db.from('reports').select('match_id').eq('id', id).maybeSingle();
    return data?.match_id ?? id;
  }
  const { data } = await db.from('matches').select('id').eq('short_code', id).maybeSingle();
  return data?.id ?? null;
}

/**
 * SKU 级权益（6/1 entitlement 模型，decisions/2026-06-01-purchase-monetization-under-getihu.md）：
 *  - deep_report（赛事通 ¥19）：解锁全程所有 premium 战报（含决赛专栏 = 买赛事通免费送）。
 *  - final_column（决赛专栏 ¥9）：仅解锁带 `scenario:final_column` 标记的决赛专栏报告。
 * 决赛专栏以 reports.tags 含 scenario tag 标识（运营发布时打标，与 report-preset/publish 同体例）。
 */
const FINAL_COLUMN_TAG = 'scenario:final_column';

async function successfulSkus(db: ReportDetailDb, userId: string): Promise<Set<string>> {
  const { data } = await db.from('payments').select('sku').eq('user_id', userId).eq('status', 'success');
  return new Set((data ?? []).map((p) => p.sku));
}

function isPremiumUnlocked(skus: Set<string>, reports: ReportRow[]): boolean {
  if (skus.has('deep_report')) return true;
  if (skus.has('final_column') && reports.some((r) => r.tags.includes(FINAL_COLUMN_TAG))) return true;
  return false;
}
