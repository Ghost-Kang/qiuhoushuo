import {
  loadDoubaoLaoliVideoConfig,
  pollArkVideoTask,
  toImageDataUri,
  type DoubaoLaoliVideoConfig,
  type LaoliReferenceImageType,
} from './laoli-video';
import { createOmnihumanAvatarProvider, loadOmnihumanConfig } from './laoli-omnihuman';

/**
 * 音频驱动「老李口播」对口型 provider。
 * - seedance：方舟 contents/generations/tasks 传 audio_url 自动对口型(≤15s/段),复用 DOUBAO_API_KEY。
 * - omnihuman：火山智能视觉 jimeng_realman_avatar_picture_omni_v15,需 AK/SK 签名(见 laoli-omnihuman.ts)。
 * - mock：单测/缺省。
 * 与 laoli-video.ts 的「动态背景 i2v」不同：那条只动不对口型(伪口播),这条让老李唇形跟着 TTS 走。
 */
export type LaoliAvatarProviderName = 'mock' | 'seedance' | 'omnihuman';

export interface LaoliAvatarInput {
  matchId: string;
  segmentIndex: number;
  /** 驱动音频公网 URL(mp3/wav);seedance 与 omnihuman 都要求公网可达。 */
  audioUrl: string;
  audioDurationSec: number;
  /** seedance 走 base64 首帧;omnihuman 走 imageUrl。按 provider 取所需。 */
  referenceImage?: Buffer;
  referenceImageType?: LaoliReferenceImageType;
  imageUrl?: string;
  prompt?: string;
}

export interface LaoliAvatarOutput {
  video: Buffer;
  contentType: 'video/mp4';
  provider: LaoliAvatarProviderName;
  taskId?: string;
}

export interface LaoliAvatarProvider {
  name: LaoliAvatarProviderName;
  /** 单段最长秒数,超过须分段;seedance=15,omnihuman 更长。 */
  maxClipSec: number;
  generate(input: LaoliAvatarInput): Promise<LaoliAvatarOutput>;
}

export const SEEDANCE_MAX_CLIP_SEC = 15;
const SEEDANCE_MIN_CLIP_SEC = 4;

export function clampSeedanceDuration(audioDurationSec: number): number {
  const rounded = Math.ceil(Number.isFinite(audioDurationSec) ? audioDurationSec : SEEDANCE_MIN_CLIP_SEC);
  return Math.max(SEEDANCE_MIN_CLIP_SEC, Math.min(SEEDANCE_MAX_CLIP_SEC, rounded));
}

export function buildLaoliLipsyncPrompt(): string {
  return [
    '半写实插画老李正对镜头,跟随音频自然口播,唇形与语音同步。',
    '神态自然、轻微点头,镜头稳定,只露上半身。',
    '保持脸、眼镜、衣服和背景一致,不出现任何比分文字、标志或额外人物。',
  ].join('');
}

export function createMockLaoliAvatarProvider(): LaoliAvatarProvider {
  return {
    name: 'mock',
    maxClipSec: SEEDANCE_MAX_CLIP_SEC,
    async generate(input) {
      return {
        video: Buffer.from(`mock-laoli-avatar-${input.segmentIndex}`),
        contentType: 'video/mp4',
        provider: 'mock',
        taskId: `mock-avatar-${input.segmentIndex}`,
      };
    },
  };
}

export function createSeedanceAvatarProvider(
  cfg: DoubaoLaoliVideoConfig = loadDoubaoLaoliVideoConfig(),
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): LaoliAvatarProvider {
  return {
    name: 'seedance',
    maxClipSec: SEEDANCE_MAX_CLIP_SEC,
    async generate(input) {
      if (!input.referenceImage || !input.referenceImageType) {
        throw new Error('[laoli-avatar] seedance requires referenceImage');
      }
      if (!input.audioUrl) throw new Error('[laoli-avatar] seedance requires audioUrl');
      const createRes = await fetchImpl(`${cfg.baseURL}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          content: [
            { type: 'text', text: input.prompt || buildLaoliLipsyncPrompt() },
            {
              // 音频驱动(对口型)模式:图片须显式标 reference_image(参考图/reference media),
              // 与 audio_url(也是 reference media)同类共存。**不能用 first_frame**(那是首帧条件生成,
              // 与 reference media 互斥,方舟报 400 "first/last frame content cannot be mixed with reference media content");
              // 省略 role 时方舟默认按 first_frame 处理,同样冲突 → 必须显式 reference_image。
              type: 'image_url',
              image_url: { url: toImageDataUri(input.referenceImage, input.referenceImageType) },
              role: 'reference_image',
            },
            // reference media 模式:音频也须标 role:'reference_audio'(方舟:
            // "reference media mode requires audio role to be reference_audio"),与 reference_image 配套。
            { type: 'audio_url', audio_url: { url: input.audioUrl }, role: 'reference_audio' },
          ],
          ratio: '9:16',
          duration: clampSeedanceDuration(input.audioDurationSec),
          resolution: '720p',
          watermark: true, // 合规红线：恒为 true
          generate_audio: false, // 用我们自己的干净 TTS,模型只负责对口型画面
        }),
      });
      if (!createRes.ok) {
        throw new Error(`[laoli-avatar] create task failed: ${createRes.status} ${await safeText(createRes)}`);
      }
      const created = await createRes.json() as { id?: string };
      if (!created.id) throw new Error('[laoli-avatar] create task response missing id');
      const { video } = await pollArkVideoTask(cfg, created.id, fetchImpl, wait);
      return { video, contentType: 'video/mp4', provider: 'seedance', taskId: created.id };
    },
  };
}

export function laoliAvatarEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LAOLI_AVATAR_ENABLED === '1' || env.LAOLI_AVATAR_ENABLED === 'true';
}

/**
 * lean=裸对口型直出(无 ffmpeg·静音);reel=ffmpeg 合成版(生成图轮播+老李右下PiP+字幕+混音·30s);
 * compose=旧版 Remotion 叠卡(生产无 Chromium 不可用)。缺省 compose 保持向后兼容。
 */
export function laoliAvatarMode(env: NodeJS.ProcessEnv = process.env): 'lean' | 'reel' | 'compose' {
  if (env.LAOLI_AVATAR_MODE === 'lean') return 'lean';
  if (env.LAOLI_AVATAR_MODE === 'reel') return 'reel';
  return 'compose';
}

export function laoliRefPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.LAOLI_REF_PUBLIC_URL || 'https://qiuhoushuo.com/persona/laoli-ref.png';
}

export function createLaoliAvatarProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LaoliAvatarProvider {
  const provider = env.LAOLI_AVATAR_PROVIDER || 'mock';
  if (provider === 'mock') return createMockLaoliAvatarProvider();
  if (provider === 'seedance') return createSeedanceAvatarProvider(loadDoubaoLaoliVideoConfig(env));
  if (provider === 'omnihuman') {
    // creds 缺失时 loadOmnihumanConfig 会清晰报错(AK/SK 待 founder 控制台开通)。
    return createOmnihumanAvatarProvider(loadOmnihumanConfig(env));
  }
  throw new Error(`[laoli-avatar] unknown LAOLI_AVATAR_PROVIDER: ${provider}`);
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
