/**
 * 分享卡片渲染包装层
 *
 * 复用项目根目录 /share-cards/templates.js 的现有实现：
 * - 9 套模板（3 风格 × 3 平台）
 * - Satori + Resvg
 * - 9 张样例已在仓库根目录验证过尺寸
 *
 * 这里只做：
 * - TypeScript 类型封装
 * - 输入 sanitize（兜底清洗赛事商标残留）
 * - 缓存 key 派生（卡片可在 CDN 激进缓存）
 */

import type { ReportStyle } from './prompts';
import { addPngTextMetadata, aigcMetadataChunks } from './cards/png-metadata';
import { teamFlagCode } from '@qhs/share-cards';

/** 国旗图基址(与赛事/战报小程序同一套图,自托管;渲染时 fetch→base64 内嵌)。 */
const FLAG_BASE = 'https://qiuhoushuo.com/flags';

/** 队名(英文/中文)→ 国旗图 URL;无映射返回 undefined(卡片头部回退占位)。 */
export function flagUrl(teamName: string | null | undefined): string | undefined {
  const code = teamName ? teamFlagCode(teamName) : '';
  return code ? `${FLAG_BASE}/${code}.png` : undefined;
}

export type Platform = 'wechat' | 'xhs' | 'x';

export interface CardPayload {
  // 基础数据
  competition: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  // stats（可选，硬核派必填）
  homePoss?: number;
  awayPoss?: number;
  homeShots?: number;
  awayShots?: number;
  homeShotsOn?: number;
  awayShotsOn?: number;
  homeXG?: string;
  awayXG?: string;
  homePassAcc?: number;
  awayPassAcc?: number;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  homeFlagUrl?: string;
  awayFlagUrl?: string;
  // 文案
  title: string;
  subtitle?: string;
  shareQuote: string;
  bodyExcerpt?: string;
  // 品牌（合规：标注 AI 生成）
  brand: string;
  shortUrl: string;
  // 精彩镜头（当前可为派生插画文案；未来可接授权图片 URL）
  highlightMoment?: {
    title: string;
    description?: string;
    minute?: string;
    image_url?: string;
    image_alt?: string;
  };
  briefCard?: {
    title: string;
    match_line: string;
    one_sentence_summary: string;
    focus_tags: string[];
    key_reasons: { title: string; evidence: string }[];
    timeline: { minute: string; text: string }[];
    data_points: { label: string; value: string; note: string }[];
    highlight_lens?: { title: string; image_url?: string; caption: string };
    share_line: string;
    integrity_note: string;
  };
  tactics?: {
    homeFormation: string;
    awayFormation: string;
    note?: string;
  };
  ratingsCard?: {
    match_line: string;
    motm?: { name: string; team: string; rating: number; position: string };
    home: { team: string; players: { name: string; rating: number | null; position: string; goals: number; assists: number }[] };
    away: { team: string; players: { name: string; rating: number | null; position: string; goals: number; assists: number }[] };
    note?: string;
  };
  scoreboardCard?: {
    title_line: string;
    asof?: string;
    scorers: { name: string; team: string; count: number; apps: number; flag?: string }[];
    assists: { name: string; team: string; count: number; apps: number; flag?: string }[];
    note?: string;
  };
  standingsCard?: {
    title_line: string;
    asof?: string;
    rows: { rank: number; team: string; played: number; win: number; draw: number; lose: number; goalsDiff: number; points: number; qualified: boolean; flag?: string }[];
    note?: string;
  };
  bracketCard?: {
    title?: string;
    subtitle?: string;
    note?: string;
    topR32: BracketCardMatch[]; top16: BracketCardMatch[]; top8: BracketCardMatch[]; topSF: BracketCardMatch[];
    final: BracketCardMatch[]; third: BracketCardMatch[];
    botSF: BracketCardMatch[]; bot8: BracketCardMatch[]; bot16: BracketCardMatch[]; botR32: BracketCardMatch[];
  };
  /** 官方战报风卡(ft,XHS 专用):结构见 packages/share-cards types.ts ftCard。 */
  ftCard?: {
    meta_line: string;
    date_line: string;
    progression?: string;
    home_scorers: string[];
    away_scorers: string[];
    potm?: string;
    bars: { label: string; home: string; away: string; home_ratio: number }[];
    timeline: { minute: string; text: string }[];
    quote?: string;
    integrity_note: string;
  };
}

interface BracketCardMatch {
  date: string;
  tag?: string;
  homeName?: string;
  awayName?: string;
  homeFlag?: string; // 渲染前 fetch→base64
  awayFlag?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  penHome?: number | null;
  penAway?: number | null;
  status: string;
}

/**
 * 渲染卡片（PNG Buffer）
 *
 * 调用方应当：
 * - 缓存 buffer 到 CDN / 对象存储（key = `${reportId}-${style}-${platform}.png`）
 * - 设置 Cache-Control: public, max-age=31536000, immutable
 * - 对象存储推荐：腾讯云 COS（境内 + 合规）
 */
async function fetchImageAsDataUrl(url: string, timeoutMs = 3000): Promise<string | undefined> {
  if (url.startsWith('data:image/')) return url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!contentType.startsWith('image/')) return undefined;
    return `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 对阵图各轮 matches 里的国旗 URL 去重批量 fetch→base64,回填进 bracketCard(不可在 satori 渲染时联网)。 */
async function prefetchBracketFlags(bc: NonNullable<CardPayload['bracketCard']>): Promise<NonNullable<CardPayload['bracketCard']>> {
  const groups = [bc.topR32, bc.top16, bc.top8, bc.topSF, bc.final, bc.third, bc.botSF, bc.bot8, bc.bot16, bc.botR32];
  const urls = new Set<string>();
  for (const g of groups) for (const m of g || []) { if (m.homeFlag) urls.add(m.homeFlag); if (m.awayFlag) urls.add(m.awayFlag); }
  const pairs = await Promise.all([...urls].map(async (u) => [u, await fetchImageAsDataUrl(u, 4000)] as const));
  const map = new Map(pairs);
  const remap = <T extends { homeFlag?: string; awayFlag?: string }>(m: T): T => ({
    ...m,
    homeFlag: m.homeFlag ? map.get(m.homeFlag) : undefined,
    awayFlag: m.awayFlag ? map.get(m.awayFlag) : undefined,
  });
  return {
    ...bc,
    topR32: bc.topR32.map(remap), top16: bc.top16.map(remap), top8: bc.top8.map(remap), topSF: bc.topSF.map(remap),
    final: bc.final.map(remap), third: bc.third.map(remap),
    botSF: bc.botSF.map(remap), bot8: bc.bot8.map(remap), bot16: bc.bot16.map(remap), botR32: bc.botR32.map(remap),
  };
}

/** 射手/助攻榜各行国旗 URL 去重批量 fetch→base64,回填(satori 渲染时不可联网;与 bracket 同款)。 */
async function prefetchScoreboardFlags(sc: NonNullable<CardPayload['scoreboardCard']>): Promise<NonNullable<CardPayload['scoreboardCard']>> {
  const urls = new Set<string>();
  for (const r of [...sc.scorers, ...sc.assists]) if (r.flag) urls.add(r.flag);
  const pairs = await Promise.all([...urls].map(async (u) => [u, await fetchImageAsDataUrl(u, 4000)] as const));
  const map = new Map(pairs);
  const remap = <T extends { flag?: string }>(r: T): T => ({ ...r, flag: r.flag ? map.get(r.flag) : undefined });
  return { ...sc, scorers: sc.scorers.map(remap), assists: sc.assists.map(remap) };
}

/** 积分榜各行队旗同款批量预取回填。 */
async function prefetchStandingsFlags(sc: NonNullable<CardPayload['standingsCard']>): Promise<NonNullable<CardPayload['standingsCard']>> {
  const urls = new Set<string>();
  for (const r of sc.rows) if (r.flag) urls.add(r.flag);
  const pairs = await Promise.all([...urls].map(async (u) => [u, await fetchImageAsDataUrl(u, 4000)] as const));
  const map = new Map(pairs);
  return { ...sc, rows: sc.rows.map((r) => ({ ...r, flag: r.flag ? map.get(r.flag) : undefined })) };
}

export async function renderShareCard(
  style: ReportStyle | 'brief' | 'tactics' | 'ratings' | 'scoreboard' | 'standings' | 'bracket' | 'ft',
  platform: Platform,
  payload: CardPayload,
  options: { withQr?: boolean } = {},
): Promise<Buffer> {
  const sanitized = sanitizePayload(payload);

  const [homeLogoUrl, awayLogoUrl, homeFlagUrl, awayFlagUrl, highlightImageUrl, briefHighlightImageUrl] = await Promise.all([
    sanitized.homeLogoUrl ? fetchImageAsDataUrl(sanitized.homeLogoUrl) : Promise.resolve(undefined),
    sanitized.awayLogoUrl ? fetchImageAsDataUrl(sanitized.awayLogoUrl) : Promise.resolve(undefined),
    sanitized.homeFlagUrl ? fetchImageAsDataUrl(sanitized.homeFlagUrl) : Promise.resolve(undefined),
    sanitized.awayFlagUrl ? fetchImageAsDataUrl(sanitized.awayFlagUrl) : Promise.resolve(undefined),
    sanitized.highlightMoment?.image_url
      ? fetchImageAsDataUrl(sanitized.highlightMoment.image_url, 15000) // F65:CDN 慢速兜底余量
      : Promise.resolve(undefined),
    sanitized.briefCard?.highlight_lens?.image_url
      ? fetchImageAsDataUrl(sanitized.briefCard.highlight_lens.image_url, 15000)
      : Promise.resolve(undefined),
  ]);
  const payloadWithImages = {
    ...sanitized,
    homeLogoUrl,
    awayLogoUrl,
    homeFlagUrl,
    awayFlagUrl,
    highlightMoment: sanitized.highlightMoment
      ? {
          ...sanitized.highlightMoment,
          image_url: highlightImageUrl,
        }
      : undefined,
    briefCard: sanitized.briefCard
      ? {
          ...sanitized.briefCard,
          highlight_lens: sanitized.briefCard.highlight_lens
            ? {
                ...sanitized.briefCard.highlight_lens,
                image_url: briefHighlightImageUrl,
              }
            : undefined,
        }
      : undefined,
  };

  // 对阵图:~30 面旗在 bracketCard 各轮 matches 里,固定两面旗预取不够 → 批量去重 fetch→base64 后回填。
  const withBracket = sanitized.bracketCard
    ? { ...payloadWithImages, bracketCard: await prefetchBracketFlags(sanitized.bracketCard) }
    : payloadWithImages;
  // 射手/助攻榜:各行队旗同款批量预取回填。
  const withScoreboard = sanitized.scoreboardCard
    ? { ...withBracket, scoreboardCard: await prefetchScoreboardFlags(sanitized.scoreboardCard) }
    : withBracket;
  // 积分榜:各行队旗同款批量预取回填。
  const finalPayload = sanitized.standingsCard
    ? { ...withScoreboard, standingsCard: await prefetchStandingsFlags(sanitized.standingsCard) }
    : withScoreboard;

  const { renderCard } = await import('@qhs/share-cards');
  // 仅在需要叠码时才传 withQr 选项(微信内分享卡);其余调用保持原 3 参签名。
  const rendered = (options.withQr
    ? await renderCard(style, platform, finalPayload, { withQr: true })
    : await renderCard(style, platform, finalPayload)) as Buffer;
  // 隐式（元数据）标识：与可见品牌「· AI 生成」一同满足《标识办法》显式 + 隐式双标识要求
  return addPngTextMetadata(Buffer.from(rendered), aigcMetadataChunks());
}

// 卡片版式按"节选 ≤4 行"设计预算;6/12 真 LLM(带真实事件)写出 9 行长段,
// 1440px 定高 flex 总高爆表 → 节选框压住大标题(用户截图实证)。数据层统一截断,
// 一处管住全部 9 个模板;模板层另有 lineClamp 兜底。金句区由模板 fitText 自适应字号,不在此截断。
const MAX_BODY_EXCERPT_CHARS = 120;

function clampText(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function sanitizePayload(p: CardPayload): CardPayload {
  // 赛事商标兜底清洗(上游 prompts/safety 已拦截,这里是 defense in depth)
  const clean = (s: string | undefined): string | undefined =>
    s
      ?.replace(/FIFA/gi, '')          // trademark-allowed
      .replace(/世界杯/g, '国际大赛')   // trademark-allowed
      .replace(/World\s?Cup/gi, '国际大赛')  // trademark-allowed
      .trim();

  return {
    ...p,
    competition: clean(p.competition) ?? p.competition,
    title: clean(p.title) ?? p.title,
    subtitle: clean(p.subtitle),
    shareQuote: clean(p.shareQuote) ?? p.shareQuote,
    bodyExcerpt: clampText(clean(p.bodyExcerpt), MAX_BODY_EXCERPT_CHARS),
    highlightMoment: p.highlightMoment
      ? {
          ...p.highlightMoment,
          title: clean(p.highlightMoment.title) ?? p.highlightMoment.title,
          description: clean(p.highlightMoment.description),
          image_alt: clean(p.highlightMoment.image_alt),
        }
      : undefined,
    // ft 卡文案兜底清洗(meta_line 来自 sanitizeCompetition、quote 来自 LLM share_quote,双保险)
    ftCard: p.ftCard
      ? { ...p.ftCard, meta_line: clean(p.ftCard.meta_line) ?? p.ftCard.meta_line, quote: clean(p.ftCard.quote) }
      : undefined,
    // 品牌固定加 AI 生成标识
    brand: p.brand.includes('AI') ? p.brand : `${p.brand} · AI 生成`,
  };
}

/**
 * 卡片缓存 key（CDN / 对象存储）
 */
export function cardCacheKey(reportId: string, style: ReportStyle, platform: Platform): string {
  return `cards/v2/${reportId}/${style}-${platform}.png`;
}
