import { describe, expect, it } from 'vitest';
import { createMemoryCardStorage } from '@/lib/api/card-storage';
import type { LaoliAvatarInput, LaoliAvatarProvider } from '@/lib/api/laoli-avatar';
import type { LaoliTtsProvider } from '@/lib/api/laoli-tts';
import {
  buildLaoliLeanAudioKey,
  estimateNarrationSeconds,
  runLaoliLeanPipeline,
} from '@/lib/api/laoli-lean-pipeline';
import { buildLaoliFinalVideoKey, buildLaoliReviewKey } from '@/lib/api/laoli-video-pipeline';
import { buildLaoliLeanNarration } from '@/lib/api/laoli-video-script';

const match = {
  match: '韩国 2:1 捷克',
  competition: '国际大赛',
  date: '2026-06-12',
  final_score: '2-1',
  events: [{ minute: 80, type: 'goal' as const, team: '韩国', player: '金球员' }],
  stats: { possession: { home: 52, away: 48 } },
};
const reports = {
  hardcore: {
    style: 'hardcore' as const,
    title: '替补席改变走势',
    subtitle: '关键回合效率决定赛果',
    lead: '第80分钟的进球把反超写进了终场比分',
    share_quote: '落后不是结局，换人之后才是正片',
  },
};

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from('x')]);

describe('buildLaoliLeanNarration', () => {
  it('produces one sanitized line within the char cap', () => {
    const line = buildLaoliLeanNarration(match, reports, 70);
    expect(line.length).toBeLessThanOrEqual(70);
    expect(line.startsWith('嚯')).toBe(true);
    expect(line).not.toContain('最'); // sanitizer maps 最→更
    expect(line.endsWith('。')).toBe(true);
  });

  it('still yields a line with no reports (fallback facts)', () => {
    expect(buildLaoliLeanNarration(match, {}).length).toBeGreaterThan(8);
  });
});

describe('estimateNarrationSeconds', () => {
  it('clamps to the 4..15s OmniHuman window', () => {
    expect(estimateNarrationSeconds('短')).toBe(4);
    expect(estimateNarrationSeconds('字'.repeat(45))).toBe(10);
    expect(estimateNarrationSeconds('字'.repeat(200))).toBe(15);
  });
});

describe('runLaoliLeanPipeline', () => {
  it('synthesizes, uploads audio, drives OmniHuman and stores a pending-review final', async () => {
    const storage = createMemoryCardStorage();
    const ttsProvider: LaoliTtsProvider = {
      name: 'volc-v3',
      synthesize: async () => ({ audio: Buffer.from('mp3-bytes'), contentType: 'audio/mpeg', sampleRate: 24000, provider: 'volc-v3', voice: 'zh_male_yuanboxiaoshu_uranus_bigtts' }),
    };
    const calls: LaoliAvatarInput[] = [];
    const avatarProvider: LaoliAvatarProvider = {
      name: 'omnihuman',
      maxClipSec: 15,
      generate: async (i) => { calls.push(i); return { video: mp4, contentType: 'video/mp4', provider: 'omnihuman', taskId: 'oh-1' }; },
    };

    const result = await runLaoliLeanPipeline({ matchId: 'm1', match, reports }, {
      storage,
      ttsProvider,
      avatarProvider,
      refImageUrl: 'https://qiuhoushuo.com/persona/laoli-ref.png',
      prompt: '老李正对镜头说话',
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    expect(result.provider).toBe('omnihuman');
    expect(result.finalKey).toBe(buildLaoliFinalVideoKey('m1'));
    expect(await storage.getBytes?.(result.finalKey)).toEqual(mp4);
    // omnihuman driven by the public image + uploaded audio url (no compose)
    expect(calls[0]?.imageUrl).toBe('https://qiuhoushuo.com/persona/laoli-ref.png');
    expect(calls[0]?.audioUrl).toBe(`memory://card-storage/${buildLaoliLeanAudioKey('m1')}`);
    expect(calls[0]?.prompt).toBe('老李正对镜头说话');
    const review = JSON.parse(String(await storage.getBytes?.(buildLaoliReviewKey('m1'))));
    expect(review).toMatchObject({ reviewStatus: 'pending', publishStatus: 'blocked_until_approved' });
    const status = JSON.parse(String(await storage.getBytes?.(result.statusKey)));
    expect(status).toMatchObject({ mode: 'lean', provider: 'omnihuman', degraded: false, voice: 'zh_male_yuanboxiaoshu_uranus_bigtts' });
  });

  it('seedance:取参考图字节 → 传 referenceImage(Buffer)+referenceImageType 给 provider', async () => {
    const storage = createMemoryCardStorage();
    const ttsProvider: LaoliTtsProvider = {
      name: 'volc-v3',
      synthesize: async () => ({ audio: Buffer.from('mp3'), contentType: 'audio/mpeg', sampleRate: 24000, provider: 'volc-v3', voice: 'v' }),
    };
    const calls: LaoliAvatarInput[] = [];
    const avatarProvider: LaoliAvatarProvider = {
      name: 'seedance',
      maxClipSec: 15,
      generate: async (i) => { calls.push(i); return { video: mp4, contentType: 'video/mp4', provider: 'seedance', taskId: 'sd-1' }; },
    };
    const result = await runLaoliLeanPipeline({ matchId: 'm2', match, reports }, {
      storage,
      ttsProvider,
      avatarProvider,
      refImageUrl: 'https://qiuhoushuo.com/persona/laoli-ref.png',
      fetchImpl: async () => new Response(new Uint8Array([9, 8, 7, 6]), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    expect(result.provider).toBe('seedance');
    expect(Buffer.isBuffer(calls[0]?.referenceImage)).toBe(true);
    expect(calls[0]?.referenceImage?.length).toBe(4);
    expect(calls[0]?.referenceImageType).toBe('image/png');
    expect(calls[0]?.imageUrl).toBe('https://qiuhoushuo.com/persona/laoli-ref.png'); // omnihuman 仍可用
  });

  it('requires a public reference image url', async () => {
    await expect(runLaoliLeanPipeline({ matchId: 'm1', match, reports }, {
      storage: createMemoryCardStorage(),
      ttsProvider: { name: 'mock', synthesize: async () => ({ audio: Buffer.from('a'), contentType: 'audio/mpeg', sampleRate: 24000, provider: 'mock', voice: 'v' }) },
      avatarProvider: { name: 'omnihuman', maxClipSec: 15, generate: async () => { throw new Error('unused'); } },
      refImageUrl: '',
    })).rejects.toThrow('refImageUrl required');
  });
});
