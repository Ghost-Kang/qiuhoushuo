import type { CardStorageClient } from './card-storage';
import { laoliAvatarEnabled, type LaoliAvatarProvider } from './laoli-avatar';
import { buildLaoliTalkingHead } from './laoli-avatar-pipeline';
import type { transcodeWavToMp3 } from './laoli-audio';
import { pcmToWav, type LaoliTtsProvider } from './laoli-tts';
import {
  buildLaoliMotionPrompt,
  generateAndStoreLaoliRawVideo,
  type LaoliReferenceImageType,
  type LaoliVideoProvider,
} from './laoli-video';
import { composeLaoliVideo, type LaoliComposeResult } from './laoli-video-compose';
import {
  buildLaoliVideoScript,
  type LaoliVideoReport,
  type VideoScript,
} from './laoli-video-script';
import type { MatchData, ReportStyle } from '../prompts';
import { trackServerEventGlobal } from './tracker';

export interface LaoliVideoPipelineInput {
  matchId: string;
  match: MatchData;
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>;
  referenceImage: Buffer;
  referenceImageType: LaoliReferenceImageType;
  briefImage?: Buffer;
  bgm?: Buffer;
}

export interface LaoliVideoPipelineResult {
  matchId: string;
  finalKey: string;
  finalUrl: string;
  statusKey: string;
  reviewKey: string;
  provider: string;
  degraded: boolean;
  bytes: number;
  durationMs: number;
  warnings: string[];
}

export interface LaoliVideoPipelineDeps {
  storage: CardStorageClient;
  ttsProvider: LaoliTtsProvider;
  videoProvider: LaoliVideoProvider;
  /** 提供且 LAOLI_AVATAR_ENABLED 时走「老李口播为主」对口型;失败自动回退动态背景路径。 */
  avatarProvider?: LaoliAvatarProvider;
  /** 注入 WAV→MP3(单测免真 ffmpeg);缺省走本机/生产机 ffmpeg。 */
  transcode?: typeof transcodeWavToMp3;
  compose?: typeof composeLaoliVideo;
  env?: NodeJS.ProcessEnv;
}

export function laoliVideoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LAOLI_VIDEO_ENABLED === '1' || env.LAOLI_VIDEO_ENABLED === 'true';
}

export function buildLaoliFinalVideoKey(matchId: string): string {
  return `laoli-videos/${safePart(matchId)}/final.mp4`;
}

export function buildLaoliStatusKey(matchId: string): string {
  return `laoli-videos/${safePart(matchId)}/status.json`;
}

export function buildLaoliReviewKey(matchId: string): string {
  return `laoli-videos/${safePart(matchId)}/review.json`;
}

export async function runLaoliVideoPipeline(
  input: LaoliVideoPipelineInput,
  deps: LaoliVideoPipelineDeps,
): Promise<LaoliVideoPipelineResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const env = deps.env ?? process.env;
  const script = buildLaoliVideoScript(input.match, input.reports, { matchId: input.matchId });
  const compose = deps.compose || composeLaoliVideo;
  let composed: LaoliComposeResult | undefined;
  let provider: string = deps.videoProvider.name;

  // 优先「老李口播为主」对口型;任一步失败回退动态背景路径,绝不空手。
  if (laoliAvatarEnabled(env) && deps.avatarProvider) {
    try {
      const talkingHead = await buildLaoliTalkingHead({
        matchId: input.matchId,
        script,
        referenceImage: input.referenceImage,
        referenceImageType: input.referenceImageType,
      }, {
        storage: deps.storage,
        ttsProvider: deps.ttsProvider,
        avatarProvider: deps.avatarProvider,
        transcode: deps.transcode,
      });
      warnings.push(...talkingHead.warnings);
      provider = talkingHead.provider;
      composed = await compose(script, {
        referenceImage: input.referenceImage,
        referenceImageType: input.referenceImageType,
        briefImage: input.briefImage,
        ttsAudio: talkingHead.narrationAudio,
        bgm: input.bgm,
        talkingHeadClips: talkingHead.clips.map((clip) => ({
          video: clip.video,
          startSec: clip.startSec,
          durationSec: clip.durationSec,
          subtitle: clip.subtitle,
        })),
        totalSec: talkingHead.totalSec,
      });
    } catch (error) {
      warnings.push(`avatar:${(error as Error).message}`);
      composed = undefined;
    }
  }

  // 动态背景兜底(原 i2v + 数据卡路径)。
  if (!composed) {
    const tts = await synthesizeWithFallback(script, deps.ttsProvider, warnings);
    let rawVideo: Buffer | undefined;
    try {
      const raw = await generateAndStoreLaoliRawVideo({
        matchId: input.matchId,
        referenceImage: input.referenceImage,
        referenceImageType: input.referenceImageType,
        prompt: buildLaoliMotionPrompt(),
      }, {
        provider: deps.videoProvider,
        storage: deps.storage,
      });
      rawVideo = raw.video;
      provider = raw.provider;
    } catch (error) {
      warnings.push(`i2v:${(error as Error).message}`);
    }
    try {
      composed = await compose(script, {
        referenceImage: input.referenceImage,
        referenceImageType: input.referenceImageType,
        rawVideo,
        briefImage: input.briefImage,
        ttsAudio: tts.audio,
        bgm: input.bgm,
      });
    } catch (error) {
      warnings.push(`compose-primary:${(error as Error).message}`);
      composed = await compose(script, {
        referenceImage: input.referenceImage,
        referenceImageType: input.referenceImageType,
        ttsAudio: tts.audio,
        bgm: input.bgm,
      });
    }
  }

  const degraded = composed.degraded || warnings.length > 0;
  const finalKey = buildLaoliFinalVideoKey(input.matchId);
  const finalUrl = await deps.storage.put(finalKey, composed.video, 'video/mp4');
  const durationMs = Date.now() - startedAt;
  const statusKey = buildLaoliStatusKey(input.matchId);
  const reviewKey = buildLaoliReviewKey(input.matchId);
  const status = {
    matchId: input.matchId,
    state: 'completed',
    provider,
    degraded,
    finalKey,
    finalUrl,
    bytes: composed.video.length,
    durationMs,
    warnings,
    completedAt: new Date().toISOString(),
  };
  const review = {
    matchId: input.matchId,
    reviewStatus: 'pending',
    publishStatus: 'blocked_until_approved',
    finalKey,
    aigcLabel: script.watermark,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    deps.storage.put(statusKey, Buffer.from(JSON.stringify(status, null, 2)), 'application/json'),
    deps.storage.put(reviewKey, Buffer.from(JSON.stringify(review, null, 2)), 'application/json'),
  ]);
  trackServerEventGlobal({
    eventId: 'E097',
    properties: {
      match_id: input.matchId,
      provider,
      degraded,
      duration_ms: durationMs,
      bytes: composed.video.length,
      review_status: 'pending',
    },
  });
  return {
    matchId: input.matchId,
    finalKey,
    finalUrl,
    statusKey,
    reviewKey,
    provider,
    degraded,
    bytes: composed.video.length,
    durationMs,
    warnings,
  };
}

async function synthesizeWithFallback(
  script: VideoScript,
  provider: LaoliTtsProvider,
  warnings: string[],
): Promise<{ audio: Buffer }> {
  try {
    return await provider.synthesize({ text: script.narration });
  } catch (error) {
    warnings.push(`tts:${(error as Error).message}`);
    return { audio: pcmToWav(Buffer.alloc(35 * 24000 * 2), 24000, 1) };
  }
}

function safePart(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown').replace(/%2F/gi, '');
}
