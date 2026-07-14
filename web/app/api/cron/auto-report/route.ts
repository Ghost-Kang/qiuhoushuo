/**
 * GET /api/cron/auto-report — 自动报战报触发器（架构审视 R5）。
 *
 * 调度器（Vercel cron / 腾讯云 SCF，ADMIN_API_SECRET 鉴权）每 5 分钟轮询：
 * 找出 status=finished 且尚无战报的比赛，从 matches 行组装 MatchData 触发 3 风格生成。
 * 把"赛果→战报"的触发点从人肉 curl 变成自动化（决赛单场仍以 RUNBOOK 预生成 + 手动为主）。
 */

import { notifyOpsFireAndForget } from '@/lib/alerts';
import { enrichMatchWithEvents, enrichMatchWithStats, enrichMatchWithPlayers, findFinishedMatches, findReportableMatches, generateMissingHighlightImages, isPenShootoutPending, matchRowToMatchData, type HighlightImagesResult, type ReportableDb } from '@/lib/api/auto-report';
import { getCardStorage } from '@/lib/api/card-storage';
import { prewarmLeaderboards } from '@/lib/api/leaderboard-prewarm';
import { prerenderCardsForReport, prewarmCardsForMatch } from '@/lib/api/card-prerender';
import { createHighlightImageProviderFromEnv } from '@/lib/api/highlight-image';
import { fetchFixtureEvents } from '@/lib/api-football/events';
import { fetchFixtureStatistics } from '@/lib/api-football/statistics';
import { fetchFixturePlayers } from '@/lib/api-football/player-stats';
import { externalIdToFixtureId } from '@/lib/api-football/lineups';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { generateAllStylesWithPersist, type ReportPersistClient } from '@/lib/report';
import { TMPL_REPORT_READY, buildReportReadyData, pageForKind, pushPendingForMatch, type SubsDb } from '@/lib/api/wx-subscribe';
import { publishAllStyles, buildDraftPushedAlert, type MpDraftDb } from '@/lib/api/mp-draft-publish';
import { loadSocialFactsFromDb, generateSocialFromFacts, buildSocialAlert, socialAutoGenEnabled, pushMatchCardImagesToWecom, pushFanPortraitSamplesToWecom, pushCostarShowcaseToWecom, PLATFORM_IDS, PLATFORMS, type SocialDb } from '@/lib/api/social-content';
import { fanPortraitEnabled } from '@/lib/api/fan-portrait';
import type { CardStorageClient } from '@/lib/api/card-storage';
import { triggerLaoliVideoFireAndForget } from '@/lib/api/laoli-video-trigger';

export const maxDuration = 60;

/** 卡片预热回填每轮上限(防一次性渲染过多;余下场次后续轮次继续补,幂等)。 */
const CARD_PREWARM_PER_RUN = 5;

/**
 * 战报+卡就绪后,自动把三版(战术/好笑/追剧)推成服务号草稿,并给管理员发一条汇总提醒。
 * 必须串在 prerenderCardsForReport 之后:草稿封面取的就是 warmBriefCard 落缓存的「一图看懂」PNG,先于它推会缺封面。
 * 由 MP_DRAFT_AUTO_PUSH 兜底开关控制(缺省关,便于随时停;不开则全程不碰微信)。
 * 草稿末尾球迷形象与手动 all 一致,按 MP_DRAFT_FAN_PORTRAIT 门控(开则附主/客两张)。
 * best-effort:本函数永不抛(异常自行转成 P1 提醒),绝不拖垮战报主链路。
 */
async function autoPushMpDrafts(db: MpDraftDb, storage: CardStorageClient, matchId: string): Promise<void> {
  const flag = process.env.MP_DRAFT_AUTO_PUSH;
  if (flag !== '1' && flag !== 'true') return;
  try {
    const summary = await publishAllStyles(db, storage, matchId, { fanPortrait: { enabled: fanPortraitEnabled() } });
    if (summary) notifyOpsFireAndForget(buildDraftPushedAlert(summary));
  } catch (e) {
    notifyOpsFireAndForget(
      { severity: 'P1', title: '公众号草稿自动推送异常', body: `match=${matchId}\n${(e as Error).message}`, tags: ['mp-draft'] },
      { dedupKey: `mp-draft-auto:${matchId}`, dedupWindowMs: 10 * 60 * 1000 },
    );
  }
}

/**
 * 战报+卡就绪后,对每个开启的社媒平台(小红书/抖音/视频号)各自动生成一份内容
 * (各 ≥3 条:小红书图文笔记 / 抖音·视频号短视频脚本 + 球迷写真),写到「比赛文件夹/<平台>/」
 * + notifyOps 企微每平台推一条(首条全文 + 文件夹路径 + 配图)。
 * 各平台由 XHS_AUTO_GEN / DOUYIN_AUTO_GEN / CHANNELS_AUTO_GEN 分别门控(缺省关)。
 * best-effort:facts 取一次复用,逐平台独立兜底,永不抛,绝不拖战报主链路。
 */
async function autoGenSocialContent(db: SocialDb, matchId: string): Promise<void> {
  const enabled = PLATFORM_IDS.filter(socialAutoGenEnabled);
  if (enabled.length === 0) return;
  const facts = await loadSocialFactsFromDb(db, matchId);
  if (!facts) return;
  for (const platform of enabled) {
    try {
      const res = await generateSocialFromFacts(facts, platform);
      notifyOpsFireAndForget(buildSocialAlert(PLATFORMS[platform], res.bundle, res.dir, res.archived));
    } catch (e) {
      notifyOpsFireAndForget(
        { severity: 'P1', title: `${PLATFORMS[platform].name}内容自动生成异常`, body: `match=${matchId}\n${(e as Error).message}`, tags: ['social', platform] },
        { dedupKey: `social-${platform}:${matchId}`, dedupWindowMs: 10 * 60 * 1000 },
      );
    }
  }
  // 卡是比赛级(各平台共用)→ 按场推一次「一图看懂+数据卡」图片到企微(手机长按即存),不随平台数翻倍。
  await pushMatchCardImagesToWecom(matchId).catch(() => {});
  await pushFanPortraitSamplesToWecom(facts).catch(() => {}); // 球迷形象示例图(门控 SOCIAL_FAN_PORTRAIT)
  await pushCostarShowcaseToWecom(facts).catch(() => {}); // 球星合影引流图(门控 SOCIAL_COSTAR_SHOWCASE·founder 拍板·带 costar 护栏)
}

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!USE_DB) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  // ?sinceHours=N（1-48，默认 6）：cron 中断后的运维回填口——6/12 实测:crontab 当日才装,
  // 揭幕战(开球 19:00Z)在首次轮询时已滑出 6h 窗口,scanned=0 → 永远不会有战报。
  const sinceHours = parseSinceHours(new URL(req.url).searchParams.get('sinceHours'));
  if (sinceHours === null) return Response.json({ error: 'invalid_sinceHours' }, { status: 400 });
  // ?refetchEvents=1:解析器升级(新增 VAR/点球射失等争议事件)后,对已有战报的老比赛强制重拉 events。一次性运维口。
  const refetchEvents = new URL(req.url).searchParams.get('refetchEvents') === '1';
  // ?refetchPlayers=1:对已有 stats.players 的老比赛强制重拉球员评分(评分逻辑/字段升级时用)。
  const refetchPlayers = new URL(req.url).searchParams.get('refetchPlayers') === '1';
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const targets = await findReportableMatches(db as unknown as ReportableDb, sinceIso, 20);

  const results: Array<{ matchId: string; persisted: boolean; images?: HighlightImagesResult; error?: string }> = [];
  for (const target of targets) {
    try {
      // F63:先补真实赛事事件(进球者/分钟),战报 LLM 与镜头 prompt 都以真实发生为底
      let withEvents = await enrichMatchWithEvents(
        db as unknown as ReportableDb,
        target,
        fetchFixtureEvents,
        externalIdToFixtureId,
        target.external_id,
      );
      // 点球大战门:PEN 完赛但逐轮点球未落库 → 强制重拉一次(幂等跳过挡不住"事件已有但缺点球"),
      // 仍缺则本轮跳过——比赛留在 reportable 窗口,5 分钟后下轮 cron 再试。
      // 没这道门,LLM 只见 1:1 会猜晋级方(澳埃战写成「澳大利亚点球晋级」,实际埃及 4:2)。
      if (isPenShootoutPending(withEvents)) {
        withEvents = await enrichMatchWithEvents(
          db as unknown as ReportableDb,
          target,
          fetchFixtureEvents,
          externalIdToFixtureId,
          target.external_id,
          true,
        );
        if (isPenShootoutPending(withEvents)) {
          results.push({ matchId: target.id, persisted: false, error: 'pen_shootout_events_pending' });
          continue;
        }
      }
      // 再补真实技术统计(控球/射门/角球…)落 matches.stats → 一图看懂「数据证据」有料、战报 prompt 更实
      const withStats = await enrichMatchWithStats(
        db as unknown as ReportableDb,
        withEvents,
        fetchFixtureStatistics,
        externalIdToFixtureId,
        withEvents.external_id,
      );
      // 再补球员评分落 stats.players → 一图看懂「全场最佳」+ 球员评分卡
      const m = await enrichMatchWithPlayers(
        db as unknown as ReportableDb,
        withStats,
        fetchFixturePlayers,
        externalIdToFixtureId,
        withStats.external_id,
      );
      // F62+缓存时序:镜头图先于战报——战报落库后用户立刻分享,分享卡渲染时图必须已就位
      const images = await generateMissingHighlightImages(m, {
        provider: createHighlightImageProviderFromEnv(),
        storage: getCardStorage(),
      });
      const result = await generateAllStylesWithPersist(db as unknown as ReportPersistClient, m.id, matchRowToMatchData(m));
      trackServerEventGlobal({
        eventId: 'E040',
        properties: { match_id: m.id, trigger: 'auto-cron', persisted: result.persisted, highlight_images: images },
      });
      // cron 此前从不预渲染卡(只有 /api/report 路由调) → cron 生成的比赛 report 卡 + 一图看懂首看必冷渲染。
      // 落库成功后预渲染(report 卡 9 张 + 预热 brief),用户首看即命中缓存。fire-and-forget 不拖 cron 时长。
      if (result.persisted) {
        triggerLaoliVideoFireAndForget(m.id);
        const storage = getCardStorage();
        // 预渲染卡(含一图看懂封面)→ 完成后自动把三版推到公众号草稿箱 + 通知管理员。
        // 串在 prerender 之后:草稿封面取的就是 warmBriefCard 落缓存的「一图看懂」PNG,先推会缺封面。fire-and-forget 不拖 cron。
        void prerenderCardsForReport(m.id, result.reports, storage)
          .then(() => autoPushMpDrafts(db as unknown as MpDraftDb, storage, m.id))
          .then(() => autoGenSocialContent(db as unknown as SocialDb, m.id))
          .catch((e) => console.warn('[auto-report] prerender→mp-draft→social chain fail:', (e as Error).message));
        // 战报就绪 → 推订阅了本场 report_ready 的用户(fire-and-forget,best-effort;推送失败绝不拖垮战报生成)
        void pushPendingForMatch(db as unknown as SubsDb, {
          matchId: m.id,
          kind: 'report_ready',
          templateId: TMPL_REPORT_READY,
          page: pageForKind('report_ready', m.id),
          data: buildReportReadyData(m, result.reports?.duanzi?.title || ''),
        }).catch((e) => console.warn('[auto-report] report_ready push fail:', (e as Error).message));
      }
      results.push({ matchId: m.id, persisted: result.persisted, images });
    } catch (err) {
      const message = (err as Error).message;
      notifyOpsFireAndForget(
        { severity: 'P1', title: 'auto-report 单场生成失败', body: `match=${target.id}\n${message}`, tags: ['cron-failure', 'auto-report'] },
        { dedupKey: `auto-report:${target.id}`, dedupWindowMs: 5 * 60 * 1000 },
      );
      results.push({ matchId: target.id, persisted: false, error: message });
    }
  }

  // 镜头图补全 pass(F67d):report 与 image 解耦。已完赛但缺图的比赛(尤其"战报先生成、图当时失败"的,
  // 它们已不在 reportable 窗口里)在此幂等补图——generateMissingHighlightImages 内部 storage.exists 命中即跳过,
  // 已有图零成本(仅 COS HEAD)。上面 targets 已处理过的跳过,不重复生成。
  const processedIds = new Set(targets.map((t) => t.id));
  const backfilled: Array<{ matchId: string; images: HighlightImagesResult }> = [];
  const finished = await findFinishedMatches(db as unknown as ReportableDb, sinceIso, 100);
  for (const fm of finished) {
    if (processedIds.has(fm.id)) continue;
    try {
      // ?refetchEvents=1:对老比赛强制重拉 events(解析器升级后捞 VAR/点球射失等争议事件)。
      const withEvents = refetchEvents
        ? await enrichMatchWithEvents(db as unknown as ReportableDb, fm, fetchFixtureEvents, externalIdToFixtureId, fm.external_id, true)
        : fm;
      // 已出战报的老比赛也在此幂等补技术统计(数据证据数据源)——主 reportable 循环不含它们。
      // 落库后下方卡片预热会以新 stats 在当前缓存键重渲染一图看懂,老比赛的数据证据即补齐。
      const withStats = await enrichMatchWithStats(
        db as unknown as ReportableDb,
        withEvents,
        fetchFixtureStatistics,
        externalIdToFixtureId,
        withEvents.external_id,
      );
      // 球员评分(全场最佳 + 评分卡数据源):老比赛也在此补;refetchPlayers 时强制重拉
      const enriched = await enrichMatchWithPlayers(
        db as unknown as ReportableDb,
        withStats,
        fetchFixturePlayers,
        externalIdToFixtureId,
        withStats.external_id,
        refetchPlayers,
      );
      const images = await generateMissingHighlightImages(enriched, {
        provider: createHighlightImageProviderFromEnv(),
        storage: getCardStorage(),
      });
      if (images.generated > 0) {
        trackServerEventGlobal({
          eventId: 'E040',
          properties: { match_id: fm.id, trigger: 'image-backfill', highlight_images: images },
        });
        backfilled.push({ matchId: fm.id, images });
      }
    } catch (err) {
      console.warn(`[cron] highlight image backfill fail match=${fm.id}:`, (err as Error).message);
    }
  }

  // 卡片预热回填:已完赛但下载卡未预热(或缓存升版失效)的比赛,后台补渲染所有可下载卡
  // (9 风格×平台分享卡 + 一图看懂 + 战术图),用户点「存…图」即命中缓存秒出。幂等(已预热则 exists 跳过);
  // 每轮最多预热 CARD_PREWARM_PER_RUN 场防一次性洪峰,余下场次后续轮次继续补。fire-and-forget 不拖 cron 响应。
  void (async () => {
    let warmedMatches = 0;
    for (const fm of finished) {
      if (warmedMatches >= CARD_PREWARM_PER_RUN) break;
      try {
        const res = await prewarmCardsForMatch(fm.id, getCardStorage());
        if (res.warmed > 0) warmedMatches += 1;
      } catch (e) {
        console.warn(`[cron] card prewarm fail match=${fm.id}:`, (e as Error).message);
      }
    }
  })().catch(() => {});

  // 事件驱动刷新榜单:本轮有新完赛场次(已从三方 API 取到比分/进球/晋级数据并入库)→ 立刻重渲
  // 射手榜/助攻榜(scoreboard)+ 淘汰赛对阵图(bracket)+ 积分榜。不再每小时空跑;无完赛则不刷。
  // fire-and-forget,best-effort,不拖 cron 响应。详见 leaderboard-prewarm.prewarmLeaderboards。
  if (targets.length > 0) {
    void prewarmLeaderboards(getCardStorage()).catch((e) => console.warn('[cron] 完赛后刷新榜单失败:', (e as Error).message));
  }

  return Response.json({
    ok: true,
    scanned: targets.length,
    triggered: results.filter((r) => r.persisted).length,
    leaderboards_refreshed: targets.length > 0,
    results,
    image_backfill: { scanned: finished.length, generated: backfilled.length, matches: backfilled },
  });
}

function parseSinceHours(raw: string | null): number | null {
  if (raw === null || raw === '') return 6;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  // 上限放到 1000h(~42 天)以支持整届赛事的历史 stats 一次性回填;常规 cron 仍用默认 6h。
  return parsed >= 1 && parsed <= 1000 ? parsed : null;
}
