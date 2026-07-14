import { describe, expect, it, vi } from 'vitest';

// 渲染是真 sharp/resvg(冷启动慢,非本单测重点)→ mock 成即时小 buffer
vi.mock('@/lib/api/laoli-reel-subtitle', () => ({
  renderReelSubtitlePng: async () => Buffer.from('SUB'),
  renderReelBannerPng: async () => Buffer.from('BANNER'),
  renderReelWatermarkPng: async () => Buffer.from('WM'),
  renderReelTitleBgPng: async () => Buffer.from('TITLE'),
}));

import { buildLaoliTopicScript } from '@/lib/api/laoli-reel-story';
import { runLaoliTopicPipeline, startLaoliTopicDetached, type LaoliTopicPipelineDeps } from '@/lib/api/laoli-topic-pipeline';
import type { callLLM } from '@/lib/llm';
import type { CardStorageClient } from '@/lib/api/card-storage';
import type { LaoliTtsProvider } from '@/lib/api/laoli-tts';

const facts = '金靴并列领跑:哈兰德7球、姆巴佩7球、梅西7球;凯恩6球紧追;姆巴佩2助攻在三人里占身位。';
const goodTopic = {
  intro: '嚯,金靴这事儿今年悬了。',
  event: '哈兰德、姆巴佩、梅西仨人都7球,谁也不让谁;凯恩6球还在后头盯着。',
  data: '姆巴佩多2助攻先占了身位,你说这金靴该给谁?',
  outro: '给谁都有人不服。',
};
const fakeLlm = (payload: unknown): typeof callLLM =>
  (async () => ({ content: JSON.stringify(payload), provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } }));

describe('buildLaoliTopicScript', () => {
  it('合法话题脚本:4 段 + 话题导流 CTA + 标题', async () => {
    const s = await buildLaoliTopicScript({ title: '金靴之争特辑', facts }, { llm: fakeLlm(goodTopic), matchId: 'topic-gb' });
    expect(s).not.toBeNull();
    expect(s!.scenes).toHaveLength(4);
    expect(s!.title).toContain('金靴之争');   // 标题经 sanitize(商标脱敏)后保留安全部分
    expect(s!.scenes[3]!.narration).toContain('关注老李');   // 站内 CTA(2026-07-08 去微信导流·抖音禁站外)
    expect(s!.scenes[3]!.narration).toContain('想追这条赛道');
    expect(s!.scenes[3]!.narration).not.toContain('微信');   // 站外导流红线:抖音判违规,视频旁白一律不带微信
    // 数字只用了事实里的 7/6/2
    const spoken = s!.scenes.slice(0, 3).map((x) => x.narration).join('');
    expect(spoken).toContain('7球');
  });

  it('旁白出现事实清单外的数字(8球)→ null(防编造)', async () => {
    const bad = { ...goodTopic, data: '有人已经踢进8球了,你说该给谁?' };
    const s = await buildLaoliTopicScript({ title: '金靴', facts }, { llm: fakeLlm(bad) });
    expect(s).toBeNull();
  });

  it('几成/几倍相对量词 → null(方向易错)', async () => {
    const bad = { ...goodTopic, data: '姆巴佩助攻多出几倍,该给谁?' };
    const s = await buildLaoliTopicScript({ title: '金靴', facts }, { llm: fakeLlm(bad) });
    expect(s).toBeNull();
  });

  it('无 llm 且无 key → null(不打网络)', async () => {
    const prev = { d: process.env.DOUBAO_API_KEY, k: process.env.DEEPSEEK_API_KEY };
    delete process.env.DOUBAO_API_KEY; delete process.env.DEEPSEEK_API_KEY;
    const s = await buildLaoliTopicScript({ title: '金靴', facts }, {});
    expect(s).toBeNull();
    if (prev.d) process.env.DOUBAO_API_KEY = prev.d;
    if (prev.k) process.env.DEEPSEEK_API_KEY = prev.k;
  });

  it('空 facts → null', async () => {
    const s = await buildLaoliTopicScript({ title: '金靴', facts: '   ' }, { llm: fakeLlm(goodTopic) });
    expect(s).toBeNull();
  });
});

const tts: LaoliTtsProvider = {
  name: 'volc-v3',
  synthesize: async () => ({ audio: Buffer.from('mp3'), contentType: 'audio/mpeg', sampleRate: 24000, provider: 'volc-v3', voice: 'v' }),
};
function fakeStorage(puts: Array<{ key: string; body: Buffer }>): CardStorageClient {
  return {
    put: async (key: string, body: Buffer) => { puts.push({ key, body }); return `https://img.qiuhoushuo.cn/${key}`; },
    exists: async () => false,
    getBytes: async () => null, // 话题片背景由入参直传,不读 COS(去老李 PiP 后也不再取通用片段)
  } as unknown as CardStorageClient;
}
function baseDeps(puts: Array<{ key: string; body: Buffer }>, over: Partial<LaoliTopicPipelineDeps> = {}): LaoliTopicPipelineDeps {
  return {
    storage: fakeStorage(puts), ttsProvider: tts, ffprobe: async () => 5,
    composeReel: async (input) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }),
    storyLlm: fakeLlm(goodTopic),
    loadBgm: async () => undefined, // 单测默认不读真 mp3(4MB·慢);需验 BGM 的用例单独注入
    ...over,
  };
}

describe('runLaoliTopicPipeline', () => {
  it('话题片:脚本→4段→合成→final + status(mode:topic/completed) + review(pending);去老李 PiP·0 seedance', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { scenes: unknown[]; banner?: Buffer; totalSec: number }) => ({ video: Buffer.from('FINAL'), durationSec: input.totalSec }));
    const r = await runLaoliTopicPipeline(
      { slug: 'golden-boot', title: '金靴之争特辑', facts, backgrounds: [Buffer.from('BG1'), Buffer.from('BG2')] },
      baseDeps(puts, { composeReel: composeReel as unknown as LaoliTopicPipelineDeps['composeReel'] }),
    );
    expect(r.topicId).toBe('topic-golden-boot');
    expect(r.finalKey).toContain('topic-golden-boot/final.mp4');
    expect(r.durationSec).toBe(20); // 4×5s
    const arg = composeReel.mock.calls[0]![0];
    expect(arg.scenes).toHaveLength(4);
    expect(arg.banner).toBeInstanceOf(Buffer);     // 顶部大标题钩子 banner(去老李 PiP)
    // 背景按场景序号循环(2 张 → BG1,BG2,BG1,BG2)
    const scenes = arg.scenes as Array<{ background: Buffer }>;
    expect(scenes[0]!.background.toString()).toBe('BG1');
    expect(scenes[1]!.background.toString()).toBe('BG2');
    expect(scenes[2]!.background.toString()).toBe('BG1');
    // status/review 落库,mode=topic,审核 pending
    const status = JSON.parse(puts.find((p) => p.key.endsWith('status.json'))!.body.toString());
    expect(status.mode).toBe('topic');
    expect(status.state).toBe('completed');
    const review = JSON.parse(puts.find((p) => p.key.endsWith('review.json'))!.body.toString());
    expect(review.reviewStatus).toBe('pending');
  });

  it('显式逐场脚本:跳过 LLM,逐场按 bgIndex 精确配背景 + hook 当 banner', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { scenes: Array<{ background: Buffer }>; banner?: Buffer; totalSec: number; bgm?: Buffer }) => ({ video: Buffer.from('F'), durationSec: input.totalSec }));
    const throwLlm = (async () => { throw new Error('LLM 不该被调用'); }) as unknown as typeof callLLM;
    const r = await runLaoliTopicPipeline(
      {
        slug: 'qf-preview', title: '八强前瞻', facts,
        backgrounds: [Buffer.from('COVER'), Buffer.from('M1'), Buffer.from('M2')],
        hook: '八强金靴四虎斗',
        scenes: [
          { narration: '金靴四大佬齐聚八强,这仗你说咋打?', bgIndex: 0 },
          { narration: '姆巴佩带队碰黑马摩洛哥,火星撞地球。', subtitle: '姆巴佩 碰 摩洛哥', bgIndex: 1 },
          { narration: '梅西再战瑞士门神科贝尔,球王碰门神。', subtitle: '梅西 碰 门神', bgIndex: 2 },
        ],
      },
      baseDeps(puts, { composeReel: composeReel as unknown as LaoliTopicPipelineDeps['composeReel'], storyLlm: throwLlm }),
    );
    expect(r.durationSec).toBe(15); // 3×5s
    const arg = composeReel.mock.calls[0]![0];
    expect(arg.scenes).toHaveLength(3);
    // bgIndex 精确配图:场景 0→COVER,1→M1,2→M2
    expect(arg.scenes[0]!.background.toString()).toBe('COVER');
    expect(arg.scenes[1]!.background.toString()).toBe('M1');
    expect(arg.scenes[2]!.background.toString()).toBe('M2');
    const status = JSON.parse(puts.find((p) => p.key.endsWith('status.json'))!.body.toString());
    expect(status.narration).toContain('球王碰门神');
  });

  it('显式场景命中红线词(最/第一/绝对/史上)→ 抛错', async () => {
    await expect(runLaoliTopicPipeline(
      { slug: 'x', title: 't', facts, backgrounds: [Buffer.from('BG')], scenes: [{ narration: '这是本届最强的八强阵容。' }] },
      baseDeps([]),
    )).rejects.toThrow(/红线词/);
  });

  it('注入 BGM → 混进 compose 的 bgm 字段(topic 片补背景乐)', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const composeReel = vi.fn(async (input: { totalSec: number; bgm?: Buffer }) => ({ video: Buffer.from('F'), durationSec: input.totalSec }));
    await runLaoliTopicPipeline(
      { slug: 'bgm', title: 't', facts, backgrounds: [Buffer.from('BG')] },
      baseDeps(puts, { composeReel: composeReel as unknown as LaoliTopicPipelineDeps['composeReel'], loadBgm: async () => Buffer.from('BGMDATA') }),
    );
    const arg = composeReel.mock.calls[0]![0];
    expect(arg.bgm?.toString()).toBe('BGMDATA');
  });

  it('无背景图 → 抛错', async () => {
    await expect(runLaoliTopicPipeline(
      { slug: 'x', title: 't', facts, backgrounds: [] }, baseDeps([]),
    )).rejects.toThrow(/no backgrounds/);
  });

  it('LLM 返回 null(如数字越界)→ 抛错,不出空片', async () => {
    const bad = { ...goodTopic, event: '有人踢进9球了' };
    await expect(runLaoliTopicPipeline(
      { slug: 'x', title: 't', facts, backgrounds: [Buffer.from('BG')] },
      baseDeps([], { storyLlm: fakeLlm(bad) }),
    )).rejects.toThrow(/null/);
  });

  it('startLaoliTopicDetached:同 slug 并发→第二次 accepted=false(单飞锁)', async () => {
    const puts: Array<{ key: string; body: Buffer }> = [];
    const slowCompose = (async () => { await new Promise((r) => setTimeout(r, 30)); return { video: Buffer.from('F'), durationSec: 1 }; }) as unknown as LaoliTopicPipelineDeps['composeReel'];
    const a = startLaoliTopicDetached({ slug: 'dup', title: 't', facts, backgrounds: [Buffer.from('BG')] }, baseDeps(puts, { composeReel: slowCompose }));
    const b = startLaoliTopicDetached({ slug: 'dup', title: 't', facts, backgrounds: [Buffer.from('BG')] }, baseDeps(puts, { composeReel: slowCompose }));
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
  });
});
