/**
 * reel 主画面图(一图看懂 brief / 数据卡 ratings)取字节 + 降级链。
 * 取图红线(spec G3):**绝不 fetch CDN img.qiuhoushuo.cn(容器 hairpin 不可达)**;
 * 一律 COS getBytes(reportId-keyed) 优先 → miss 走 127.0.0.1 inline 卡路由(matchId·绕 nginx)。
 * key 用 CARD_RENDER_CACHE_VERSION 常量,禁硬编码版本。highlight 镜头图 MVP 不取(降级 brief)。
 */
import { CARD_RENDER_CACHE_VERSION, type CardStorageClient } from './card-storage';
import type { LaoliReelImage } from './laoli-video-script';

export interface ReelBackgrounds {
  brief?: Buffer;
  ratings?: Buffer;
  highlight?: Buffer;
  /** xhs 官方战报风 ft 卡(founder 2026-07-04 口径:轮播主图,brief 退居兜底) */
  ft?: Buffer;
}

const INLINE_BASE = 'http://127.0.0.1:3000';

async function fetchCardVariant(args: {
  matchId: string;
  reportId: string;
  variant: 'brief' | 'ratings' | 'ft';
  storage: CardStorageClient;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): Promise<Buffer | undefined> {
  // 1) COS getBytes(容器可达·非 CDN)
  const key = `cards/${CARD_RENDER_CACHE_VERSION}/${args.reportId}/${args.variant}-full-xhs.png`;
  const bytes = await args.storage.getBytes?.(key);
  if (bytes) return bytes;
  // 2) miss → 127.0.0.1 inline 卡路由(matchId·绝不打 CDN)
  try {
    const res = await args.fetchImpl(
      `${args.baseUrl}/api/card/${args.matchId}?style=duanzi&platform=xhs&variant=${args.variant}&inline=1`,
    );
    if (!res.ok) return undefined; // ratings 无 players → 404,正常降级
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

export async function loadReelBackgrounds(p: {
  matchId: string;
  reportId: string;
  momentId?: string;
  storage: CardStorageClient;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** context 已取的 brief,免重复请求 */
  briefHint?: Buffer;
}): Promise<ReelBackgrounds> {
  const baseUrl = p.baseUrl ?? INLINE_BASE;
  const fetchImpl = p.fetchImpl ?? fetch;
  const common = { matchId: p.matchId, reportId: p.reportId, storage: p.storage, baseUrl, fetchImpl };
  const brief = p.briefHint ?? (await fetchCardVariant({ ...common, variant: 'brief' }));
  const ratings = await fetchCardVariant({ ...common, variant: 'ratings' });
  const ft = await fetchCardVariant({ ...common, variant: 'ft' });
  // highlight 镜头图:MVP 不取(momentId 解析留 Step 10),undefined → 降级 ft/brief
  return { brief, ratings, ft };
}

/** 按 scene.image 选背景字节 + 降级;founder 2026-07-04 口径:轮播用 xhs ft 卡为主
 *  (brief 位一律先取 ft,缺才回 brief);全缺返 null(调用方走标题兜底底图)。 */
export function resolveSceneBackground(image: LaoliReelImage, bg: ReelBackgrounds): { buf: Buffer; ext: 'png' | 'jpg' } | null {
  const pick =
    image === 'brief' ? bg.ft ?? bg.brief
    : image === 'ratings' ? bg.ratings ?? bg.ft ?? bg.brief
    : bg.highlight ?? bg.ft ?? bg.brief; // highlight
  if (!pick) return null;
  const ext: 'png' | 'jpg' = image === 'highlight' && bg.highlight ? 'jpg' : 'png';
  return { buf: pick, ext };
}
