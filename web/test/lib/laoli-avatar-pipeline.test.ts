import { describe, expect, it, vi } from 'vitest';
import { createMemoryCardStorage } from '@/lib/api/card-storage';
import type { LaoliAvatarInput, LaoliAvatarProvider } from '@/lib/api/laoli-avatar';
import {
  buildLaoliTalkingHead,
  buildLaoliTalkingHeadRawKey,
} from '@/lib/api/laoli-avatar-pipeline';
import { buildLaoliChunkAudioKey, wavDurationSec } from '@/lib/api/laoli-audio';
import { pcmToWav, type LaoliTtsProvider } from '@/lib/api/laoli-tts';
import { buildLaoliVideoScript } from '@/lib/api/laoli-video-script';

const mp4 = (tag: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from(tag)]);
const match = {
  match: '韩国 2:1 捷克',
  competition: '国际大赛',
  date: '2026-06-12',
  final_score: '2-1',
  events: [{ minute: 80, type: 'goal' as const, team: '韩国', player: '金球员' }],
  stats: { possession: { home: 52, away: 48 } },
};
const script = buildLaoliVideoScript(match, {}, { matchId: 'm1' });

const twoSecWavTts: LaoliTtsProvider = {
  name: 'mock',
  synthesize: async () => ({
    audio: pcmToWav(Buffer.alloc(2 * 24000 * 2), 24000, 1),
    contentType: 'audio/wav',
    sampleRate: 24000,
    provider: 'mock',
    voice: 'mock',
  }),
};

const fakeAvatar = (name: LaoliAvatarProvider['name'], maxClipSec: number) => {
  const calls: LaoliAvatarInput[] = [];
  const provider: LaoliAvatarProvider = {
    name,
    maxClipSec,
    generate: async (inp) => {
      calls.push(inp);
      return { video: mp4(`c${inp.segmentIndex}`), contentType: 'video/mp4', provider: name, taskId: `t${inp.segmentIndex}` };
    },
  };
  return { provider, calls };
};

describe('buildLaoliTalkingHead', () => {
  it('chunks narration, lays clips back-to-back and concatenates one narration track', async () => {
    const storage = createMemoryCardStorage();
    const { provider, calls } = fakeAvatar('seedance', 15);
    const transcode = vi.fn(async (wav: Buffer) => Buffer.from(`mp3:${wav.length}`));

    const result = await buildLaoliTalkingHead({
      matchId: 'm1',
      script,
      referenceImage: Buffer.from([0xff, 0xd8, 0xff]),
      referenceImageType: 'image/jpeg',
    }, { storage, ttsProvider: twoSecWavTts, avatarProvider: provider, transcode });

    // 5 段脚本在 14s 上限下并成 3 段对口型
    expect(result.clips).toHaveLength(3);
    expect(result.provider).toBe('seedance');
    expect(result.clips.map((clip) => clip.startSec)).toEqual([0, 2, 4]);
    expect(result.clips.map((clip) => clip.durationSec)).toEqual([2, 2, 2]);
    expect(result.totalSec).toBe(6);
    expect(wavDurationSec(result.narrationAudio)).toBeCloseTo(6, 5);

    // 每段都把公网 mp3 audioUrl 喂给 provider,时长按真实音频钳制
    expect(calls).toHaveLength(3);
    expect(calls[0]?.audioUrl).toBe(`memory://card-storage/${buildLaoliChunkAudioKey('m1', 0)}`);
    expect(calls[0]?.audioDurationSec).toBe(2);
    expect(transcode).toHaveBeenCalledTimes(3);

    // 片段与分段音频都落库
    expect(await storage.getBytes?.(buildLaoliTalkingHeadRawKey('m1', 0))).toEqual(mp4('c0'));
    expect(await storage.getBytes?.(buildLaoliChunkAudioKey('m1', 0))).toEqual(Buffer.from('mp3:96044'));
  });

  it('uploads a public reference image URL for omnihuman', async () => {
    const storage = createMemoryCardStorage();
    const { provider, calls } = fakeAvatar('omnihuman', 30);
    await buildLaoliTalkingHead({
      matchId: 'm1',
      script,
      referenceImage: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      referenceImageType: 'image/png',
    }, { storage, ttsProvider: twoSecWavTts, avatarProvider: provider, transcode: async (w) => w });

    expect(calls[0]?.imageUrl).toBe('memory://card-storage/laoli-videos/m1/ref.png');
  });

  it('falls back to silent narration when a chunk TTS fails but still produces clips', async () => {
    const storage = createMemoryCardStorage();
    const { provider } = fakeAvatar('seedance', 15);
    const flakyTts: LaoliTtsProvider = { name: 'volc', synthesize: async () => { throw new Error('tts boom'); } };
    const result = await buildLaoliTalkingHead({
      matchId: 'm1',
      script,
      referenceImage: Buffer.from([0xff, 0xd8, 0xff]),
      referenceImageType: 'image/jpeg',
    }, { storage, ttsProvider: flakyTts, avatarProvider: provider, transcode: async (w) => w });

    expect(result.clips).toHaveLength(3);
    expect(result.warnings.join(' ')).toContain('tts boom');
    expect(result.totalSec).toBeGreaterThan(0);
  });
});
