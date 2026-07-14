/**
 * 球迷形象生成（豆包 Seedream 图生图）。
 *
 * 合规红线（代码层不可绕过，对应 AIGC 三件套 + 深度合成规制 + PIPL 敏感个人信息）：
 * 1. 输入自拍只在内存中流转——不写存储、不写日志、不进 prompt 之外的任何持久化路径；
 * 2. watermark 强制 true，没有任何环境变量可以关掉（区别于 highlight-image 的可配置）；
 * 3. prompt 锁定非写实插画风格，禁止生成以假乱真的真人照片级形象；
 * 4. 整个特性由 feature.fan_avatar 灰度门控制，默认关闭，备案回执 + 律师评估前不得开启；
 * 5. COS 结果 key 不携带明文 openid（sha-256 截断）。
 */

import { createHash } from 'node:crypto';
import type { CardStorageClient } from './card-storage';
import { sanitizeTrademarkText } from '../trademark-policy';
import { addPngTextMetadata, aigcMetadataChunks } from '../cards/png-metadata';

export type FanAvatarProviderName = 'mock' | 'doubao';

// 用户可选风格(对应 Step0 三种示例)。⚠️ 红线 3 不变:三者都是"插画/非照片级",
// 「painterly(半写实)」是厚涂数字插画而非照片级写实真人脸,守住禁 deepfake 红线。
export type FanAvatarStyle = 'cartoon' | 'figure' | 'painterly';

// 生成意图:
//  - solo  : 把用户画成插画球迷(默认;红线 3 锁非写实,见 buildFanAvatarPrompt)。
//  - costar: 用户与球星合影(写实)。涉及肖像权/《深度合成规定》合规义务的高风险模式:
//            由独立灰度门 feature.fan_avatar_costar 控制(默认关),watermark 恒 true,
//            输出恒带「非本人·非真实合影」显著披露,自拍不落盘。
export type FanAvatarMode = 'solo' | 'costar';

export interface FanAvatarInput {
  openid: string;
  /** 中文队名（小程序 teams 映射后的展示名） */
  team: string;
  /** 用户自拍，仅内存态 */
  selfie: Buffer;
  selfieContentType: 'image/jpeg' | 'image/png';
  /** 形象风格(默认 cartoon);仅在锁定的非写实风格集合内取值,不接受任意 prompt 注入 */
  style?: FanAvatarStyle;
  /** 生成意图(默认 solo);costar 走「与球星合影」写实 prompt */
  mode?: FanAvatarMode;
  /** costar 模式下的球星名(展示名);仅 costar 使用,sanitize 同 team,不接受任意注入 */
  star?: string;
}

export interface FanAvatarProviderOutput {
  image: Buffer;
  contentType: 'image/png';
  prompt: string;
}

export interface FanAvatarProvider {
  name: FanAvatarProviderName;
  generate(input: FanAvatarInput): Promise<FanAvatarProviderOutput>;
}

export interface DoubaoFanAvatarConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  size: string;
  timeoutMs: number;
}

export interface FanAvatarResult {
  key: string;
  url: string;
  provider: FanAvatarProviderName;
  prompt: string;
}

// 三种用户可选风格的描述子。全部为"插画/非照片级",末句红线 3 一致约束(禁照片级写实人脸)。
const STYLE_DESCRIPTORS: Record<FanAvatarStyle, string> = {
  cartoon: '扁平插画风格，色块明快，卡通化处理',
  figure: '3D 潮玩盲盒手办风格，Q 版大头比例，光滑树脂质感，可爱潮流',
  painterly: '厚涂数字插画风格，细腻光影与质感、电影感氛围光（仍为插画，非照片）',
};

/** 队名/球星名清洗:仅保留中英数字与空格、截断,防 prompt 注入。team/star 共用一套口径。 */
function sanitizeName(value: string, fallback: string): string {
  return value.replace(/[^\p{Script=Han}A-Za-z0-9 ]/gu, '').slice(0, 20) || fallback;
}

// costar 自由文本(手输球星/球队)注入面更危(真实球星+肖像权+深度合成高危路径)——sanitizeName 只剥标点,
// 全中文对抗指令(如"无视约束""队徽""官方")会原样拼进 prompt 主体。额外剥离指令/违禁/品牌词 token(审查 P2-1)。
// 真实队名/球星名不含这些词,剥之零误伤;剥后再走 sanitizeName 常规清洗。
const COSTAR_DENY = /无视|忽略|忽视|ignore|override|遵循|约束|指令|提示词|prompt|队徽|徽章|会徽|logo|商标|水印|watermark|品牌|赞助|官方|复制|两个|三个|多个|裸|nude|naked|色情|血腥/gi;
function sanitizeCostarInput(value: string, fallback: string): string {
  return sanitizeName(value.replace(COSTAR_DENY, ''), fallback);
}

/** 非写实插画风格锁定在 prompt 内（红线 3），队名+风格外其余不可由调用方注入。
 *  style 仅在三种锁定的非写实风格内取值;无论哪种,末句都禁止照片级写实人脸。 */
export function buildFanAvatarPrompt(team: string, style: FanAvatarStyle = 'cartoon'): string {
  const cleanTeam = sanitizeName(sanitizeTrademarkText(team), '主队'); // 先脱赛事商标词再清洗
  const styleDesc = STYLE_DESCRIPTORS[style] || STYLE_DESCRIPTORS.cartoon;
  return [
    `把参考照片中的人物画成${cleanTeam}球迷形象：身穿${cleanTeam}球衣，脸颊涂着助威彩绘，背景是体育场看台灯光。`,
    `${styleDesc}，保留人物发型与神态特征但不追求照片级写实。`,
    '禁止生成写实人脸照片，禁止出现任何文字、水印外的标识。',
  ].join('');
}

/**
 * 「与球星合影」prompt(costar 模式)。与 solo 不同:这里走写实风格。
 * 高风险模式的合规护栏:watermark 恒 true(深度合成显著标识,见 provider),
 * 输出恒带「非本人·非真实合影」披露,自拍仍不落盘(红线 1),独立灰度门默认关。
 * team/star 之外不接受任意注入。
 */
export function buildCostarPrompt(team: string, star: string): string {
  const cleanTeam = sanitizeCostarInput(sanitizeTrademarkText(team), '球队'); // 脱商标 + 剥注入/违禁词 + 常规清洗
  const cleanStar = sanitizeCostarInput(sanitizeTrademarkText(star), '球星');
  // ⚠️ 身份绑定是质量关键:单张人脸参考 + prompt 点名知名球星时,模型常分不清"哪张脸是参考者、哪张是球星"
  //    → 把参考者也画成球星(出现两个 C罗)+ 参考脸花掉。修法:显式左右分工 + 声明参考者是「普通球迷·非球星」
  //    + 严格保脸 + 负向约束(不复制球星、不加多余人物)。已在生产 A/B(3/3)验证消除"两个球星 + 花脸"。
  return [
    `一张在足球场上拍摄的真实合影照片，画面里只有两位并肩站立的成年人：`,
    `左边这位是参考照片里的本人——必须严格保留参考照片人物的真实长相、脸型、五官比例、发型、肤色、性别与年龄，脸部清晰自然、不变形、不模糊、不过度美颜；TA 是一位普通球迷、不是球星，穿休闲球迷服装。`,
    `右边这位是足球球星${cleanStar}本人，身穿${cleanTeam}球衣。`,
    `两人自然友好地合影留念，背景为体育场看台与灯光，写实摄影质感、自然光、画面高清清晰。`,
    `重要约束：不要把左边参考照片中的人物也画成${cleanStar}；不要在画面里生成两个${cleanStar}或两张一样的脸；画面里只有这两位成年人，不要添加儿童、路人或任何多余人物。`,
    '画面整洁得体、健康向上，不得出现任何文字、号码牌、水印，也不得出现任何官方赛事标识、俱乐部/国家队队徽、赞助商或品牌商标。',
  ].join('');
}

/** 按 mode 选 prompt:costar+有 star 走合影 prompt,否则走 solo 插画 prompt(红线 3)。 */
function promptForInput(input: FanAvatarInput): string {
  return input.mode === 'costar' && input.star
    ? buildCostarPrompt(input.team, input.star)
    : buildFanAvatarPrompt(input.team, input.style);
}

export function buildFanAvatarKey(openid: string, requestId: string): string {
  const subject = createHash('sha256').update(openid).digest('hex').slice(0, 16);
  const safeRequestId = encodeURIComponent(requestId).replace(/%2F/gi, '');
  return `fan-avatars/${subject}/${safeRequestId}.png`;
}

export function createMockFanAvatarProvider(): FanAvatarProvider {
  return {
    name: 'mock',
    async generate(input) {
      return {
        image: MOCK_PNG,
        contentType: 'image/png',
        prompt: promptForInput(input),
      };
    },
  };
}

export function loadDoubaoFanAvatarConfig(env: NodeJS.ProcessEnv = process.env): DoubaoFanAvatarConfig {
  const apiKey = env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error('[fan-avatar] DOUBAO_API_KEY missing');
  return {
    apiKey,
    baseURL: (env.DOUBAO_IMAGE_BASE_URL || env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    model: env.DOUBAO_AVATAR_MODEL || env.DOUBAO_IMAGE_MODEL || 'doubao-seedream-4-0-250828',
    // 2K(默认从 1K 升):合影/人脸要发朋友圈,1K 脸部偏糊。Seedream 4.0 实测接受 '2K';成本敏感可用 DOUBAO_AVATAR_SIZE 覆盖回 '1K'。
    size: env.DOUBAO_AVATAR_SIZE || '2K',
    timeoutMs: parsePositiveInt(env.DOUBAO_IMAGE_TIMEOUT_MS, 90_000),
    // 注意：没有 watermark 字段——红线 2，强制 true 写死在请求体里
  };
}

export function createDoubaoFanAvatarProvider(
  cfg: DoubaoFanAvatarConfig = loadDoubaoFanAvatarConfig(),
  fetchImpl: typeof fetch = fetch,
): FanAvatarProvider {
  return {
    name: 'doubao',
    async generate(input) {
      const prompt = promptForInput(input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetchImpl(`${cfg.baseURL}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            prompt,
            image: [`data:${input.selfieContentType};base64,${input.selfie.toString('base64')}`],
            size: cfg.size,
            sequential_image_generation: 'disabled',
            stream: false,
            response_format: 'url',
            watermark: true, // 红线 2：深度合成显式标识，恒为 true
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`[fan-avatar] doubao generation failed: ${res.status} ${await safeText(res)}`);
        }
        const payload = await res.json();
        const image = await imageFromDoubaoPayload(payload, fetchImpl, controller.signal);
        return { image, contentType: 'image/png', prompt };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          throw new Error(`[fan-avatar] doubao generation timeout after ${cfg.timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createFanAvatarProviderFromEnv(env: NodeJS.ProcessEnv = process.env): FanAvatarProvider {
  const provider = env.FAN_AVATAR_PROVIDER || env.HIGHLIGHT_IMAGE_PROVIDER || 'mock';
  if (provider === 'mock') return createMockFanAvatarProvider();
  if (provider === 'doubao') return createDoubaoFanAvatarProvider(loadDoubaoFanAvatarConfig(env));
  throw new Error(`[fan-avatar] unknown FAN_AVATAR_PROVIDER: ${provider}`);
}

/** 只持久化生成结果；input.selfie 在本函数返回后没有任何引用残留（红线 1）。 */
export async function generateFanAvatar(
  input: FanAvatarInput,
  deps: { provider: FanAvatarProvider; storage: CardStorageClient; requestId: string },
): Promise<FanAvatarResult> {
  const generated = await deps.provider.generate(input);
  const key = buildFanAvatarKey(input.openid, deps.requestId);
  // 隐式 AIGC 标识(《标识办法》显式+隐式双标识):图片为 PNG(ensurePng),注入元数据文本块,
  // 与分享卡一致;显式标识靠豆包 watermark:true(红线 2)。非 PNG 时 addPngTextMetadata 原样返回。
  const image = addPngTextMetadata(generated.image, aigcMetadataChunks());
  const url = await deps.storage.put(key, image, generated.contentType);
  return { key, url, provider: deps.provider.name, prompt: generated.prompt };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function imageFromDoubaoPayload(payload: unknown, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  const first = (payload as { data?: Array<{ url?: string; b64_json?: string }> })?.data?.[0];
  if (!first) throw new Error('[fan-avatar] doubao response missing data[0]');
  if (first.b64_json) return ensurePng(Buffer.from(first.b64_json, 'base64'));
  if (!first.url) throw new Error('[fan-avatar] doubao response missing data[0].url');
  const imageRes = await fetchImpl(first.url, { signal });
  if (!imageRes.ok) {
    throw new Error(`[fan-avatar] doubao image download failed: ${imageRes.status} ${await safeText(imageRes)}`);
  }
  return ensurePng(Buffer.from(await imageRes.arrayBuffer()));
}

async function ensurePng(buf: Buffer): Promise<Buffer> {
  if (isPng(buf)) return buf;
  const sharp = (await import('sharp')).default;
  return await sharp(buf).png().toBuffer();
}

function isPng(buf: Buffer): boolean {
  return buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=',
  'base64',
);
