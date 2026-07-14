import { describe, expect, it, vi } from 'vitest';
import {
  buildLaoliMotionPrompt,
  buildLaoliRawVideoKey,
  createDoubaoLaoliVideoProvider,
  createLaoliVideoProviderFromEnv,
  detectReferenceImageType,
  generateAndStoreLaoliRawVideo,
  loadDoubaoLaoliVideoConfig,
  toImageDataUri,
} from '@/lib/api/laoli-video';
import { createMemoryCardStorage } from '@/lib/api/card-storage';

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'test', ...values }) as NodeJS.ProcessEnv;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

describe('laoli video provider', () => {
  it('polls twice then downloads video with verified Seedance body and base64 first frame', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let polls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/contents/generations/tasks')) return Response.json({ id: 'task-1' });
      if (String(url).endsWith('/task-1')) {
        polls += 1;
        return Response.json(polls < 3
          ? { status: 'running' }
          : { status: 'succeeded', content: { video_url: 'https://cdn.example/raw.mp4' } });
      }
      return new Response(Buffer.from('mp4'), { status: 200 });
    }) as typeof fetch;
    const wait = vi.fn(async () => {});
    const provider = createDoubaoLaoliVideoProvider({
      apiKey: 'key',
      baseURL: 'https://ark.example/api/v3',
      model: 'doubao-seedance-2-0-260128',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    }, fetchImpl, wait);

    const out = await provider.generate({
      matchId: 'm1',
      referenceImage: jpeg,
      referenceImageType: 'image/jpeg',
      prompt: buildLaoliMotionPrompt(),
    });
    expect(out.video.toString()).toBe('mp4');
    expect(wait).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      ratio: '9:16',
      duration: 4,
      resolution: '720p',
      watermark: true,
      generate_audio: false,
    });
    expect(body.content[1]).toMatchObject({
      type: 'image_url',
      role: 'first_frame',
      image_url: { url: toImageDataUri(jpeg, 'image/jpeg') },
    });
  });

  it('throws on failed tasks so the pipeline can degrade', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/tasks')) return Response.json({ id: 'task-fail' });
      return Response.json({ status: 'failed', error: { message: 'unsafe frame' } });
    }) as typeof fetch;
    const provider = createDoubaoLaoliVideoProvider({
      apiKey: 'key',
      baseURL: 'https://ark.example',
      model: 'model',
      pollIntervalMs: 1,
      timeoutMs: 100,
    }, fetchImpl, async () => {});
    await expect(provider.generate({
      matchId: 'm1',
      referenceImage: jpeg,
      referenceImageType: 'image/jpeg',
      prompt: 'motion',
    })).rejects.toThrow('task failed: unsafe frame');
  });

  it('uses the verified model by default and detects reference image bytes', () => {
    expect(loadDoubaoLaoliVideoConfig(env({ DOUBAO_API_KEY: 'key' })).model)
      .toBe('doubao-seedance-2-0-260128');
    expect(createLaoliVideoProviderFromEnv(env({})).name).toBe('mock');
    expect(detectReferenceImageType(jpeg)).toBe('image/jpeg');
    expect(detectReferenceImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
    expect(() => detectReferenceImageType(Buffer.from('bad'))).toThrow('unsupported');
  });

  it('stores raw video under a deterministic COS key', async () => {
    const storage = createMemoryCardStorage();
    const result = await generateAndStoreLaoliRawVideo({
      matchId: 'match/1',
      referenceImage: jpeg,
      referenceImageType: 'image/jpeg',
      prompt: 'motion',
    }, {
      provider: createLaoliVideoProviderFromEnv(env({})),
      storage,
    });
    expect(result.key).toBe(buildLaoliRawVideoKey('match/1'));
    expect(result.key).toBe('laoli-videos/match1/raw.mp4');
    expect(await storage.getBytes?.(result.key)).toEqual(Buffer.from('mock-laoli-video'));
  });
});
