import type { CardStorageClient } from './card-storage';

export type LaoliVideoProviderName = 'mock' | 'doubao';
export type LaoliReferenceImageType = 'image/png' | 'image/jpeg';

export interface LaoliVideoInput {
  matchId: string;
  referenceImage: Buffer;
  referenceImageType: LaoliReferenceImageType;
  prompt: string;
}

export interface LaoliVideoProviderOutput {
  video: Buffer;
  contentType: 'video/mp4';
  provider: LaoliVideoProviderName;
  taskId?: string;
}

export interface LaoliVideoProvider {
  name: LaoliVideoProviderName;
  generate(input: LaoliVideoInput): Promise<LaoliVideoProviderOutput>;
}

export interface DoubaoLaoliVideoConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface LaoliRawVideoResult extends LaoliVideoProviderOutput {
  key: string;
  url: string;
}

export function buildLaoliRawVideoKey(matchId: string): string {
  return `laoli-videos/${safePart(matchId)}/raw.mp4`;
}

export function createMockLaoliVideoProvider(): LaoliVideoProvider {
  return {
    name: 'mock',
    async generate() {
      return {
        video: Buffer.from('mock-laoli-video'),
        contentType: 'video/mp4',
        provider: 'mock',
        taskId: 'mock-task',
      };
    },
  };
}

export function loadDoubaoLaoliVideoConfig(env: NodeJS.ProcessEnv = process.env): DoubaoLaoliVideoConfig {
  const apiKey = env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error('[laoli-video] DOUBAO_API_KEY missing');
  return {
    apiKey,
    model: env.DOUBAO_VIDEO_MODEL || 'doubao-seedance-2-0-260128',
    baseURL: (env.DOUBAO_VIDEO_BASE_URL || env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    pollIntervalMs: positiveInt(env.DOUBAO_VIDEO_POLL_INTERVAL_MS, 5_000),
    timeoutMs: positiveInt(env.DOUBAO_VIDEO_TIMEOUT_MS, 180_000),
  };
}

export function createDoubaoLaoliVideoProvider(
  cfg: DoubaoLaoliVideoConfig = loadDoubaoLaoliVideoConfig(),
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): LaoliVideoProvider {
  return {
    name: 'doubao',
    async generate(input) {
      const createRes = await fetchImpl(`${cfg.baseURL}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          content: [
            { type: 'text', text: input.prompt },
            {
              type: 'image_url',
              image_url: { url: toImageDataUri(input.referenceImage, input.referenceImageType) },
              role: 'first_frame',
            },
          ],
          ratio: '9:16',
          duration: 4,
          resolution: '720p',
          watermark: true, // 合规红线：恒为 true
          generate_audio: false,
        }),
      });
      if (!createRes.ok) {
        throw new Error(`[laoli-video] create task failed: ${createRes.status} ${await safeText(createRes)}`);
      }
      const created = await createRes.json() as { id?: string };
      if (!created.id) throw new Error('[laoli-video] create task response missing id');
      const { video } = await pollArkVideoTask(cfg, created.id, fetchImpl, wait);
      return { video, contentType: 'video/mp4', provider: 'doubao', taskId: created.id };
    },
  };
}

/**
 * 轮询方舟 contents/generations/tasks 异步任务直到 succeeded，下载视频字节。
 * Seedance i2v(动态背景)与音频驱动对口型(laoli-avatar)共用同一套提交→轮询→下载逻辑。
 */
export async function pollArkVideoTask(
  cfg: { baseURL: string; apiKey: string; pollIntervalMs: number; timeoutMs: number },
  taskId: string,
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ video: Buffer; videoUrl: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < cfg.timeoutMs) {
    const statusRes = await fetchImpl(`${cfg.baseURL}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!statusRes.ok) {
      throw new Error(`[laoli-video] poll failed: ${statusRes.status} ${await safeText(statusRes)}`);
    }
    const task = await statusRes.json() as {
      status?: string;
      error?: { message?: string };
      content?: { video_url?: string };
    };
    if (task.status === 'failed') {
      throw new Error(`[laoli-video] task failed: ${task.error?.message || taskId}`);
    }
    if (task.status === 'succeeded') {
      const url = task.content?.video_url;
      if (!url) throw new Error('[laoli-video] succeeded task missing content.video_url');
      const videoRes = await fetchImpl(url);
      if (!videoRes.ok) throw new Error(`[laoli-video] video download failed: ${videoRes.status}`);
      return { video: Buffer.from(await videoRes.arrayBuffer()), videoUrl: url };
    }
    await wait(cfg.pollIntervalMs);
  }
  throw new Error(`[laoli-video] task timeout after ${cfg.timeoutMs}ms`);
}

export function createLaoliVideoProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LaoliVideoProvider {
  const provider = env.LAOLI_VIDEO_PROVIDER || 'mock';
  if (provider === 'mock') return createMockLaoliVideoProvider();
  if (provider === 'doubao') return createDoubaoLaoliVideoProvider(loadDoubaoLaoliVideoConfig(env));
  throw new Error(`[laoli-video] unknown LAOLI_VIDEO_PROVIDER: ${provider}`);
}

export async function generateAndStoreLaoliRawVideo(
  input: LaoliVideoInput,
  deps: { provider: LaoliVideoProvider; storage: CardStorageClient },
): Promise<LaoliRawVideoResult> {
  const generated = await deps.provider.generate(input);
  const key = buildLaoliRawVideoKey(input.matchId);
  const url = await deps.storage.put(key, generated.video, generated.contentType);
  return { ...generated, key, url };
}

export function buildLaoliMotionPrompt(): string {
  return [
    '固定同一位半写实插画老李，坐在书桌前面对镜头自然说话。',
    '轻微点头，偶尔抬起搪瓷茶杯，动作克制，镜头稳定缓慢推进。',
    '保持脸、眼镜、衣服、茶杯和背景一致，不出现任何比分文字、标志或额外人物。',
  ].join('');
}

export function toImageDataUri(image: Buffer, contentType: LaoliReferenceImageType): string {
  if (image.length === 0) throw new Error('[laoli-video] reference image empty');
  return `data:${contentType};base64,${image.toString('base64')}`;
}

export function detectReferenceImageType(image: Buffer): LaoliReferenceImageType {
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'image/jpeg';
  }
  throw new Error('[laoli-video] unsupported reference image format');
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safePart(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown').replace(/%2F/gi, '');
}
