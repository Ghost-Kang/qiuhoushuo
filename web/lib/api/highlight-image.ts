import type { CardStorageClient } from './card-storage';
import type { HighlightMoment } from './highlight-moments';

// F65(6/12):Seedream 2K PNG 高达 ~7MB,分享卡渲染拉图 8s 必超时 → 全员兜底图。
// 镜头图统一压成 JPEG(最长边 1440,q85,~200KB),key 后缀同步 .jpg。
export type HighlightImageContentType = 'image/jpeg';
export type HighlightImageProviderName = 'mock' | 'doubao';

export interface HighlightImageMomentInput {
  id: string;
  title: string;
  description: string;
  image_prompt: string;
  minute?: string;
}

export interface HighlightImageInput {
  matchId: string;
  moment: HighlightImageMomentInput;
}

export interface HighlightImageProviderOutput {
  image: Buffer;
  contentType: HighlightImageContentType;
  prompt: string;
}

export interface HighlightImageProvider {
  name: HighlightImageProviderName;
  generate(input: HighlightImageInput): Promise<HighlightImageProviderOutput>;
}

export interface DoubaoHighlightImageConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  size: string;
  watermark: boolean;
  timeoutMs: number;
}

export interface HighlightImageResult {
  key: string;
  url: string;
  provider: HighlightImageProviderName;
  contentType: HighlightImageContentType;
  prompt: string;
}

export function buildHighlightImageKey(input: { matchId: string; momentId: string }): string {
  return `highlight-images/${safePathPart(input.matchId)}/${safePathPart(input.momentId)}.jpg`;
}

export function toHighlightImageInput(matchId: string, moment: HighlightMoment): HighlightImageInput {
  return {
    matchId,
    moment: {
      id: moment.id,
      title: moment.title,
      description: moment.description,
      image_prompt: moment.image_prompt,
      minute: moment.minute,
    },
  };
}

export function createMockHighlightImageProvider(): HighlightImageProvider {
  return {
    name: 'mock',
    async generate(input) {
      const prompt = buildPrompt(input);
      return {
        image: MOCK_JPEG,
        contentType: 'image/jpeg',
        prompt,
      };
    },
  };
}

export function loadDoubaoHighlightImageConfig(env: NodeJS.ProcessEnv = process.env): DoubaoHighlightImageConfig {
  const apiKey = env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error('[highlight-image] DOUBAO_API_KEY missing');
  return {
    apiKey,
    baseURL: (env.DOUBAO_IMAGE_BASE_URL || env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    model: env.DOUBAO_IMAGE_MODEL || 'doubao-seedream-4-0-250828',
    size: env.DOUBAO_IMAGE_SIZE || '2K',
    watermark: env.DOUBAO_IMAGE_WATERMARK !== '0',
    timeoutMs: parsePositiveInt(env.DOUBAO_IMAGE_TIMEOUT_MS, 90_000),
  };
}

export function createDoubaoHighlightImageProvider(
  cfg: DoubaoHighlightImageConfig = loadDoubaoHighlightImageConfig(),
  fetchImpl: typeof fetch = fetch,
): HighlightImageProvider {
  return {
    name: 'doubao',
    async generate(input) {
      const prompt = buildPrompt(input);
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
            size: cfg.size,
            sequential_image_generation: 'disabled',
            stream: false,
            response_format: 'url',
            watermark: cfg.watermark,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`[highlight-image] doubao generation failed: ${res.status} ${await safeText(res)}`);
        }
        const payload = await res.json();
        const image = await imageFromDoubaoPayload(payload, fetchImpl, controller.signal);
        return { image, contentType: 'image/jpeg', prompt };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          throw new Error(`[highlight-image] doubao generation timeout after ${cfg.timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createHighlightImageProviderFromEnv(env: NodeJS.ProcessEnv = process.env): HighlightImageProvider {
  const provider = env.HIGHLIGHT_IMAGE_PROVIDER || 'mock';
  if (provider === 'mock') return createMockHighlightImageProvider();
  if (provider === 'doubao') return createDoubaoHighlightImageProvider(loadDoubaoHighlightImageConfig(env));
  throw new Error(`[highlight-image] unknown HIGHLIGHT_IMAGE_PROVIDER: ${provider}`);
}

export async function generateHighlightImage(
  input: HighlightImageInput,
  deps: { provider: HighlightImageProvider; storage: CardStorageClient },
): Promise<HighlightImageResult> {
  const generated = await deps.provider.generate(input);
  const key = buildHighlightImageKey({ matchId: input.matchId, momentId: input.moment.id });
  const url = await deps.storage.put(key, generated.image, generated.contentType);
  return {
    key,
    url,
    provider: deps.provider.name,
    contentType: generated.contentType,
    prompt: generated.prompt,
  };
}

function buildPrompt(input: HighlightImageInput): string {
  const minute = input.moment.minute ? `${input.moment.minute}，` : '';
  return `${minute}${input.moment.title}。${input.moment.description}。${input.moment.image_prompt}`;
}

function safePathPart(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown').replace(/%2F/gi, '');
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function imageFromDoubaoPayload(payload: unknown, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  const first = (payload as { data?: Array<{ url?: string; b64_json?: string }> })?.data?.[0];
  if (!first) throw new Error('[highlight-image] doubao response missing data[0]');
  if (first.b64_json) {
    const buf = Buffer.from(first.b64_json, 'base64');
    return toCardJpeg(buf);
  }
  if (!first.url) throw new Error('[highlight-image] doubao response missing data[0].url');
  const imageRes = await fetchImpl(first.url, { signal });
  if (!imageRes.ok) {
    throw new Error(`[highlight-image] doubao image download failed: ${imageRes.status} ${await safeText(imageRes)}`);
  }
  const buf = Buffer.from(await imageRes.arrayBuffer());
  return toCardJpeg(buf);
}

/** 压到分享卡/小程序实际需要的尺寸与体积(F65:控制 CDN 拉取耗时在 1s 量级)。 */
async function toCardJpeg(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return await sharp(buf).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

const MOCK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);
