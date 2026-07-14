import { describe, expect, it, vi } from 'vitest';
import { createMemoryCardStorage } from '@/lib/api/card-storage';
import {
  buildLaoliFinalVideoKey,
  buildLaoliReviewKey,
  buildLaoliStatusKey,
  laoliVideoEnabled,
  runLaoliVideoPipeline,
} from '@/lib/api/laoli-video-pipeline';
import { pcmToWav, type LaoliTtsProvider } from '@/lib/api/laoli-tts';
import type { LaoliVideoProvider } from '@/lib/api/laoli-video';
import type { LaoliAvatarProvider } from '@/lib/api/laoli-avatar';

const ftypMp4 = (tag: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from(tag)]);

const input = {
  matchId: 'm1',
  match: {
    match: '韩国 2:1 捷克',
    competition: '国际大赛',
    date: '2026-06-12',
    final_score: '2-1',
    events: [{ minute: 80, type: 'goal' as const, team: '韩国', player: '金球员' }],
    stats: { possession: { home: 52, away: 48 } },
  },
  reports: {},
  referenceImage: Buffer.from([0xff, 0xd8, 0xff]),
  referenceImageType: 'image/jpeg' as const,
};

describe('laoli video pipeline', () => {
  it('stores final, status and pending-review objects and emits no auto-publish state', async () => {
    const storage = createMemoryCardStorage();
    const ttsProvider: LaoliTtsProvider = {
      name: 'mock',
      synthesize: async () => ({
        audio: Buffer.from('wav'),
        contentType: 'audio/wav',
        sampleRate: 24000,
        provider: 'mock',
        voice: 'mock',
      }),
    };
    const videoProvider: LaoliVideoProvider = {
      name: 'mock',
      generate: async () => ({
        video: Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom')]),
        contentType: 'video/mp4',
        provider: 'mock',
      }),
    };
    const result = await runLaoliVideoPipeline(input, {
      storage,
      ttsProvider,
      videoProvider,
      compose: async () => ({ video: Buffer.from('final'), degraded: false, durationSec: 35 }),
    });
    expect(result.finalKey).toBe(buildLaoliFinalVideoKey('m1'));
    expect(await storage.getBytes?.(result.finalKey)).toEqual(Buffer.from('final'));
    const review = JSON.parse(String(await storage.getBytes?.(buildLaoliReviewKey('m1'))));
    expect(review).toMatchObject({
      reviewStatus: 'pending',
      publishStatus: 'blocked_until_approved',
      aigcLabel: 'AI生成内容',
    });
    expect(await storage.getBytes?.(buildLaoliStatusKey('m1'))).not.toBeNull();
  });

  it('falls back to silence and static dynamic graphics when TTS and Seedance fail', async () => {
    const storage = createMemoryCardStorage();
    const compose = vi.fn(async (_script, assets: { rawVideo?: Buffer; ttsAudio: Buffer }) => ({
      video: Buffer.from('fallback'),
      degraded: true,
      durationSec: 35,
      received: assets,
    }));
    const result = await runLaoliVideoPipeline(input, {
      storage,
      ttsProvider: { name: 'volc', synthesize: async () => { throw new Error('tts down'); } },
      videoProvider: { name: 'doubao', generate: async () => { throw new Error('seedance down'); } },
      compose,
    });
    expect(result.degraded).toBe(true);
    expect(result.warnings.join(' ')).toContain('tts down');
    expect(result.warnings.join(' ')).toContain('seedance down');
    expect(compose).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      rawVideo: undefined,
      ttsAudio: expect.any(Buffer),
    }));
  });

  it('routes to the talking-head avatar path and feeds compose lip-sync clips', async () => {
    const storage = createMemoryCardStorage();
    const ttsProvider: LaoliTtsProvider = {
      name: 'mock',
      synthesize: async () => ({
        audio: pcmToWav(Buffer.alloc(2 * 24000 * 2), 24000, 1),
        contentType: 'audio/wav',
        sampleRate: 24000,
        provider: 'mock',
        voice: 'mock',
      }),
    };
    const avatarProvider: LaoliAvatarProvider = {
      name: 'seedance',
      maxClipSec: 15,
      generate: async (i) => ({ video: ftypMp4(`c${i.segmentIndex}`), contentType: 'video/mp4', provider: 'seedance' }),
    };
    const compose = vi.fn(async (_script, assets: { talkingHeadClips?: unknown[]; totalSec?: number }) => ({
      video: Buffer.from('th'),
      degraded: false,
      durationSec: assets.totalSec ?? 35,
    }));
    const result = await runLaoliVideoPipeline(input, {
      storage,
      ttsProvider,
      videoProvider: { name: 'mock', generate: async () => { throw new Error('should not be called'); } },
      avatarProvider,
      transcode: async (wav) => Buffer.from(`mp3:${wav.length}`),
      compose,
      env: { NODE_ENV: 'test', LAOLI_AVATAR_ENABLED: '1' } as NodeJS.ProcessEnv,
    });
    expect(result.provider).toBe('seedance');
    expect(compose).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      talkingHeadClips: expect.arrayContaining([expect.objectContaining({ durationSec: 2 })]),
      totalSec: 6,
    }));
    const assets = compose.mock.calls[0]?.[1] as { talkingHeadClips?: unknown[] };
    expect(assets.talkingHeadClips).toHaveLength(3);
  });

  it('falls back to the dynamic-background path when the avatar pipeline throws', async () => {
    const storage = createMemoryCardStorage();
    const compose = vi.fn(async (_script, assets: { talkingHeadClips?: unknown[]; rawVideo?: Buffer }) => ({
      video: Buffer.from(assets.talkingHeadClips ? 'th' : 'fallback'),
      degraded: !assets.talkingHeadClips,
      durationSec: 35,
    }));
    const result = await runLaoliVideoPipeline(input, {
      storage,
      ttsProvider: { name: 'mock', synthesize: async () => ({ audio: pcmToWav(Buffer.alloc(2400), 24000, 1), contentType: 'audio/wav', sampleRate: 24000, provider: 'mock', voice: 'm' }) },
      videoProvider: { name: 'mock', generate: async () => ({ video: ftypMp4('bg'), contentType: 'video/mp4', provider: 'mock' }) },
      avatarProvider: { name: 'seedance', maxClipSec: 15, generate: async () => { throw new Error('avatar boom'); } },
      transcode: async (wav) => Buffer.from(`mp3:${wav.length}`),
      compose,
      env: { NODE_ENV: 'test', LAOLI_AVATAR_ENABLED: '1' } as NodeJS.ProcessEnv,
    });
    expect(result.warnings.join(' ')).toContain('avatar boom');
    expect(String(await storage.getBytes?.(result.finalKey))).toBe('fallback');
  });

  it('keeps the feature and cost gates disabled by default', () => {
    expect(laoliVideoEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(laoliVideoEnabled({ NODE_ENV: 'test', LAOLI_VIDEO_ENABLED: '1' })).toBe(true);
    expect(buildLaoliFinalVideoKey('a/b')).toBe('laoli-videos/ab/final.mp4');
  });
});
