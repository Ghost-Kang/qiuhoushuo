import { describe, expect, it, vi } from 'vitest';
import {
  buildLaoliLipsyncPrompt,
  clampSeedanceDuration,
  createLaoliAvatarProviderFromEnv,
  createSeedanceAvatarProvider,
} from '@/lib/api/laoli-avatar';
import { toImageDataUri } from '@/lib/api/laoli-video';

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'test', ...values }) as NodeJS.ProcessEnv;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const cfg = {
  apiKey: 'key',
  baseURL: 'https://ark.example/api/v3',
  model: 'doubao-seedance-2-0-260128',
  pollIntervalMs: 1,
  timeoutMs: 1000,
};

describe('seedance audio-driven avatar', () => {
  it('clamps clip duration into the 4..15s Seedance window', () => {
    expect(clampSeedanceDuration(1)).toBe(4);
    expect(clampSeedanceDuration(11.2)).toBe(12);
    expect(clampSeedanceDuration(99)).toBe(15);
    expect(clampSeedanceDuration(NaN)).toBe(4);
  });

  it('submits image+audio content for lip-sync and downloads the clip', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let polls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/contents/generations/tasks')) return Response.json({ id: 'task-a' });
      if (String(url).endsWith('/task-a')) {
        polls += 1;
        return Response.json(polls < 2
          ? { status: 'running' }
          : { status: 'succeeded', content: { video_url: 'https://cdn.example/clip.mp4' } });
      }
      return new Response(Buffer.from('clip'), { status: 200 });
    }) as typeof fetch;
    const provider = createSeedanceAvatarProvider(cfg, fetchImpl, async () => {});

    const out = await provider.generate({
      matchId: 'm1',
      segmentIndex: 1,
      referenceImage: png,
      referenceImageType: 'image/png',
      audioUrl: 'https://cdn.example/chunk1.mp3',
      audioDurationSec: 11,
    });

    expect(out.video.toString()).toBe('clip');
    expect(out.provider).toBe('seedance');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      ratio: '9:16',
      duration: 11,
      resolution: '720p',
      watermark: true,
      generate_audio: false,
    });
    expect(body.content[0]).toMatchObject({ type: 'text', text: buildLaoliLipsyncPrompt() });
    // 音频驱动:图片标 reference_image(与 audio reference media 同类共存),不能用 first_frame
    expect(body.content[1]).toMatchObject({
      type: 'image_url',
      role: 'reference_image',
      image_url: { url: toImageDataUri(png, 'image/png') },
    });
    expect(body.content[2]).toMatchObject({
      type: 'audio_url',
      role: 'reference_audio', // reference media 模式音频须标此 role
      audio_url: { url: 'https://cdn.example/chunk1.mp3' },
    });
  });

  it('requires a reference image and audio url', async () => {
    const provider = createSeedanceAvatarProvider(cfg, vi.fn() as unknown as typeof fetch, async () => {});
    await expect(provider.generate({
      matchId: 'm1', segmentIndex: 0, audioUrl: 'https://cdn.example/a.mp3', audioDurationSec: 5,
    })).rejects.toThrow('seedance requires referenceImage');
    await expect(provider.generate({
      matchId: 'm1', segmentIndex: 0, referenceImage: png, referenceImageType: 'image/png',
      audioUrl: '', audioDurationSec: 5,
    })).rejects.toThrow('seedance requires audioUrl');
  });
});

describe('avatar provider from env', () => {
  it('defaults to mock and selects seedance', () => {
    expect(createLaoliAvatarProviderFromEnv(env({})).name).toBe('mock');
    expect(createLaoliAvatarProviderFromEnv(env({ LAOLI_AVATAR_PROVIDER: 'seedance', DOUBAO_API_KEY: 'k' })).name)
      .toBe('seedance');
  });

  it('selects omnihuman when its credentials are present', () => {
    const provider = createLaoliAvatarProviderFromEnv(env({
      LAOLI_AVATAR_PROVIDER: 'omnihuman',
      OMNIHUMAN_ACCESS_KEY: 'ak',
      OMNIHUMAN_SECRET_KEY: 'sk',
    }));
    expect(provider.name).toBe('omnihuman');
    expect(provider.maxClipSec).toBe(15); // 官方建议音频≤15s,超 15s 结构衰退
  });

  it('rejects unknown providers', () => {
    expect(() => createLaoliAvatarProviderFromEnv(env({ LAOLI_AVATAR_PROVIDER: 'nope' })))
      .toThrow('unknown LAOLI_AVATAR_PROVIDER');
  });
});
