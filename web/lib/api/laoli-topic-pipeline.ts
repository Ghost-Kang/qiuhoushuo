/**
 * 老李「话题口播」合成管线(跨场专题:金靴之争、球星盘点等,非单场比赛)。
 *
 * 自包含,复用单场 reel 的积木(composeLaoliReel + 字幕/水印/顶部钩子渲染),**不碰单场链路**:
 * buildLaoliTopicScript(title,facts) → 每段 TTS→mp3→真实时长排时间轴 → 外部背景图轮播
 * → composeLaoliReel(抖音版式·去老李 PiP·0 seedance) → 存 COS(topic-<slug>) + status/review。
 * 审核恒 pending,绝不自动直发。deps 全可注入,单测无需真 ffmpeg/网络/TTS。
 * 2026-07-06 founder 去掉老李形象:只保留老李语气旁白 + 顶部大标题钩子,底部让给抖音自带 UI。
 */
import { transcodeWavToMp3 } from './laoli-audio';
import {
  buildLaoliFinalVideoKey,
  buildLaoliStatusKey,
  buildLaoliReviewKey,
} from './laoli-video-pipeline';
import { buildLaoliTopicScript } from './laoli-reel-story';
import { containsExtremeTerm } from './laoli-video-script';
import { renderReelSubtitlePng, renderReelBannerPng, renderReelWatermarkPng, renderReelTitleBgPng } from './laoli-reel-subtitle';
import { composeLaoliReel, type ComposeReelScene } from './laoli-reel-compose';
import { ffprobeDurationSec as realFfprobe } from './laoli-ffmpeg';
import { trackServerEventGlobal } from './tracker';
import type { callLLM } from '../llm';
import type { CardStorageClient } from './card-storage';
import type { LaoliTtsProvider } from './laoli-tts';

/** 显式逐场脚本单元:精确控制「哪句旁白配哪张背景」(如逐场看点片,每场配对应球星/比赛图)。 */
export interface LaoliTopicSceneInput {
  /** 旁白全文(TTS 念这句)*/
  narration: string;
  /** 屏幕字幕(缺省=narration)*/
  subtitle?: string;
  /** 用第几张背景(缺省=场景序号 % backgrounds.length)*/
  bgIndex?: number;
}

export interface LaoliTopicPipelineInput {
  /** 话题短标识,用作存储 key(topic-<slug>);只允许字母数字连字符 */
  slug: string;
  title: string;
  /** 事实清单(旁白数字只能来自此)*/
  facts: string;
  /** 场景背景图(按场景序号循环,如封面 + 榜单卡)*/
  backgrounds: Buffer[];
  /** 与 backgrounds 对应的扩展名;缺省 png */
  bgExts?: Array<'png' | 'jpg'>;
  /** 显式逐场脚本:给了就跳过 LLM,按此逐场排(旁白+字幕+指定背景)。用于「逐场看点」等需精确配图的片。 */
  scenes?: LaoliTopicSceneInput[];
  /** 顶部钩子 banner 文案(显式脚本时用;缺省=title)。LLM 路径用 script.hook,忽略此值。 */
  hook?: string;
}

export interface LaoliTopicPipelineDeps {
  storage: CardStorageClient;
  ttsProvider: LaoliTtsProvider;
  ffprobe?: typeof realFfprobe;
  composeReel?: typeof composeLaoliReel;
  storyLlm?: typeof callLLM;
  /** 背景乐加载器(缺省=从 assets/bgm/laoli-reel.mp3 读;缺文件→纯旁白)。测试可注入。 */
  loadBgm?: () => Promise<Buffer | undefined>;
}

export interface LaoliTopicPipelineResult {
  topicId: string;
  finalKey: string;
  finalUrl: string;
  statusKey: string;
  reviewKey: string;
  durationSec: number;
  bytes: number;
}

/** topic 片背景乐(founder 2026-07-08 补):与单场 reel 同一文件 assets/bgm/laoli-reel.mp3
 *  (已由 laoli-video 路由 outputFileTracingIncludes 打进 standalone·单 server 全局可读)。缺失→undefined(纯旁白)。 */
async function loadTopicBgm(): Promise<Buffer | undefined> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  return readFile(path.join(process.cwd(), 'assets', 'bgm', 'laoli-reel.mp3')).catch(() => undefined);
}

async function audioDurationSec(buf: Buffer, probe: typeof realFfprobe): Promise<number> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laoli-topic-dur-'));
  try {
    const fp = path.join(dir, 'a.mp3');
    await fs.writeFile(fp, buf);
    return await probe(fp);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function runLaoliTopicPipeline(
  input: LaoliTopicPipelineInput,
  deps: LaoliTopicPipelineDeps,
): Promise<LaoliTopicPipelineResult> {
  const startedAt = Date.now();
  const probe = deps.ffprobe ?? realFfprobe;
  const compose = deps.composeReel ?? composeLaoliReel;
  const topicId = `topic-${input.slug}`;

  if (!input.backgrounds.length) throw new Error('[laoli-topic] no backgrounds');
  console.log(`[laoli-topic] start ${topicId} bgs=${input.backgrounds.length}`);

  // 1) 脚本:显式逐场(input.scenes 给了就跳过 LLM,逐场精确配图)或 LLM 话题脚本(豆包→DeepSeek 备胎)
  // 老李红线词守卫（显式脚本绕过 LLM 守卫，这里补一道）：先遮蔽合法序数/时间（第一百一十二分钟不误伤），再判极限词。
  let sceneScripts: Array<{ narration: string; subtitle: string; bgIndex: number }>;
  let bannerText: string;
  let titleText: string;
  if (input.scenes && input.scenes.length) {
    input.scenes.forEach((s, i) => {
      if (containsExtremeTerm(s.narration) || (s.subtitle ? containsExtremeTerm(s.subtitle) : false)) {
        throw new Error(`[laoli-topic] 显式场景 ${i} 命中红线词(最/第一/绝对/史上)`);
      }
    });
    sceneScripts = input.scenes.map((s, i) => ({
      narration: s.narration,
      subtitle: s.subtitle ?? s.narration,
      bgIndex: (s.bgIndex ?? i) % input.backgrounds.length,
    }));
    titleText = input.title;
    bannerText = input.hook || input.title;
    console.log(`[laoli-topic] explicit scenes=${sceneScripts.length}`);
  } else {
    const script = await buildLaoliTopicScript(
      { title: input.title, facts: input.facts },
      { matchId: topicId, llm: deps.storyLlm },
    );
    if (!script) throw new Error('[laoli-topic] story LLM returned null');
    sceneScripts = script.scenes.map((sc, i) => ({ narration: sc.narration, subtitle: sc.subtitle, bgIndex: i % input.backgrounds.length }));
    titleText = script.title;
    bannerText = script.hook || script.title;
    console.log(`[laoli-topic] script ok scenes=${sceneScripts.length}`);
  }

  // 2) 每段 TTS → mp3 → 时间轴;背景按 bgIndex 配(显式=指定图,LLM=场景序号循环);顶部大标题钩子 banner
  const composeScenes: ComposeReelScene[] = [];
  const narrations: string[] = [];
  let cursor = 0;
  const watermark = await renderReelWatermarkPng();
  const banner = await renderReelBannerPng(bannerText);
  const titleBg = await renderReelTitleBgPng(titleText);

  for (let i = 0; i < sceneScripts.length; i += 1) {
    const sc = sceneScripts[i]!;
    narrations.push(sc.narration);
    const tts = await deps.ttsProvider.synthesize({ text: sc.narration });
    const mp3 = tts.contentType === 'audio/mpeg' ? tts.audio : await transcodeWavToMp3(tts.audio);
    const dur = await audioDurationSec(mp3, probe);
    console.log(`[laoli-topic] scene ${i} tts+dur ok mp3=${mp3.length} dur=${dur}`);
    const startSec = cursor;
    const endSec = cursor + dur;
    cursor = endSec;
    const bg = input.backgrounds[sc.bgIndex];
    const bgExt = input.bgExts?.[sc.bgIndex] ?? 'png';
    composeScenes.push({
      background: bg ?? titleBg,
      bgExt: bg ? bgExt : 'png',
      bgFit: 'contain',
      startSec, endSec,
      subtitle: await renderReelSubtitlePng(sc.subtitle),
      narrationMp3: mp3,
    });
  }

  const totalSec = Math.max(1, Math.round(cursor * 100) / 100);
  // 背景乐(founder 2026-07-08:topic 片补 BGM,与单场 reel 同款;缺失→纯旁白不失败)
  const bgm = await (deps.loadBgm ?? loadTopicBgm)();
  console.log(`[laoli-topic] all scenes done, totalSec=${totalSec} bgm=${bgm ? `${bgm.length}b` : 'none'} → compose`);
  // 3) 合成(抖音版式·去老李 PiP·0 seedance):顶部钩子 + 背景轮播 + 字幕 + 水印 + 旁白 + BGM
  const composed = await compose(
    { scenes: composeScenes, banner, watermark, totalSec, bgm },
    {},
  );
  console.log(`[laoli-topic] compose done bytes=${composed.video.length} dur=${composed.durationSec}`);

  // 4) 存 COS + status/review + E097
  const finalKey = buildLaoliFinalVideoKey(topicId);
  const finalUrl = await deps.storage.put(finalKey, composed.video, 'video/mp4');
  const statusKey = buildLaoliStatusKey(topicId);
  const reviewKey = buildLaoliReviewKey(topicId);
  const durationMs = Date.now() - startedAt;
  const status = {
    matchId: topicId, state: 'completed', mode: 'topic', provider: 'ffmpeg', degraded: false,
    finalKey, finalUrl, bytes: composed.video.length, durationSec: composed.durationSec, durationMs,
    title: titleText, narration: narrations.join(' '), completedAt: new Date().toISOString(),
  };
  const review = {
    matchId: topicId, reviewStatus: 'pending', publishStatus: 'blocked_until_approved',
    finalKey, aigcLabel: 'AI生成内容', createdAt: new Date().toISOString(),
  };
  await Promise.all([
    deps.storage.put(statusKey, Buffer.from(JSON.stringify(status, null, 2)), 'application/json'),
    deps.storage.put(reviewKey, Buffer.from(JSON.stringify(review, null, 2)), 'application/json'),
  ]);
  trackServerEventGlobal({
    eventId: 'E097',
    properties: { match_id: topicId, provider: 'ffmpeg', mode: 'topic', degraded: false, duration_ms: durationMs, bytes: composed.video.length, review_status: 'pending' },
  });
  return { topicId, finalKey, finalUrl, statusKey, reviewKey, durationSec: composed.durationSec, bytes: composed.video.length };
}

// ===== 异步 detached(route 立即 202·单飞锁)=====

const topicRunning = new Set<string>();

export function startLaoliTopicDetached(
  input: LaoliTopicPipelineInput,
  deps: LaoliTopicPipelineDeps,
): { statusKey: string; finalKey: string; accepted: boolean } {
  const topicId = `topic-${input.slug}`;
  const statusKey = buildLaoliStatusKey(topicId);
  const finalKey = buildLaoliFinalVideoKey(topicId);
  if (topicRunning.has(topicId)) return { statusKey, finalKey, accepted: false };
  topicRunning.add(topicId);
  void deps.storage
    .put(statusKey, Buffer.from(JSON.stringify({ matchId: topicId, state: 'running', mode: 'topic', startedAt: new Date().toISOString() }, null, 2)), 'application/json')
    .catch(() => undefined);
  void runLaoliTopicPipeline(input, deps)
    .catch(async (e: Error) => {
      await deps.storage
        .put(statusKey, Buffer.from(JSON.stringify({ matchId: topicId, state: 'failed', mode: 'topic', error: e.message, failedAt: new Date().toISOString() }, null, 2)), 'application/json')
        .catch(() => undefined);
    })
    .finally(() => topicRunning.delete(topicId));
  return { statusKey, finalKey, accepted: true };
}
