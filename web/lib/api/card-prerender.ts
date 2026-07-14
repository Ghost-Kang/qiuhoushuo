import type { ReportStyle } from '@/lib/prompts';
import type { GeneratedReport } from '@/lib/report';
import { renderShareCard, flagUrl, type CardPayload, type Platform } from '@/lib/share-cards';
import { notifyOpsFireAndForget } from '@/lib/alerts';
import { buildCardKey, getCardStorage, type CardStorageClient } from './card-storage';
import { getSupabaseService } from './mode';
import { trackServerEvent } from './tracker';
import { firstHighlightMoment } from './highlight-moments';
import { buildHighlightImageKey } from './highlight-image';
import { sanitizeCompetition } from './match-brief-card';
import { translateTeam } from '@qhs/share-cards';

const STYLES: ReportStyle[] = ['hardcore', 'duanzi', 'emotion'];
const PLATFORMS: Platform[] = ['wechat', 'xhs', 'x'];

type ReportMap = Record<ReportStyle, GeneratedReport>;
type ReportIdRow = { id: string; style: ReportStyle };
type MatchStats = {
  possession?: { home?: number; away?: number };
  shots?: { home?: number; away?: number };
  shots_on_target?: { home?: number; away?: number };
  xg?: { home?: number | string | null; away?: number | string | null };
  pass_accuracy?: { home?: number; away?: number };
};
type MatchRow = {
  short_code?: string | null;
  competition: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  match_date: string;
  stats?: MatchStats | null;
};

export async function prerenderCardsForReport(
  matchId: string,
  reports: ReportMap,
  storage: CardStorageClient = getCardStorage(),
) {
  try {
    const db = getSupabaseService();
    if (!db) return;
    const { data: match } = await db
      .from('matches')
      .select('short_code,competition,home_team,away_team,home_score,away_score,match_date,stats')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) {
      notifyOpsFireAndForget(
        {
          severity: 'P1',
          title: 'card 预生成跳过',
          body: `matchId=${matchId}\nreason=match not found`,
          tags: ['card-prerender'],
        },
        {
          dedupKey: `card-prerender-missing:${matchId}`,
          dedupWindowMs: 15 * 60 * 1000,
        },
      );
      return;
    }

    const { data: reportRows } = await db.from('reports').select('id,style').eq('match_id', matchId);
    const reportIds = new Map((reportRows ?? []).map((row: ReportIdRow) => [row.style, row.id]));
    let okCount = 0;
    let failCount = 0;
    for (const style of STYLES) {
      const payload = await toCardPayload(matchId, match, reports[style], storage);
      for (const platform of PLATFORMS) {
        try {
          const baseKey = buildCardKey({ reportId: String(reportIds.get(style) || matchId), style, platform });
          const png = await renderShareCard(style, platform, payload);
          await storage.put(baseKey, png, 'image/png');
          okCount += 1;
          // 微信卡额外预热「带小程序码版」(-qr 键):/api/card 路由对 wechat 取此键引流。
          // 不预热此版,完赛后首个分享微信卡的用户会撞 ~17s 冷渲染。站外(xhs/x)不带码,无需此版。
          if (platform === 'wechat') {
            const pngQr = await renderShareCard(style, platform, payload, { withQr: true });
            await storage.put(baseKey.replace(/\.png$/, '-qr.png'), pngQr, 'image/png');
            okCount += 1;
          }
        } catch (err) {
          failCount += 1;
          console.warn('[api/report] card prerender failed:', style, platform, (err as Error).message);
        }
      }
    }

    // 预热"一图看懂"(brief 变体):report 卡预渲染只覆盖 report 变体,brief 此前从不预渲染→
    // 用户首次看战报必撞冷渲染(~5~7s,易超 downloadFile 超时→缺图,6/13 韩国/捷克即此)。
    // 自调用按需 /api/card?variant=brief 令其渲染落缓存(复用同一渲染+存储逻辑,不重复构建 brief 载荷)。
    await warmBriefCard(matchId);

    notifyOpsFireAndForget(
      {
        severity: okCount === 0 ? 'P1' : 'P2',
        title: okCount === 0 ? 'card 预生成全部失败' : 'card 预生成完成',
        body: `matchId=${matchId}\nok=${okCount}\nfail=${failCount}`,
        tags: ['card-prerender'],
      },
      {
        dedupKey: `card-prerender-done:${matchId}:${okCount === 0 ? 'fail' : 'ok'}`,
        dedupWindowMs: 15 * 60 * 1000,
      },
    );
    trackServerEvent(db, { eventId: 'E051', properties: { match_id: matchId, ok_count: okCount, fail_count: failCount } });
  } catch (err) {
    console.warn('[api/report] card prerender batch failed:', (err as Error).message);
  }
}

// 预热一图看懂:自调用按需 /api/card brief 端点令其渲染并落 COS 缓存。仅在配了站点 URL 时执行
// (dev/test 无 NEXT_PUBLIC_SITE_URL → 跳过,按需渲染兜底)。best-effort:失败不影响主流程(用户首看时
// 仍可按需渲染,只是慢一次)。25s 超时上限防卡住。
export async function warmBriefCard(matchId: string): Promise<void> {
  // 仅生产自调用(dev/test 跳过,按需渲染兜底)。用容器内回环 127.0.0.1:3000——
  // 公网域名在容器内不可达(hairpin NAT,实测 fetch failed);web 服务监听 3000(Dockerfile)。
  if (process.env.NODE_ENV !== 'production') return;
  const url = `http://127.0.0.1:3000/api/card/${matchId}?style=duanzi&platform=xhs&variant=brief&inline=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) console.warn('[card-prerender] brief warm non-ok:', res.status, matchId);
  } catch (err) {
    console.warn('[card-prerender] brief warm failed:', (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

const PREWARM_PLATFORMS: Platform[] = ['wechat', 'xhs', 'x'];

/**
 * 预热某场「所有可下载卡」——9 张分享卡(三风格×三平台:朋友圈/小红书/微博) + 一图看懂 + 战术图,
 * 让用户点「存…图」时即命中缓存秒出(而非首次冷渲染 ~几秒)。
 * 幂等:已有当前版本 duanzi-xhs 卡即视为已预热,直接跳过(省渲染/COS;缓存升版后该卡缺→会重热)。
 * 仅生产自调用(容器内回环 127.0.0.1:3000;dev/test 跳过,按需渲染兜底)。每张 25s 超时。
 */
export async function prewarmCardsForMatch(matchId: string, storage: CardStorageClient = getCardStorage()): Promise<{ warmed: number; skipped?: string }> {
  if (process.env.NODE_ENV !== 'production') return { warmed: 0, skipped: 'non-prod' };
  const db = getSupabaseService();
  if (!db) return { warmed: 0, skipped: 'no-db' };
  const { data: rows } = await db.from('reports').select('id,style').eq('match_id', matchId);
  const list = (rows ?? []) as ReportIdRow[];
  const first = list[0];
  if (!first) return { warmed: 0, skipped: 'no-report' };
  const duanziId = (list.find((r) => r.style === 'duanzi') ?? first).id;
  // 闸:已预热(duanzi-xhs 当前版本存在)→ 跳过,幂等
  if (await storage.exists(buildCardKey({ reportId: String(duanziId), style: 'duanzi', platform: 'xhs' }))) {
    return { warmed: 0, skipped: 'already-warm' };
  }
  const base = 'http://127.0.0.1:3000/api/card';
  const urls: string[] = [];
  for (const style of STYLES) {
    for (const platform of PREWARM_PLATFORMS) urls.push(`${base}/${matchId}?style=${style}&platform=${platform}&inline=1`);
  }
  urls.push(`${base}/${matchId}?style=duanzi&platform=xhs&variant=brief&inline=1`); // 一图看懂
  urls.push(`${base}/${matchId}?style=duanzi&platform=xhs&variant=ratings&inline=1`); // 球员评分(缺 players 时路由不缓存,见 route.ts ratingsEmpty)
  urls.push(`${base}/tactics/${matchId}?inline=1`); // 战术图解(独立路由)
  let warmed = 0;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) warmed += 1;
    } catch (err) {
      console.warn('[prewarm] card warm failed:', url, (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
  return { warmed };
}

async function toCardPayload(
  matchId: string,
  match: MatchRow,
  report: GeneratedReport,
  storage: CardStorageClient,
): Promise<CardPayload> {
  const stats = match.stats || {};
  const highlightMoment = firstHighlightMoment(match, stats);
  const highlightImageUrl = await existingHighlightImageUrl(storage, matchId, highlightMoment.id);
  return {
    competition: sanitizeCompetition(match.competition), // 合规:预渲染卡也脱敏,与按需 /api/card 一致
    date: String(match.match_date || '').slice(0, 10).replaceAll('-', '.'),
    homeTeam: translateTeam(match.home_team),
    awayTeam: translateTeam(match.away_team),
    homeScore: match.home_score,
    awayScore: match.away_score,
    // 一图看懂头部国旗(复用赛事/战报同一套图):用原始英文队名解析国旗码
    homeFlagUrl: flagUrl(match.home_team),
    awayFlagUrl: flagUrl(match.away_team),
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
    title: report.title,
    subtitle: report.subtitle ?? '',
    bodyExcerpt: Array.isArray(report.body) ? report.body[0] ?? '' : '',
    shareQuote: report.share_quote,
    brand: '超帧球后说 · AI 生成',
    shortUrl: `qiuhoushuo.com/m/${match.short_code || matchId}`,
    highlightMoment: highlightImageUrl
      ? { ...highlightMoment, image_url: highlightImageUrl }
      : highlightMoment,
  };
}

async function existingHighlightImageUrl(
  storage: CardStorageClient,
  matchId: string,
  momentId: string,
): Promise<string | undefined> {
  try {
    const key = buildHighlightImageKey({ matchId, momentId });
    return (await storage.exists(key)) ?? undefined;
  } catch (err) {
    console.warn('[api/report] highlight image lookup failed during card prerender:', (err as Error).message);
    return undefined;
  }
}
