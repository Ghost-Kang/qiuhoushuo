import { randomUUID } from 'node:crypto';

export type LaoliTtsProviderName = 'mock' | 'volc' | 'volc-v3';

export interface LaoliTtsInput {
  text: string;
  voice?: string;
}

export interface LaoliTtsOutput {
  audio: Buffer;
  contentType: 'audio/wav' | 'audio/mpeg';
  sampleRate: number;
  provider: LaoliTtsProviderName;
  voice: string;
}

export interface LaoliTtsProvider {
  name: LaoliTtsProviderName;
  synthesize(input: LaoliTtsInput): Promise<LaoliTtsOutput>;
}

export interface VolcLaoliTtsConfig {
  appId: string;
  accessToken: string;
  secretKey: string;
  endpoint: string;
  resourceId: string;
  cluster: string;
  voice: string;
  model: string;
  timeoutMs: number;
}

export function createMockLaoliTtsProvider(): LaoliTtsProvider {
  return {
    name: 'mock',
    async synthesize(input) {
      const seconds = Math.max(1, Math.min(35, Math.ceil(input.text.length / 5)));
      return {
        audio: pcmToWav(Buffer.alloc(seconds * 24000 * 2), 24000, 1),
        contentType: 'audio/wav',
        sampleRate: 24000,
        provider: 'mock',
        voice: input.voice || 'mock-laoli',
      };
    },
  };
}

export function loadVolcLaoliTtsConfig(env: NodeJS.ProcessEnv = process.env): VolcLaoliTtsConfig {
  const appId = env.VOLC_TTS_APP_ID;
  const accessToken = env.VOLC_TTS_ACCESS_TOKEN;
  const secretKey = env.VOLC_TTS_SECRET_KEY;
  const resourceId = env.VOLC_TTS_RESOURCE_ID;
  if (!appId || !accessToken || !secretKey || !resourceId) {
    throw new Error(
      '[laoli-tts] VOLC_TTS_APP_ID / VOLC_TTS_ACCESS_TOKEN / VOLC_TTS_SECRET_KEY / VOLC_TTS_RESOURCE_ID missing',
    );
  }
  return {
    appId,
    accessToken,
    secretKey,
    resourceId,
    endpoint: env.VOLC_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v1/tts',
    cluster: env.VOLC_TTS_CLUSTER || 'volcano_tts',
    voice: env.VOLC_TTS_VOICE || 'zh_male_yunzhou_jupiter_bigtts',
    model: env.VOLC_TTS_MODEL || '1.2.1.1',
    timeoutMs: positiveInt(env.VOLC_TTS_TIMEOUT_MS, 60_000),
  };
}

export function createVolcLaoliTtsProvider(
  cfg: VolcLaoliTtsConfig = loadVolcLaoliTtsConfig(),
  fetchImpl: typeof fetch = fetch,
): LaoliTtsProvider {
  return {
    name: 'volc',
    async synthesize(input) {
      const text = input.text.trim();
      if (!text) throw new Error('[laoli-tts] text empty');
      const voice = input.voice || cfg.voice;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const response = await fetchImpl(cfg.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer;${cfg.accessToken}`,
            'X-Api-App-Id': cfg.appId,
            'X-Api-Access-Key': cfg.secretKey,
            'X-Api-Resource-Id': cfg.resourceId,
          },
          body: JSON.stringify({
            app: {
              appid: cfg.appId,
              token: cfg.accessToken,
              cluster: cfg.cluster,
            },
            user: { uid: `laoli-${randomUUID()}` },
            audio: {
              voice_type: voice,
              encoding: 'wav',
              speed_ratio: 1,
              extra_param: JSON.stringify({
                model: cfg.model,
                aigc_metadata: { enable: true },
              }),
            },
            request: {
              reqid: randomUUID(),
              text,
              operation: 'query',
            },
          }),
        });
        if (!response.ok) {
          throw new Error(`[laoli-tts] request failed: ${response.status} ${await safeText(response)}`);
        }
        const payload = await response.json() as Record<string, unknown>;
        const base64 = extractAudioBase64(payload);
        if (!base64) throw new Error('[laoli-tts] response missing base64 audio');
        const audio = Buffer.from(base64, 'base64');
        if (audio.length === 0) throw new Error('[laoli-tts] response audio empty');
        return {
          audio: isWav(audio) ? audio : pcmToWav(audio, 24000, 1),
          contentType: 'audio/wav',
          sampleRate: 24000,
          provider: 'volc',
          voice,
        };
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new Error(`[laoli-tts] timeout after ${cfg.timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// --- 豆包大模型语音合成 2.0（seed-tts-2.0）v3 非流式 HTTP ---
// 实证(2026-06-22 生产容器跑通):账号开通的是 seed-tts-2.0,v1 /api/v1/tts 未授权;
// 必须走 v3 /api/v3/tts/unidirectional + 旧版鉴权(X-Api-App-Id + X-Api-Access-Key + X-Api-Resource-Id),
// 音色限 *_uranus_bigtts 家族(老李=渊博小叔),响应为流式 JSON 分块,正则抽 data base64 拼接成 mp3。
export interface VolcV3LaoliTtsConfig {
  appId: string;
  accessToken: string;
  resourceId: string;
  endpoint: string;
  voice: string;
  format: 'mp3';
  sampleRate: number;
  timeoutMs: number;
}

export function loadVolcV3LaoliTtsConfig(env: NodeJS.ProcessEnv = process.env): VolcV3LaoliTtsConfig {
  const appId = env.VOLC_TTS_APP_ID;
  const accessToken = env.VOLC_TTS_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    throw new Error('[laoli-tts] VOLC_TTS_APP_ID / VOLC_TTS_ACCESS_TOKEN missing');
  }
  return {
    appId,
    accessToken,
    resourceId: env.VOLC_TTS_RESOURCE_ID || 'seed-tts-2.0',
    endpoint: env.VOLC_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
    voice: env.VOLC_TTS_VOICE || 'zh_male_yuanboxiaoshu_uranus_bigtts',
    format: 'mp3',
    sampleRate: positiveInt(env.VOLC_TTS_SAMPLE_RATE, 24000),
    timeoutMs: positiveInt(env.VOLC_TTS_TIMEOUT_MS, 60_000),
  };
}

/** v3 unidirectional 返回流式 JSON 分块;抽取所有 "data":"<base64>" 拼接解码成音频字节。 */
export function extractStreamedTtsAudio(body: string): Buffer {
  const parts: Buffer[] = [];
  for (const match of body.matchAll(/"data"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) {
    if (match[1]) parts.push(Buffer.from(match[1], 'base64'));
  }
  return Buffer.concat(parts);
}

export function createVolcV3LaoliTtsProvider(
  cfg: VolcV3LaoliTtsConfig = loadVolcV3LaoliTtsConfig(),
  fetchImpl: typeof fetch = fetch,
): LaoliTtsProvider {
  return {
    name: 'volc-v3',
    async synthesize(input) {
      const text = input.text.trim();
      if (!text) throw new Error('[laoli-tts] text empty');
      const voice = input.voice || cfg.voice;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const response = await fetchImpl(cfg.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Api-App-Id': cfg.appId,
            'X-Api-Access-Key': cfg.accessToken,
            'X-Api-Resource-Id': cfg.resourceId,
          },
          body: JSON.stringify({
            user: { uid: `laoli-${randomUUID()}` },
            req_params: {
              text,
              speaker: voice,
              audio_params: { format: cfg.format, sample_rate: cfg.sampleRate },
            },
          }),
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new Error(`[laoli-tts] v3 request failed: ${response.status} ${raw.slice(0, 200)}`);
        }
        const audio = extractStreamedTtsAudio(raw);
        if (audio.length === 0) {
          throw new Error(`[laoli-tts] v3 response missing audio: ${raw.slice(0, 200)}`);
        }
        return { audio, contentType: 'audio/mpeg', sampleRate: cfg.sampleRate, provider: 'volc-v3', voice };
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new Error(`[laoli-tts] v3 timeout after ${cfg.timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createLaoliTtsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LaoliTtsProvider {
  const name = env.LAOLI_TTS_PROVIDER || 'mock';
  if (name === 'mock') return createMockLaoliTtsProvider();
  if (name === 'volc') return createVolcLaoliTtsProvider(loadVolcLaoliTtsConfig(env));
  if (name === 'volc-v3') return createVolcV3LaoliTtsProvider(loadVolcV3LaoliTtsConfig(env));
  throw new Error(`[laoli-tts] unknown LAOLI_TTS_PROVIDER: ${name}`);
}

export function extractAudioBase64(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.data,
    payload.audio,
    payload.audio_data,
    isRecord(payload.result) ? payload.result.audio : undefined,
    isRecord(payload.result) ? payload.result.data : undefined,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
    }
  }
  return null;
}

export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWav(value: Buffer): boolean {
  return value.length >= 12
    && value.subarray(0, 4).toString() === 'RIFF'
    && value.subarray(8, 12).toString() === 'WAVE';
}

async function safeText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 300); } catch { return ''; }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
