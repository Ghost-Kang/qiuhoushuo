/**
 * 「按球队」生成球迷形象(豆包 Seedream 文生图,非图生图)——用于公众号草稿末尾的主/客队应援图。
 *
 * 与 [lib/api/fan-avatar.ts] 区别:那是「用户自拍图生图」¥1 付费特性(红线锁非写实插画);
 * 这里是「按队名文生图」的通用虚构球迷形象,无用户人脸输入。
 *
 * 合规/尺度(创始人定「克制版半写真」,公众号低俗内容会封号,而支付/服务号/小程序都挂在该认证号上):
 *  - prompt 锁定 SFW:得体大方、禁裸露/性暗示/强调身材/暴露服装;
 *  - 锁定「完全虚构、不得与真实人物相似」,避免肖像权 + deepfake;
 *  - 禁止画面文字/水印/标识;Doubao watermark 恒 true(AI 生成显式标识,合规);
 *  - 结果带「AI 生成」字样在正文caption(由 mp-draft 拼);仅 `all` 手动路径附带,MP_DRAFT_FAN_PORTRAIT 兜底开关。
 */

import type { CardStorageClient } from './card-storage';

export type FanPortraitProviderName = 'mock' | 'doubao';
export type FanPortraitSide = 'home' | 'away';

export interface FanPortraitInput {
  team: string; // 中文队名(展示名)
  side: FanPortraitSide;
}
export interface FanPortraitProviderOutput {
  image: Buffer;
  contentType: 'image/jpeg';
  prompt: string;
}
export interface FanPortraitProvider {
  name: FanPortraitProviderName;
  generate(input: FanPortraitInput): Promise<FanPortraitProviderOutput>;
}
export interface DoubaoFanPortraitConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  size: string;
  timeoutMs: number;
}

/** SFW 锁定的「克制版半写真」球迷形象 prompt——队名外不接受任意注入,守住公众号过审尺度。 */
export function buildFanPortraitPrompt(team: string): string {
  const cleanTeam = team.replace(/[^\p{Script=Han}A-Za-z0-9 ]/gu, '').trim().slice(0, 20) || '主队';
  return [
    `一位年轻漂亮、充满活力的${cleanTeam}女球迷,身穿${cleanTeam}国家队主场球衣,脸颊画着${cleanTeam}国旗助威彩绘,在体育场看台为球队加油呐喊。`,
    '半写实摄影质感,自然光,明亮欢快,自信阳光的笑容,电影级氛围。',
    '着装得体大方、健康向上、适合在公众平台展示;禁止裸露或性暗示、禁止刻意强调身材、禁止暴露服装。',
    '画面中不得出现任何文字、号码牌、品牌标识或水印。生成完全虚构的人物,不得与任何真实人物相似。',
  ].join('');
}

export function buildFanPortraitKey(input: { matchId: string; side: FanPortraitSide }): string {
  const safe = encodeURIComponent(input.matchId.trim() || 'unknown').replace(/%2F/gi, '');
  return `fan-portraits/${safe}/${input.side}.jpg`;
}

export function fanPortraitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MP_DRAFT_FAN_PORTRAIT === '1' || env.MP_DRAFT_FAN_PORTRAIT === 'true';
}

// 1x1 占位 JPEG,mock provider 用(不打外部图像服务)。
const MOCK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////2wBDAf////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwA//9k=',
  'base64',
);

export function createMockFanPortraitProvider(): FanPortraitProvider {
  return {
    name: 'mock',
    async generate(input) {
      return { image: MOCK_JPEG, contentType: 'image/jpeg', prompt: buildFanPortraitPrompt(input.team) };
    },
  };
}

export function loadDoubaoFanPortraitConfig(env: NodeJS.ProcessEnv = process.env): DoubaoFanPortraitConfig {
  const apiKey = env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error('[fan-portrait] DOUBAO_API_KEY missing');
  return {
    apiKey,
    baseURL: (env.DOUBAO_IMAGE_BASE_URL || env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    model: env.DOUBAO_IMAGE_MODEL || 'doubao-seedream-4-0-250828',
    size: env.DOUBAO_IMAGE_SIZE || '2K',
    timeoutMs: parsePositiveInt(env.DOUBAO_IMAGE_TIMEOUT_MS, 90_000),
    // 注意:无 watermark 字段——恒 true 写死在请求体(AI 生成显式标识)。
  };
}

export function createDoubaoFanPortraitProvider(
  cfg: DoubaoFanPortraitConfig = loadDoubaoFanPortraitConfig(),
  fetchImpl: typeof fetch = fetch,
): FanPortraitProvider {
  return {
    name: 'doubao',
    async generate(input) {
      const prompt = buildFanPortraitPrompt(input.team);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetchImpl(`${cfg.baseURL}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            prompt,
            size: cfg.size,
            sequential_image_generation: 'disabled',
            stream: false,
            response_format: 'url',
            watermark: true, // 恒 true:深度合成显式标识
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`[fan-portrait] doubao generation failed: ${res.status} ${await safeText(res)}`);
        }
        const payload = await res.json();
        const image = await imageFromDoubaoPayload(payload, fetchImpl, controller.signal);
        return { image, contentType: 'image/jpeg', prompt };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          throw new Error(`[fan-portrait] doubao generation timeout after ${cfg.timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createFanPortraitProviderFromEnv(env: NodeJS.ProcessEnv = process.env): FanPortraitProvider {
  const provider = env.FAN_PORTRAIT_PROVIDER || 'mock';
  if (provider === 'mock') return createMockFanPortraitProvider();
  if (provider === 'doubao') return createDoubaoFanPortraitProvider(loadDoubaoFanPortraitConfig(env));
  throw new Error(`[fan-portrait] unknown FAN_PORTRAIT_PROVIDER: ${provider}`);
}

/**
 * 取某场某队球迷形象字节:先读 COS 缓存(命中直返,零成本),未命中再文生图并落缓存。
 * best-effort:任何失败返回 null(草稿照常建,只是不附该图),绝不抛、绝不拖垮草稿主链路。
 */
export async function ensureFanPortraitBytes(
  input: { matchId: string; side: FanPortraitSide; team: string },
  deps: { provider: FanPortraitProvider; storage: CardStorageClient },
): Promise<Buffer | null> {
  const key = buildFanPortraitKey({ matchId: input.matchId, side: input.side });
  try {
    const cached = await deps.storage.getBytes?.(key);
    if (cached) return cached;
  } catch {
    // 缓存读失败 → 当 miss 处理,继续生成
  }
  try {
    const out = await deps.provider.generate({ team: input.team, side: input.side });
    await deps.storage.put(key, out.image, out.contentType);
    return out.image;
  } catch (err) {
    console.warn('[fan-portrait] generate fail:', input.side, (err as Error).message);
    return null;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function imageFromDoubaoPayload(payload: unknown, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  const first = (payload as { data?: Array<{ url?: string; b64_json?: string }> })?.data?.[0];
  if (!first) throw new Error('[fan-portrait] doubao response missing data[0]');
  if (first.b64_json) return toPortraitJpeg(Buffer.from(first.b64_json, 'base64'));
  if (!first.url) throw new Error('[fan-portrait] doubao response missing data[0].url');
  const imageRes = await fetchImpl(first.url, { signal });
  if (!imageRes.ok) {
    throw new Error(`[fan-portrait] doubao image download failed: ${imageRes.status} ${await safeText(imageRes)}`);
  }
  return toPortraitJpeg(Buffer.from(await imageRes.arrayBuffer()));
}

/** 压到公众号正文合适的体积(最长边 1280,JPEG q85)——控制 uploadimg 体积与拉取耗时。 */
async function toPortraitJpeg(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return await sharp(buf).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
