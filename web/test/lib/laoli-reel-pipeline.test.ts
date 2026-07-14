import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLaoliReelPipeline, startLaoliReelDetached, type LaoliReelPipelineDeps } from '@/lib/api/laoli-reel-pipeline';
import type { CardStorageClient } from '@/lib/api/card-storage';
import type { LaoliTtsProvider } from '@/lib/api/laoli-tts';
import type { LaoliAvatarProvider } from '@/lib/api/laoli-avatar';

const match = {
  match: '约旦 1:3 阿根廷',
  competition: '国际大赛',
  date: '2026-06-28',
  final_score: '1-3',
  events: [{ minute: 32, type: 'goal' as const, team: '阿根廷', player: '梅西' }],
  stats: { possession: { home: 27, away: 73 }, shots_on_target: { home: 3, away: 9 } },
};
const reports = { duanzi: { style: 'duanzi' as const, share_quote: '梅西打卡进球', title: 't', subtitle: 's', lead: 'l' } };

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from('x')]);

function fakeStorage(puts: Array<{ key: string; body: Buffer }>): CardStorageClient {
  return {
    put: async (key: string, body: Buffer) => { puts.push({ key, body }); return `https://img.qiuhoushuo.cn/${key}`; },
    exists: async () => false,
    getBytes: async (k: string) => (k.includes('brief') ? Buffer.from('BRIEF') : null),
  } as unknown as CardStorageClient;
}
const tts: LaoliTtsProvider = {
  name: 'volc-v3',
  synthesize: async () => ({ audio: Buffer.from('mp3'), contentType: 'audio/mpeg', sampleRate: 24000, provider: 'volc-v3', voice: 'v' }),
};
const avatar: LaoliAvatarProvider = {
  name: 'seedance', maxClipSec: 15,
  generate: async () => ({ video: MP4, contentType: 'video/mp4', provider: 'seedance', taskId: 't' }),
};
const refFetch = (async (url: unknown) =>
  String(url).includes('/api/card')
    ? new Response('no', { status: 404 })
    : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;

function baseDeps(puts: Array<{ key: string; body: Buffer }>, over: Partial<LaoliReelPipelineDeps> = {}): LaoliReelPipelineDeps {
  return {
    storage: fakeStorage(puts), ttsProvider: tts, avatarProvider: avatar,
    refImageUrl: 'https://qiuhoushuo.com/persona/laoli-ref.png', reportId: 'rep1',
    fetchImpl: refFetch, ffprobe: async () => 7,
    loadBgm: async () => undefined, // 默认关(hermetic·不读真文件);单独用例覆盖成有乐
    composeReel: async (input) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }),
    ...over,
  };
}

afterEach(() => {
  delete process.env.LAOLI_REEL_ARC_STRICT;
  delete process.env.LAOLI_REEL_STORY;
  delete process.env.LAOLI_REEL_ARC;
});

describe('runLaoliReelPipeline（抖音版式·去老李 PiP·0 seedance）', () => {
  it('默认:4 段卡片轮播 + 合成 → final + status(completed/reel) + review(pending);avatarProvider 零调用', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const genSpy = vi.fn(async () => ({ video: MP4, contentType: 'video/mp4' as const, provider: 'seedance', taskId: 't' }));
    const composeReel = vi.fn(async (input: { scenes: unknown[]; banner?: Buffer; totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    const r = await runLaoliReelPipeline({ matchId: 'm1', match, reports }, baseDeps(puts, {
      avatarProvider: { name: 'seedance', maxClipSec: 15, generate: genSpy } as unknown as LaoliReelPipelineDeps['avatarProvider'],
      composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
    }));
    // 无注入 LLM + 无 key → 旁白回退确定性模板;降级不再静默(NARRATION-REDESIGN 裁决#9):
    // generationMode=template、fallbackReason=llm_unavailable、degraded=true。
    expect(r.degraded).toBe(true);
    expect(r.generationMode).toBe('template');
    expect(r.fallbackReason).toBe('llm_unavailable');
    expect(r.finalUrl).toContain('final.mp4');
    expect(r.durationSec).toBe(28); // 4×7s(模板四拍)
    expect(genSpy).toHaveBeenCalledTimes(0); // 关键:一段 seedance 都没烧
    // 合成入参:4 段卡片 + 顶部钩子 banner(Buffer)
    const arg = composeReel.mock.calls[0]![0];
    expect(arg.scenes).toHaveLength(4);
    expect(arg.banner).toBeInstanceOf(Buffer);
    // status completed / review pending 已落;降级可观测(generationMode/fallbackReason)
    const status = JSON.parse(String(puts.find((p) => p.key.includes('status'))!.body));
    expect(status).toMatchObject({ state: 'completed', mode: 'reel', degraded: true, generationMode: 'template', fallbackReason: 'llm_unavailable' });
    const review = JSON.parse(String(puts.find((p) => p.key.includes('review'))!.body));
    expect(review).toMatchObject({ reviewStatus: 'pending', publishStatus: 'blocked_until_approved' });
  }, 20000);

  it('六拍弧命中:注入合规 arc LLM → generationMode=arc、degraded=false、七拍→合成', async () => {
    // pipeline 最小 match 的 envelope: f1 比分 / f2 进球 / f3 控球 / f4 射正。arc 输出仅引用真实 fact、无编造数字。
    const arcOk = {
      hook: '梅西这场值不值',
      question: { text: '梅西这场踢得到底值不值这个身价？', evidence_ids: ['f1'] },
      drama: [{ text: '阿根廷全场把控着节奏，对手没脾气。', evidence_ids: ['f3'] }],
      answer: [{ text: '关键那一下，还是他先站出来了。', evidence_ids: ['f2'] }],
      debate: { text: '你觉得这场谁更值得夸？', evidence_ids: ['f4'] },
    };
    const arcLlm = (async () => ({ content: JSON.stringify(arcOk), provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } })) as unknown as LaoliReelPipelineDeps['storyLlm'];
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { scenes: unknown[]; totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    const r = await runLaoliReelPipeline({ matchId: 'marc', match, reports }, baseDeps(puts, {
      storyLlm: arcLlm,
      composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
    }));
    expect(r.generationMode).toBe('arc');
    expect(r.degraded).toBe(false);
    expect(r.fallbackReason).toBeUndefined();
    expect(composeReel.mock.calls[0]![0].scenes).toHaveLength(5); // question+turn+answer+debate+cta
    const status = JSON.parse(String(puts.find((p) => p.key.includes('status'))!.body));
    expect(status).toMatchObject({ degraded: false, generationMode: 'arc' });
  }, 20000);

  it('背景乐:loadBgm 返回 Buffer → 透传给 composeReel(input.bgm)', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { totalSec: number; bgm?: Buffer }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    await runLaoliReelPipeline({ matchId: 'm1', match, reports }, baseDeps(puts, {
      loadBgm: async () => Buffer.from('BGM-LOADED'),
      composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
    }));
    expect(composeReel.mock.calls[0]![0].bgm?.toString()).toBe('BGM-LOADED');
  }, 20000);

  it('coverImage:首场景(intro)背景用封面照,其余场景仍用数据卡', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { scenes: Array<{ background: Buffer; bgExt: string }>; totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    await runLaoliReelPipeline({ matchId: 'm1', match, reports, coverImage: Buffer.from('COVER-PHOTO') }, baseDeps(puts, {
      composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
    }));
    const arg = composeReel.mock.calls[0]![0];
    expect(arg.scenes[0]!.background.toString()).toBe('COVER-PHOTO'); // 首帧=封面照(卡槽)
    expect(arg.scenes[0]!.bgExt).toBe('png');
    expect(arg.scenes[1]!.background.toString()).not.toBe('COVER-PHOTO'); // 其余=数据卡/兜底
  }, 20000);

  it('strict arc-only:arc 返回 null → 硬失败抛错,不产降级(不 lean·不写 final·不合成)', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    // 注入让 arc 失败的 LLM(非法 JSON → buildLaoliReelArcScript 内部 catch 返回 null)。
    const badLlm = (async () => ({ content: 'not json at all', provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } })) as unknown as LaoliReelPipelineDeps['storyLlm'];
    const fallbackLean = vi.fn(async () => ({ matchId: 'mstrict', finalKey: 'f', finalUrl: 'u', statusKey: 's', reviewKey: 'rv', provider: 'seedance', bytes: 9, durationMs: 1, narration: 'n' }));
    const composeReel = vi.fn(async (input: { totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    await expect(
      runLaoliReelPipeline({ matchId: 'mstrict', match, reports, strictArc: true }, baseDeps(puts, {
        storyLlm: badLlm,
        fallbackLean: fallbackLean as unknown as LaoliReelPipelineDeps['fallbackLean'],
        composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
      })),
    ).rejects.toThrow('arc_unavailable');
    expect(fallbackLean).not.toHaveBeenCalled(); // strict:绝不 lean 兜底
    expect(composeReel).not.toHaveBeenCalled();  // 不合成
    expect(puts.find((p) => p.key.includes('final'))).toBeUndefined(); // 不写 final
    expect(puts.find((p) => p.key.includes('status'))).toBeUndefined(); // 本函数不写 status(detached 层写 failed)
  }, 20000);

  it('strict via env(LAOLI_REEL_ARC_STRICT=1):arc null → 同样硬失败抛错', async () => {
    process.env.LAOLI_REEL_ARC_STRICT = '1';
    const puts: Array<{ key: string; body: Buffer }> = [];
    const badLlm = (async () => ({ content: '{bad', provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } })) as unknown as LaoliReelPipelineDeps['storyLlm'];
    await expect(
      runLaoliReelPipeline({ matchId: 'menv', match, reports }, baseDeps(puts, { storyLlm: badLlm })),
    ).rejects.toThrow('arc_unavailable');
  }, 20000);

  it('非 strict:arc 返回 null → 照旧三级回退出片(不抛·手动调试用·不回归)', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const badLlm = (async () => ({ content: 'not json', provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } })) as unknown as LaoliReelPipelineDeps['storyLlm'];
    const composeReel = vi.fn(async (input: { totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    const r = await runLaoliReelPipeline({ matchId: 'mnostrict', match, reports }, baseDeps(puts, {
      storyLlm: badLlm, // arc+story 都 null → template
      composeReel: composeReel as unknown as LaoliReelPipelineDeps['composeReel'],
    }));
    expect(composeReel).toHaveBeenCalled();
    expect(r.finalUrl).toContain('final.mp4');
    expect(r.generationMode).toBe('template'); // 三级回退到确定性模板
    expect(r.degraded).toBe(true);
  }, 20000);

  it('硬失败(合成抛)→ 回退 lean、标 degraded+fallback', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const fallbackLean = vi.fn(async () => ({
      matchId: 'm1', finalKey: 'laoli-videos/m1/final.mp4', finalUrl: 'https://x/final.mp4',
      statusKey: 's', reviewKey: 'rv', provider: 'seedance', bytes: 9, durationMs: 1, narration: 'n',
    }));
    const r = await runLaoliReelPipeline(
      { matchId: 'm1', match, reports },
      baseDeps(puts, {
        composeReel: async () => { throw new Error('ffmpeg ENOENT'); },
        fallbackLean: fallbackLean as unknown as LaoliReelPipelineDeps['fallbackLean'],
      }),
    );
    expect(fallbackLean).toHaveBeenCalledOnce();
    expect(r.degraded).toBe(true);
    expect(r.fallback).toBe('lean');
  });
});

describe('startLaoliReelDetached', () => {
  it('单飞锁:占用中第二次 accepted=false(同步断言·锁在 add 后立即生效)', () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const deps = baseDeps(puts); // 后台 pipeline 会跑完(fakes 快),a/b 同步检查锁
    const a = startLaoliReelDetached({ matchId: 'mlock', match, reports }, deps);
    const b = startLaoliReelDetached({ matchId: 'mlock', match, reports }, deps);
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(false);
    expect(a.statusKey).toContain('mlock');
  });
});
