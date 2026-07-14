/**
 * GET /api/card/[reportId]?style=duanzi&platform=wechat
 *
 * 渲染分享卡片 PNG。CDN 激进缓存（max-age=31536000, immutable）。
 *
 * URL 参数：
 * - style:    hardcore | duanzi | emotion
 * - platform: wechat | xhs | x
 *
 * 性能预期：
 * - 首次渲染（冷）：300-500ms
 * - 缓存命中：< 50ms（边缘 CDN）
 *
 * 决赛级流量（每秒 100+ 分享）：
 * - Vercel Functions 自动扩展
 * - 或预渲染热门战报到对象存储（最佳）
 */

import { NextRequest, NextResponse } from 'next/server';
import { renderShareCard, flagUrl, type CardPayload, type Platform } from '@/lib/share-cards';
import { translateTeam } from '@qhs/share-cards';
import type { ReportStyle } from '@/lib/prompts';
import { buildCardKey, CARD_RENDER_CACHE_VERSION, getCardStorage } from '@/lib/api/card-storage';
import { getSupabaseAnon, getSupabaseService, USE_DB } from '@/lib/api/mode';
import { trackServerEvent } from '@/lib/api/tracker';
import { z } from 'zod';
import { firstHighlightMoment } from '@/lib/api/highlight-moments';
import { buildHighlightImageKey } from '@/lib/api/highlight-image';
import { buildMatchBriefCard, buildMatchFtCard, sanitizeCompetition } from '@/lib/api/match-brief-card';
import { fontSafe, compactName } from '@/lib/api/player-name';
import { lookupPlayerZh } from '@/lib/api-football/player-names-zh';
import { externalIdToFixtureId, fetchFixtureLineups, pickFormations, type MatchFormations } from '@/lib/api-football/lineups';

const VALID_STYLES: ReportStyle[] = ['hardcore', 'duanzi', 'emotion'];
const VALID_PLATFORMS: Platform[] = ['wechat', 'xhs', 'x'];
const VALID_VARIANTS = ['report', 'brief', 'ratings', 'ft'] as const;
const Params = z.object({ reportId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/) });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const API_FOOTBALL_LOGO_BASE = 'https://media.api-sports.io/football/teams';

type RatingPlayerRaw = { name?: string; rating?: number | null; position?: string; goals?: number; assists?: number };
type PlayersBlock = {
  motm?: { name?: string; team?: string; rating?: number | null; position?: string };
  home?: RatingPlayerRaw[];
  away?: RatingPlayerRaw[];
};
type CardStats = {
  possession?: { home?: number; away?: number };
  shots?: { home?: number; away?: number };
  shots_on_target?: { home?: number; away?: number };
  xg?: { home?: number | string | null; away?: number | string | null };
  pass_accuracy?: { home?: number; away?: number };
  apiFootball?: { homeTeamId?: number; awayTeamId?: number };
  players?: PlayersBlock;
};

type CardReportRow = {
  id: string;
  match_id?: string | null;
  title: string;
  subtitle: string | null;
  lead?: string | null;
  body: string[];
  share_quote: string;
  style: ReportStyle;
  matches?: CardMatchRow | CardMatchRow[] | null;
};

/** brief 跨风格合成所需的精简 report 行(同一 match 的 hardcore/duanzi/emotion 都要)。 */
type BriefStyleRow = {
  style: ReportStyle;
  title: string;
  lead?: string | null;
  share_quote: string;
};

type CardMatchRow = {
    short_code?: string | null;
    external_id?: string | null;
    competition?: string | null;
    home_team?: string | null;
    away_team?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    match_date?: string | null;
    stats?: CardStats | null;
    events?: unknown;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  }
  const { reportId } = parsed.data;
  const { searchParams } = new URL(req.url);
    const style = (searchParams.get('style') as ReportStyle) || 'duanzi';
  const platform = (searchParams.get('platform') as Platform) || 'wechat';
  const variant = (searchParams.get('variant') || 'report') as typeof VALID_VARIANTS[number];

  if (!VALID_STYLES.includes(style) || !VALID_PLATFORMS.includes(platform) || !VALID_VARIANTS.includes(variant)) {
    return NextResponse.json({ error: 'invalid style, platform or variant' }, { status: 400 });
  }
  if ((variant === 'brief' || variant === 'ratings' || variant === 'ft') && platform !== 'xhs') {
    return NextResponse.json({ error: `${variant} variant only supports xhs platform` }, { status: 400 });
  }

  // inline=1:直返 PNG 字节而非 302 到 CDN。真机 wx.downloadFile 不能可靠跟随跨域 302
  // (F66:战术卡同坑),小程序所有 downloadFile 卡片走 inline。命中缓存则代理 CDN 字节,免重渲染。
  const inline = searchParams.get('inline') === '1';
  // 引流:微信内分享卡右下角叠小程序码。三风格 wechat 默认带码(微信生态安全,无需客户端改)。
  // ⚠️ 红线:站外(小红书/微博)严禁带微信码=限流封号。withQr 一律收敛到 wechat——
  //    即便客户端误传 ?platform=x&qr=1 也不带码(否则会渲出带码的站外图并写进 immutable 缓存)。
  const withQr = platform === 'wechat' && (searchParams.get('qr') === '1' || variant === 'report');
  const storageReportId = await resolveStorageReportId(reportId, style);
  const storage = getCardStorage();
  const baseKey = variant === 'brief'
    ? buildBriefCardKey({ reportId: storageReportId, platform })
    : variant === 'ratings'
      ? buildRatingsCardKey({ reportId: storageReportId, platform })
      : variant === 'ft'
        ? buildFtCardKey({ reportId: storageReportId, platform })
        : buildCardKey({ reportId: storageReportId, style, platform });
  // qr 版独立缓存键,不撞预热的无码卡(预热走 buildCardKey 无 qr 概念)。
  const key = withQr ? baseKey.replace(/\.png$/, '-qr.png') : baseKey;
  if (process.env.CARD_PRERENDER_DISABLE !== '1') {
    const storedUrl = await storage.exists(key);
    if (storedUrl) {
      if (!inline) return NextResponse.redirect(storedUrl, 302);
      // inline 命中缓存:走 COS API 读字节(容器内可达),不要 fetch CDN 域名(hairpin NAT 不可达→必失败→
      // 每次回退重渲染 ~8s,这就是"战报一图看懂每次都慢"的真因)。读不到再落下方重渲染。
      const cachedBytes = await storage.getBytes?.(key);
      if (cachedBytes) {
        return new NextResponse(Buffer.from(cachedBytes), {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
      }
    }
  }

  const payload = await loadReportPayload(storageReportId, style, variant);
  if (!payload) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  try {
    const renderStyle = variant === 'brief' ? 'brief' : variant === 'ratings' ? 'ratings' : variant === 'ft' ? 'ft' : style;
    // F65 结构性堵漏:路由自己把镜头图预取成 data URL 再交给渲染(renderShareCard 对
    // data: 直通)。此前"是否可缓存"只看 payload 里有没有 url,而真实拉取在渲染内部、
    // 失败静默回退——CDN 超时一次就把兜底图卡永久钉进 immutable 缓存(v7 实锅)。
    // 现在:预取失败 → 照常出图给用户,但绝不回填缓存。
    const typedPayload = payload as CardPayload;
    // ratings 卡缺 players(stats.players 未入库)→ 404 NO_DATA + no-store:不渲占位图、不缓存,
    // 小程序据此 binderror 隐藏「球员评分」入口(与战术卡赛前无阵容同策略);数据入库后自然出现。
    if (variant === 'ratings' && !typedPayload.ratingsCard) {
      return NextResponse.json({ error: 'NO_DATA' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    // ratings/ft 卡无镜头图,跳过预取/缓存门;brief 取 lens 图;其余取 highlightMoment 图。
    const expectedImageUrl = variant === 'ratings' || variant === 'ft'
      ? undefined
      : variant === 'brief'
        ? typedPayload.briefCard?.highlight_lens?.image_url
        : typedPayload.highlightMoment?.image_url;
    const prefetched = await prefetchImageAsDataUrl(expectedImageUrl);
    if (typedPayload.briefCard?.highlight_lens) typedPayload.briefCard.highlight_lens.image_url = variant === 'brief' ? prefetched : typedPayload.briefCard.highlight_lens.image_url;
    if (variant === 'report' && typedPayload.highlightMoment) typedPayload.highlightMoment.image_url = prefetched;
    const png = await renderShareCard(renderStyle, platform, payload, { withQr });
    // 镜头位存在但图未就绪/未取到 → 不回填 immutable 缓存,等有图的渲染再缓存。ratings 无图,直接可缓存。
    const momentPresent = variant === 'brief' ? Boolean(typedPayload.briefCard?.highlight_lens) : variant === 'report' ? Boolean(typedPayload.highlightMoment) : false;
    const waitingMomentImage = momentPresent && !prefetched;
    if (process.env.CARD_PRERENDER_DISABLE !== '1' && !waitingMomentImage) {
      try {
        await storage.put(key, png, 'image/png');
      } catch (err) {
        console.warn('[api/card] lazy back-fill failed:', (err as Error).message);
      }
    }
    trackServerEvent(USE_DB ? getSupabaseService() : null, {
      eventId: 'E053',
      properties: { report_id: storageReportId, style, platform, variant, cache_hit: false },
    });
    return new NextResponse(Buffer.from(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[api/card] render fail:', err);
    return NextResponse.json({ error: 'render failed' }, { status: 500 });
  }
}

async function resolveStorageReportId(reportId: string, style: ReportStyle) {
  if (!USE_DB) return reportId;
  const db = getSupabaseAnon();
  if (!db) throw new Error('SUPABASE_ANON_KEY required for card DB load');
  if (UUID_V4.test(reportId)) {
    // UUID 既可能是 report.id，也可能是 match.id：小程序从赛事卡进战报后，分享/存图
    // 用的是 matchId（与 /report/[id] 路由一致——后者认 match_id）。card 路由历史只认
    // report.id（`UUID → return reportId`）→ 从赛事卡分享必 404（F53）。故先按 report.id，
    // 落空再按 match_id 解析到该 style 的 report.id，保持两路由 id 语义对称。
    const { data: asReport } = await db
      .from('reports')
      .select('id')
      .eq('id', reportId)
      .maybeSingle();
    if (asReport?.id) return asReport.id;
    const { data: byMatch } = await db
      .from('reports')
      .select('id')
      .eq('match_id', reportId)
      .eq('style', style)
      .maybeSingle();
    return byMatch?.id || reportId;
  }
  // 非 UUID → 按 short_code 解析（原逻辑）
  const { data: match } = await db
    .from('matches')
    .select('id')
    .eq('short_code', reportId)
    .maybeSingle();
  if (!match?.id) return reportId;
  const { data: report } = await db
    .from('reports')
    .select('id')
    .eq('match_id', match.id)
    .eq('style', style)
    .maybeSingle();
  return report?.id || reportId;
}

/**
 * 占位实现。生产环境应当：
 * - 从 Supabase / 腾讯云 PG 读 reports 表
 * - 同步读 matches 表拿赛事元数据（队伍、比分、stats）
 * - 拼装成 CardPayload
 */
/** 拉官方首发阵型(整合战术图解到 brief);无 external_id / 无阵容 / 拉取失败一律返回 null,brief 照常渲染(降级隐藏球场)。 */
async function loadFormations(row: CardReportRow): Promise<MatchFormations | null> {
  const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
  const externalId = match?.external_id;
  if (!externalId) return null;
  const fixtureId = externalIdToFixtureId(externalId);
  if (fixtureId == null) return null;
  try {
    const teams = await fetchFixtureLineups(fixtureId);
    return pickFormations(teams, match?.stats?.apiFootball?.homeTeamId);
  } catch (err) {
    console.warn('[card/brief] formations fetch failed:', (err as Error).message);
    return null;
  }
}

async function loadReportPayload(reportId: string, style: ReportStyle, variant: typeof VALID_VARIANTS[number]) {
  if (USE_DB) {
    const db = getSupabaseAnon();
    if (!db) throw new Error('SUPABASE_ANON_KEY required for card DB load');
    const { data } = await db
      .from('reports')
      .select('id,match_id,title,subtitle,lead,body,share_quote,style,matches(short_code,external_id,competition,home_team,away_team,home_score,away_score,match_date,stats,events)')
      .eq('id', reportId)
      .maybeSingle();
    if (!data) return null;
    // brief 需同场全部风格 report 才能跨风格合成(F67f);非 brief 不必多查。
    let styleRows: BriefStyleRow[] | undefined;
    let formations: MatchFormations | undefined;
    if (variant === 'brief' && data.match_id) {
      const { data: siblings } = await db
        .from('reports')
        .select('style,title,lead,share_quote')
        .eq('match_id', data.match_id);
      if (siblings && siblings.length) styleRows = siblings as BriefStyleRow[];
      // 战术阵型整合(F67g):brief 一图看懂含官方首发站位。拉阵容失败/无数据不拖垮 brief——降级隐藏球场。
      formations = (await loadFormations(data as CardReportRow)) ?? undefined;
    }
    return rowToCardPayload(data as CardReportRow, variant, styleRows, formations);
  }
  const payload = {
    competition: '国际大赛小组赛',
    date: '2026.06.22',
    homeTeam: '巴西',
    awayTeam: '西班牙',
    homeScore: 2,
    awayScore: 1,
    homeFlagUrl: flagUrl('巴西'),
    awayFlagUrl: flagUrl('西班牙'),
    homePoss: 42,
    awayPoss: 58,
    homeShots: 11,
    awayShots: 14,
    homeShotsOn: 5,
    awayShotsOn: 4,
    homeXG: '1.9',
    awayXG: '1.4',
    homePassAcc: 84,
    awayPassAcc: 89,
    title: getStyleTitle(style),
    subtitle: getStyleSubtitle(style),
    bodyExcerpt: getStyleBody(style),
    shareQuote: getStyleQuote(style),
    brand: getStyleBrand(style),
    shortUrl: `qiuhoushuo.com/m/${reportId}`,
    highlightMoment: {
      title: '巴西把比分写进镜头',
      description: '关键进球 · 禁区前沿的一脚',
    },
  };
  if (variant !== 'brief') return payload;
  return {
    ...payload,
    title: '一图看懂：巴西用效率拆开传控',
    subtitle: '巴西 2:1 西班牙，胜负手落在效率和关键回合。',
    bodyExcerpt: '比分优势守到终场 / 数据解释比赛体感 / 情绪落点清晰',
    shareQuote: '两分钟看懂这场球的重点。',
    brand: '超帧球后说 · 一图看懂 · AI 生成',
    briefCard: {
      title: '一图看懂：巴西用效率拆开传控',
      match_line: '国际大赛小组赛 · 2026.06.22 · 巴西 2:1 西班牙',
      one_sentence_summary: '巴西 2:1 西班牙，胜负手落在效率和关键回合。',
      focus_tags: ['胜负手', '机会质量', '精彩镜头'],
      key_reasons: [
        { title: '巴西把比分优势守到终场', evidence: '比分只有一球差，关键在禁区前沿。' },
        { title: '数据解释比赛体感', evidence: 'xG 1.9:1.4，巴西机会质量更高。' },
        { title: '情绪落点清晰', evidence: '控球不等于控制，射门质量才是答案。' },
      ],
      timeline: [
        { minute: '关键进球', text: '巴西把比分写进镜头' },
        { minute: '压迫时刻', text: '西班牙连续冲击' },
        { minute: '终场前后', text: '终场哨响后的表情' },
      ],
      data_points: [
        { label: 'xG', value: '1.9:1.4', note: '巴西更接近高质量机会' },
        { label: '射门', value: '11:14', note: '西班牙制造了更多尝试' },
        { label: '射正', value: '5:4', note: '巴西更常打到门框范围' },
        { label: '控球', value: '42:58', note: '西班牙掌握更多球权' },
      ],
      highlight_lens: {
        title: '巴西把比分写进镜头',
        caption: '关键进球 · 禁区前沿的一脚',
      },
      share_line: '两分钟看懂这场球的重点。',
      integrity_note: 'AI 生成内容，基于比分、战报与可用技术统计整理。',
    },
  };
}

async function rowToCardPayload(row: CardReportRow, variant: typeof VALID_VARIANTS[number], styleRows?: BriefStyleRow[], formations?: MatchFormations): Promise<CardPayload> {
  const match = Array.isArray(row.matches) ? row.matches[0] ?? {} : row.matches || {};
  const stats = match.stats || {};
  const highlightMoment = firstHighlightMoment(match, stats, Array.isArray(match.events) ? match.events : null);
  const matchId = row.match_id || row.id;
  const highlightImageUrl = await existingHighlightImageUrl(matchId, highlightMoment.id);
  const momentWithImage = highlightImageUrl
    ? { ...highlightMoment, image_url: highlightImageUrl }
    : highlightMoment;
  const basePayload: CardPayload = {
    competition: sanitizeCompetition(match.competition),
    date: String(match.match_date || '').slice(0, 10).replaceAll('-', '.'),
    homeTeam: translateTeam(match.home_team || ''),
    awayTeam: translateTeam(match.away_team || ''),
    homeScore: match.home_score ?? 0,
    awayScore: match.away_score ?? 0,
    homePoss: stats.possession?.home,
    awayPoss: stats.possession?.away,
    homeShots: stats.shots?.home,
    awayShots: stats.shots?.away,
    homeShotsOn: stats.shots_on_target?.home,
    awayShotsOn: stats.shots_on_target?.away,
    homeXG: stats.xg?.home == null ? undefined : String(stats.xg.home),
    awayXG: stats.xg?.away == null ? undefined : String(stats.xg.away),
    homePassAcc: stats.pass_accuracy?.home,
    awayPassAcc: stats.pass_accuracy?.away,
    homeLogoUrl: stats.apiFootball?.homeTeamId
      ? `${API_FOOTBALL_LOGO_BASE}/${stats.apiFootball.homeTeamId}.png`
      : undefined,
    awayLogoUrl: stats.apiFootball?.awayTeamId
      ? `${API_FOOTBALL_LOGO_BASE}/${stats.apiFootball.awayTeamId}.png`
      : undefined,
    // 一图看懂头部国旗(复用赛事/战报同一套图):用原始英文队名解析国旗码
    homeFlagUrl: flagUrl(match.home_team),
    awayFlagUrl: flagUrl(match.away_team),
    title: row.title,
    subtitle: row.subtitle ?? '',
    bodyExcerpt: Array.isArray(row.body) ? row.body[0] ?? '' : '',
    shareQuote: row.share_quote,
    brand: '超帧球后说 · AI 生成',
    shortUrl: `qiuhoushuo.com/m/${match.short_code || row.id}`,
    highlightMoment: momentWithImage,
  };
  if (variant === 'ratings') {
    return { ...basePayload, ratingsCard: buildRatingsCard(match), brand: '超帧球后说 · 球员评分 · AI 生成' };
  }
  if (variant === 'ft') {
    // 官方战报风:结构化事实卡(比分进程/进球者/数据条),quote 用本 style 的 share_quote(默认 duanzi 拉取)
    const ftCard = buildMatchFtCard({
      id: matchId,
      competition: match.competition,
      date: String(match.match_date || '').slice(0, 10),
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: match.home_score,
      away_score: match.away_score,
      stats,
      events: Array.isArray(match.events) ? match.events : [],
    }, { matchDateIso: match.match_date ? String(match.match_date) : undefined, shareQuote: row.share_quote });
    return { ...basePayload, ftCard, brand: '超帧球后说 · 官方战报风 · AI 生成' };
  }
  if (variant !== 'brief') return basePayload;
  // brief 跨风格合成:标题取 hardcore/duanzi、tacticalReason 取 hardcore lead、emotionalReason 取 emotion lead…
  // 只传请求命中的单 style 会让另两路全回落默认文案(F67f:emotion lead 在场却显示"情绪落点"默认短句)。
  // 故喂同场全部风格 report(styleRows 由 loadReportPayload 一次性查出);无 styleRows 时退化为单行(mock/旧路径)。
  const rowsForBrief: BriefStyleRow[] = styleRows && styleRows.length
    ? styleRows
    : [{ style: row.style, title: row.title, lead: row.lead, share_quote: row.share_quote }];
  const briefStyles: Partial<Record<ReportStyle, { title: string; lead?: string; share_quote: string; stats: typeof stats }>> = {};
  for (const r of rowsForBrief) {
    briefStyles[r.style] = { title: r.title, lead: r.lead ?? undefined, share_quote: r.share_quote, stats };
  }
  const briefCard = buildMatchBriefCard({
    id: matchId,
    competition: sanitizeCompetition(match.competition),
    date: String(match.match_date || '').slice(0, 10),
    home_team: match.home_team,
    away_team: match.away_team,
    home_score: match.home_score,
    away_score: match.away_score,
    stats,
    events: Array.isArray(match.events) ? match.events : [],
  }, briefStyles, [momentWithImage]);
  if (formations) {
    briefCard.formation = { home: formations.homeFormation, away: formations.awayFormation };
  }
  return {
    ...basePayload,
    title: briefCard.title,
    subtitle: briefCard.one_sentence_summary,
    bodyExcerpt: briefCard.key_reasons.map((reason) => reason.title).join(' / '),
    shareQuote: briefCard.share_line,
    brand: '超帧球后说 · 一图看懂 · AI 生成',
    briefCard,
    highlightMoment: briefCard.highlight_lens
      ? {
          title: briefCard.highlight_lens.title,
          description: briefCard.highlight_lens.caption,
          image_url: briefCard.highlight_lens.image_url,
        }
      : basePayload.highlightMoment,
  };
}

/** 镜头图预取(15s 上限);失败返回 undefined,由调用方决定降级与缓存策略。 */
async function prefetchImageAsDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:image/')) return url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    const contentType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!contentType.startsWith('image/')) return undefined;
    return `data:${contentType};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch (err) {
    console.warn('[api/card] moment image prefetch failed:', (err as Error).message);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildBriefCardKey(k: { reportId: string; platform: Platform }): string {
  const safeReportId = encodeURIComponent(k.reportId).replace(/%2F/gi, '');
  return `cards/${CARD_RENDER_CACHE_VERSION}/${safeReportId}/brief-full-${k.platform}.png`;
}

function buildRatingsCardKey(k: { reportId: string; platform: Platform }): string {
  const safeReportId = encodeURIComponent(k.reportId).replace(/%2F/gi, '');
  return `cards/${CARD_RENDER_CACHE_VERSION}/${safeReportId}/ratings-full-${k.platform}.png`;
}

function buildFtCardKey(k: { reportId: string; platform: Platform }): string {
  const safeReportId = encodeURIComponent(k.reportId).replace(/%2F/gi, '');
  return `cards/${CARD_RENDER_CACHE_VERSION}/${safeReportId}/ft-full-${k.platform}.png`;
}

/** stats.players → 球员评分卡 payload(队名英→中、赛事名脱敏;球员名 fontSafe 转写,模板内裁剪)。无 players 返 undefined。 */
function buildRatingsCard(match: CardMatchRow): CardPayload['ratingsCard'] {
  const players = match.stats?.players;
  if (!players) return undefined;
  const homeTeam = translateTeam(match.home_team || '');
  const awayTeam = translateTeam(match.away_team || '');
  // 名字优先中文译名(lookupPlayerZh,易懂且短);查不到回退 compactName(fontSafe 去豆腐块 + 控长)。
  const toP = (l: RatingPlayerRaw) => ({ name: lookupPlayerZh(l.name || '') ?? compactName(l.name || '', 16), rating: l.rating ?? null, position: l.position || '', goals: l.goals ?? 0, assists: l.assists ?? 0 });
  const motm = players.motm && players.motm.name && players.motm.rating != null
    ? { name: lookupPlayerZh(players.motm.name) ?? compactName(players.motm.name, 20), team: translateTeam(players.motm.team || ''), rating: players.motm.rating, position: players.motm.position || '' }
    : undefined;
  return {
    match_line: `${sanitizeCompetition(match.competition)} · ${homeTeam} ${match.home_score ?? 0}:${match.away_score ?? 0} ${awayTeam}`.replace(/^\s*·\s*/, ''),
    motm,
    home: { team: homeTeam, players: (players.home ?? []).map(toP) },
    away: { team: awayTeam, players: (players.away ?? []).map(toP) },
    note: '球员评分为第三方数据源算法值 · AI 生成内容整理',
  };
}

async function existingHighlightImageUrl(matchId: string, momentId: string): Promise<string | undefined> {
  try {
    const key = buildHighlightImageKey({ matchId, momentId });
    return (await getCardStorage().exists(key)) ?? undefined;
  } catch (err) {
    console.warn('[api/card] highlight image lookup failed:', (err as Error).message);
    return undefined;
  }
}

function getStyleTitle(s: ReportStyle) {
  return {
    hardcore: '传控大师败给了 xG 效率',
    duanzi: '巴西 2:1 西班牙：传控大师败给了打不死的小强',
    emotion: '19 岁的西班牙新人，输了一场赢得很久的比赛',
  }[s];
}
function getStyleSubtitle(s: ReportStyle) {
  return {
    hardcore: '巴西用 11 次射门换 1.9 xG',
    duanzi: '',
    emotion: '维尼修斯的烟花之外，还有一个少年的 0.3 秒',
  }[s];
}
function getStyleBody(s: ReportStyle) {
  return {
    hardcore: '',
    duanzi: '维尼修斯今晚的过人就像我老板让我加班——你以为你能拒绝，但其实你拒绝不了。',
    emotion: '我看着他在终场哨响后没站起来。我想到的不是他刚刚的解围，是 4 年后。4 年后他 23 岁。',
  }[s];
}
function getStyleQuote(s: ReportStyle) {
  return {
    hardcore: 'xG 1.9 vs 1.4，比分公平，叙事不公平。',
    duanzi: '西班牙赢了控球率，输给了想象力。',
    emotion: '他没救得了比赛，救得了 19 岁的自己。',
  }[s];
}
function getStyleBrand(s: ReportStyle) {
  return {
    hardcore: '超帧球后说 · AI 生成',
    duanzi: '超帧球后说 · AI 生成',
    emotion: '超帧球后说 · AI 生成',
  }[s];
}
