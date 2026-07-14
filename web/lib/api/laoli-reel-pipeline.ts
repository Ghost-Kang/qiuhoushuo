/**
 * 老李 reel 合成主链(ffmpeg·抖音版式:去老李 PiP·0 seedance·只保留老李嗓音旁白)。
 * 流程:buildLaoliReelStoryScript/模板 → 每段 TTS→mp3→真实时长(ffprobe)排时间轴 → 取主画面数据卡(brief/ratings·降级)
 *      → 渲顶部大标题钩子 banner/字幕/水印 PNG → composeLaoliReel 合成 → 存 COS + status/review + E097。
 * 2026-07-06 founder 拍板去掉老李形象:抖音底部原 PiP 与字幕/平台 UI 打架 → 只用老李语气讲、顶部钩子居中大字。
 * 失败语义:**硬失败(任一步抛)→ 回退 runLaoliLeanPipeline(裸对口型·绝不空手)**,status 标 degraded+fallback。
 * 审核恒 pending,绝不自动直发。deps 全可注入,单测无需真 ffmpeg/网络/TTS。
 */
import type { LaoliAvatarProvider } from './laoli-avatar';
import { transcodeWavToMp3 } from './laoli-audio';
import {
  buildLaoliFinalVideoKey,
  buildLaoliStatusKey,
  buildLaoliReviewKey,
} from './laoli-video-pipeline';
import { runLaoliLeanPipeline } from './laoli-lean-pipeline';
import { buildLaoliReelScript } from './laoli-video-script';
import { buildLaoliReelArcScript, buildLaoliReelStoryScript, type LaoliNextMatch } from './laoli-reel-story';
import type { callLLM } from '../llm';
import { loadReelBackgrounds, resolveSceneBackground } from './laoli-reel-assets';
import { renderReelSubtitlePng, renderReelBannerPng, renderReelWatermarkPng, renderReelTitleBgPng } from './laoli-reel-subtitle';
import { composeLaoliReel, type ComposeReelScene } from './laoli-reel-compose';
import { ffprobeDurationSec as realFfprobe } from './laoli-ffmpeg';
import { trackServerEventGlobal } from './tracker';
import type { CardStorageClient } from './card-storage';
import type { MatchData, ReportStyle } from '../prompts';
import type { LaoliVideoReport } from './laoli-video-script';
import type { LaoliTtsProvider } from './laoli-tts';

/**
 * 老李 reel 统一背景乐(founder 2026-07-07):压在解说之下、结尾定时淡出。
 * ⚠️ 路径写成字面量 `assets/bgm/laoli-reel.mp3` → next 输出追踪(nft)会把该 mp3 打进 standalone
 *    (同 laoli-video-context.ts 的 heat.wav 机制;运行时 cwd=/app/web → 命中 /app/web/assets/bgm/)。
 * 缺失(catch→undefined)则降级为纯旁白,绝不因缺乐而让出片失败。
 */
export async function loadReelBgm(): Promise<Buffer | undefined> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  return readFile(path.join(process.cwd(), 'assets', 'bgm', 'laoli-reel.mp3')).catch(() => undefined);
}

export interface LaoliReelPipelineInput {
  matchId: string;
  match: MatchData;
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>;
  /** 首场景(intro)背景用这张照片封面(contain 进卡槽·像 topic 片的封面页;缺省用 brief 数据卡)。
   *  founder 2026-07-07:首帧要=后面数据卡一样的版式(顶部钩子+卡槽+字幕),封面照放卡槽里。 */
  coverImage?: Buffer;
  /** 真实下一场对阵(赛程/晋级形势)→ 结尾走预测悬念钩子;不传=关注承诺钩子(见 laoli-reel-story)。 */
  nextMatch?: LaoliNextMatch;
  /** 结尾 CTA 覆写(跨promo钩子·如押球导流):透传给 arc,过轻校验才用,否则回退 FOLLOW_HOOK。 */
  ctaOverride?: string;
  /** strict arc-only(内容质量红线):arc 不可用时**不静默降级**,直接硬失败(不合成 story/template·不写 final)。
   *  入参优先,回落 env LAOLI_REEL_ARC_STRICT=1。自动线用;不传/false=保留三级回退(手动调试)。 */
  strictArc?: boolean;
}

export interface LaoliReelPipelineDeps {
  storage: CardStorageClient;
  ttsProvider: LaoliTtsProvider;
  avatarProvider: LaoliAvatarProvider;
  refImageUrl: string;
  reportId: string;
  fetchImpl?: typeof fetch;
  ffprobe?: typeof realFfprobe;
  /** 测试注入:替代真 ffmpeg 合成 */
  composeReel?: typeof composeLaoliReel;
  /** 测试注入:硬失败回退目标 */
  fallbackLean?: typeof runLaoliLeanPipeline;
  /** 测试注入:故事化旁白的 LLM(不传=真 callLLM;无 key 环境秒回退模板) */
  storyLlm?: typeof callLLM;
  /** 测试注入:背景乐加载器(不传=从 assets/bgm/laoli-reel.mp3 读;缺文件→纯旁白) */
  loadBgm?: typeof loadReelBgm;
}

export interface LaoliReelPipelineResult {
  matchId: string;
  finalKey: string;
  finalUrl: string;
  statusKey: string;
  reviewKey: string;
  durationSec: number;
  bytes: number;
  /** true = 降级产物:旁白回退到确定性模板(LLM 全灭)或合成硬失败走 lean。 */
  degraded: boolean;
  fallback?: 'lean';
  /** 旁白生成来源:六拍弧 / 四拍 / 确定性模板。 */
  generationMode?: 'arc' | 'story' | 'template';
  /** 未走 arc 时的回退原因(可观测,不静默)。 */
  fallbackReason?: string;
}

async function audioDurationSec(buf: Buffer, probe: typeof realFfprobe): Promise<number> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laoli-dur-'));
  try {
    const fp = path.join(dir, 'a.mp3');
    await fs.writeFile(fp, buf);
    return await probe(fp);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function runLaoliReelPipeline(
  input: LaoliReelPipelineInput,
  deps: LaoliReelPipelineDeps,
): Promise<LaoliReelPipelineResult> {
  const startedAt = Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const probe = deps.ffprobe ?? realFfprobe;
  const compose = deps.composeReel ?? composeLaoliReel;
  const fallbackLean = deps.fallbackLean ?? runLaoliLeanPipeline;

  // strict arc-only(内容质量红线 2026-07-12):arc 不可用时**不静默降级**——直接硬失败,不合成 story/template、不写 final。
  // 入参优先,回落 env LAOLI_REEL_ARC_STRICT=1(自动线用);非 strict 保留三级回退(手动调试)。
  const strictArc = input.strictArc ?? process.env.LAOLI_REEL_ARC_STRICT === '1';
  // arc 先算(buildLaoliReelArcScript 内部已 try/catch·永不抛)→ strict 门放在下方 try **之外**:
  // 失败直接冒泡出本函数,不会落进 catch 的 lean 回退,从而绝不产出任何降级视频。
  const arcScript = await buildLaoliReelArcScript(input.match, input.reports, {
    matchId: input.matchId,
    llm: deps.storyLlm,
    ctaOverride: input.ctaOverride,
  });
  if (strictArc && !arcScript) {
    console.warn('[laoli-reel] strict arc-only:arc 不可用 → 硬失败(不合成 story/template·不写 final·不出降级片)');
    throw new Error('arc_unavailable');
  }

  try {
    // 回退链(非 strict):六拍弧(单场默认)→ 四拍判卷(快退化档)→ 确定性模板(LLM 全灭)。
    // 降级绝不静默:generationMode/fallbackReason/degraded 全程记录(修 status 恒 degraded:false 的旧 bug)。
    const storyScript = arcScript ?? await buildLaoliReelStoryScript(input.match, input.reports, { matchId: input.matchId, llm: deps.storyLlm, nextMatch: input.nextMatch });
    const script = arcScript ?? storyScript ?? buildLaoliReelScript(input.match, input.reports, { matchId: input.matchId });
    const generationMode: 'arc' | 'story' | 'template' = arcScript ? 'arc' : storyScript ? 'story' : 'template';
    const fallbackReason = generationMode === 'arc' ? undefined : generationMode === 'story' ? 'arc_unavailable' : 'llm_unavailable';
    const narrationDegraded = generationMode === 'template';
    console.log(`[laoli-reel] narration mode=${generationMode}${fallbackReason ? ` reason=${fallbackReason}` : ''}`);

    // 抖音版式:去老李 PiP → 0 seedance(不再取参考图/不再对口型);顶部大标题钩子 banner。
    // 1) 每段 TTS → mp3 → 真实时长排时间轴
    const composeScenes: ComposeReelScene[] = [];
    const narrations: string[] = [];
    let cursor = 0;
    const watermark = await renderReelWatermarkPng();
    const banner = await renderReelBannerPng(script.hook || '');
    const titleBg = await renderReelTitleBgPng(script.title);
    const backgrounds = await loadReelBackgrounds({
      matchId: input.matchId, reportId: deps.reportId, storage: deps.storage, fetchImpl, briefHint: undefined,
    });

    for (let i = 0; i < script.scenes.length; i += 1) {
      const scene = script.scenes[i]!;
      narrations.push(scene.narration);
      const tts = await deps.ttsProvider.synthesize({ text: scene.narration });
      const mp3 = tts.contentType === 'audio/mpeg' ? tts.audio : await transcodeWavToMp3(tts.audio);
      const dur = await audioDurationSec(mp3, probe);
      const startSec = cursor;
      const endSec = cursor + dur;
      cursor = endSec;

      // 首场景(intro):有封面照就放卡槽里当封面页(contain·像 topic 片);否则主画面数据卡(降级链:ratings→brief、缺→标题兜底)。
      const useCover = i === 0 && !!input.coverImage;
      const resolved = useCover ? null : resolveSceneBackground(scene.image, backgrounds);
      composeScenes.push({
        background: useCover ? input.coverImage! : (resolved?.buf ?? titleBg),
        bgExt: useCover ? 'png' : (resolved?.ext ?? 'png'),
        bgFit: useCover ? 'contain' : (scene.image === 'highlight' && resolved?.ext === 'jpg' ? 'cover' : 'contain'),
        startSec, endSec,
        subtitle: await renderReelSubtitlePng(scene.subtitle),
        narrationMp3: mp3,
      });
    }

    const totalSec = Math.max(1, Math.round(cursor * 100) / 100);
    // 统一背景乐(压解说之下·结尾定时淡出);缺文件则纯旁白,不阻断出片。
    const bgm = await (deps.loadBgm ?? loadReelBgm)();
    console.log(`[laoli-reel] bgm=${bgm ? `${bgm.length}b` : 'none'}`);
    // 2) 合成:顶部钩子 + 背景轮播 + 字幕 + 水印 + 旁白混音 + BGM(无老李 PiP·0 seedance)
    const composed = await compose(
      { scenes: composeScenes, banner, watermark, totalSec, bgm },
      {},
    );
    console.log(`[laoli-reel] compose done bytes=${composed.video.length} scenes=${composeScenes.length}`);

    // 3) 存 COS + status/review + E097
    const finalKey = buildLaoliFinalVideoKey(input.matchId);
    const finalUrl = await deps.storage.put(finalKey, composed.video, 'video/mp4');
    const statusKey = buildLaoliStatusKey(input.matchId);
    const reviewKey = buildLaoliReviewKey(input.matchId);
    const durationMs = Date.now() - startedAt;
    const status = {
      matchId: input.matchId, state: 'completed', mode: 'reel', provider: 'ffmpeg', degraded: narrationDegraded,
      generationMode, fallbackReason,
      finalKey, finalUrl, bytes: composed.video.length, durationSec: composed.durationSec, durationMs,
      narration: narrations.join(' '), completedAt: new Date().toISOString(),
    };
    const review = {
      matchId: input.matchId, reviewStatus: 'pending', publishStatus: 'blocked_until_approved',
      finalKey, aigcLabel: 'AI生成内容', createdAt: new Date().toISOString(),
    };
    await Promise.all([
      deps.storage.put(statusKey, Buffer.from(JSON.stringify(status, null, 2)), 'application/json'),
      deps.storage.put(reviewKey, Buffer.from(JSON.stringify(review, null, 2)), 'application/json'),
    ]);
    trackServerEventGlobal({
      eventId: 'E097',
      properties: { match_id: input.matchId, provider: 'ffmpeg', mode: 'reel', degraded: narrationDegraded, generation_mode: generationMode, fallback_reason: fallbackReason ?? '', duration_ms: durationMs, bytes: composed.video.length, review_status: 'pending' },
    });
    return { matchId: input.matchId, finalKey, finalUrl, statusKey, reviewKey, durationSec: composed.durationSec, bytes: composed.video.length, degraded: narrationDegraded, generationMode, fallbackReason };
  } catch (err) {
    // 硬失败 → 回退 lean(裸对口型·不依赖 ffmpeg),绝不空手
    console.warn('[laoli-reel] hard fail → lean fallback:', (err as Error).message);
    const lean = await fallbackLean(
      { matchId: input.matchId, match: input.match, reports: input.reports },
      { storage: deps.storage, ttsProvider: deps.ttsProvider, avatarProvider: deps.avatarProvider, refImageUrl: deps.refImageUrl, fetchImpl: deps.fetchImpl },
    );
    return {
      matchId: input.matchId, finalKey: lean.finalKey, finalUrl: lean.finalUrl,
      statusKey: lean.statusKey, reviewKey: lean.reviewKey,
      durationSec: 0, bytes: lean.bytes, degraded: true, fallback: 'lean',
    };
  }
}

// ===== 异步 detached(route 立即 202·单飞锁)=====

const reelRunning = new Set<string>();

export function startLaoliReelDetached(
  input: LaoliReelPipelineInput,
  deps: LaoliReelPipelineDeps,
): { statusKey: string; finalKey: string; accepted: boolean } {
  const statusKey = buildLaoliStatusKey(input.matchId);
  const finalKey = buildLaoliFinalVideoKey(input.matchId);
  if (reelRunning.has(input.matchId)) return { statusKey, finalKey, accepted: false };
  reelRunning.add(input.matchId);
  // 先写 running,客户端轮询 status.json;真 pipeline 异步跑(数分钟·不阻塞 HTTP)。
  void deps.storage
    .put(statusKey, Buffer.from(JSON.stringify({ matchId: input.matchId, state: 'running', mode: 'reel', startedAt: new Date().toISOString() }, null, 2)), 'application/json')
    .catch(() => undefined);
  void runLaoliReelPipeline(input, deps)
    .catch(async (e: Error) => {
      await deps.storage
        .put(statusKey, Buffer.from(JSON.stringify({ matchId: input.matchId, state: 'failed', mode: 'reel', error: e.message, failedAt: new Date().toISOString() }, null, 2)), 'application/json')
        .catch(() => undefined);
    })
    .finally(() => reelRunning.delete(input.matchId));
  return { statusKey, finalKey, accepted: true };
}
