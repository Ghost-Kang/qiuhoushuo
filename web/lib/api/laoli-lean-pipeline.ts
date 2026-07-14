import type { CardStorageClient, StorageContentType } from './card-storage';
import type { LaoliAvatarProvider } from './laoli-avatar';
import type { LaoliReferenceImageType } from './laoli-video';
import type { LaoliTtsProvider } from './laoli-tts';
import {
  buildLaoliFinalVideoKey,
  buildLaoliReviewKey,
  buildLaoliStatusKey,
} from './laoli-video-pipeline';
import { buildLaoliLeanNarration, type LaoliVideoReport } from './laoli-video-script';
import type { MatchData, ReportStyle } from '../prompts';
import { trackServerEventGlobal } from './tracker';

/**
 * 「精简版」递归出片主链(每场自动):单段≤15s 老李口播 → TTS(mp3) → COS 公网 URL
 * → OmniHuman(老李图+音频) → 自带音轨/水印的成片直存为 final。**不走 Remotion/ffmpeg**,
 * 生产 node:20-slim 容器即可跑(无 Chromium/ffmpeg 依赖)。审核固定 pending,不自动直发。
 */
export interface LaoliLeanPipelineInput {
  matchId: string;
  match: MatchData;
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>;
}

export interface LaoliLeanPipelineDeps {
  storage: CardStorageClient;
  ttsProvider: LaoliTtsProvider;
  avatarProvider: LaoliAvatarProvider;
  /** OmniHuman 必需的老李公网图 URL(缺省线上 laoli-ref);seedance 取此 URL 字节做 base64 首帧。 */
  refImageUrl: string;
  prompt?: string;
  /** 取参考图字节用(seedance 首帧);缺省全局 fetch,测试注入。 */
  fetchImpl?: typeof fetch;
}

export interface LaoliLeanPipelineResult {
  matchId: string;
  finalKey: string;
  finalUrl: string;
  statusKey: string;
  reviewKey: string;
  provider: string;
  bytes: number;
  durationMs: number;
  narration: string;
}

export function buildLaoliLeanAudioKey(matchId: string): string {
  return `laoli-videos/${safePart(matchId)}/voice.mp3`;
}

export function estimateNarrationSeconds(narration: string): number {
  // ~4.5 字/秒中文口播;钳到 OmniHuman 甜区 4..15s。
  const seconds = Math.ceil(narration.length / 4.5);
  return Math.max(4, Math.min(15, seconds));
}

export async function runLaoliLeanPipeline(
  input: LaoliLeanPipelineInput,
  deps: LaoliLeanPipelineDeps,
): Promise<LaoliLeanPipelineResult> {
  const startedAt = Date.now();
  if (!deps.refImageUrl) throw new Error('[laoli-lean] refImageUrl required for OmniHuman');

  const narration = buildLaoliLeanNarration(input.match, input.reports);
  if (!narration) throw new Error('[laoli-lean] empty narration');

  const tts = await deps.ttsProvider.synthesize({ text: narration });
  const audioContentType: StorageContentType = tts.contentType === 'audio/mpeg' ? 'audio/mpeg' : 'audio/wav';
  const audioUrl = await deps.storage.put(buildLaoliLeanAudioKey(input.matchId), tts.audio, audioContentType);

  // seedance 需 base64 首帧(referenceImage);omnihuman 用 imageUrl。取参考图字节供 seedance——
  // 容器可达 qiuhoushuo.com 主站(实测 200,非 COS CDN 故无 hairpin)。取失败不阻断 omnihuman。
  let referenceImage: Buffer | undefined;
  let referenceImageType: LaoliReferenceImageType | undefined;
  try {
    const refRes = await (deps.fetchImpl ?? fetch)(deps.refImageUrl);
    if (refRes.ok) {
      referenceImage = Buffer.from(await refRes.arrayBuffer());
      referenceImageType = refRes.headers.get('content-type') === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    }
  } catch {
    // omnihuman 不需要;seedance 会在 provider 内因缺 referenceImage 显式报错
  }

  const generated = await deps.avatarProvider.generate({
    matchId: input.matchId,
    segmentIndex: 0,
    imageUrl: deps.refImageUrl,
    referenceImage,
    referenceImageType,
    audioUrl,
    audioDurationSec: estimateNarrationSeconds(narration),
    prompt: deps.prompt,
  });

  const finalKey = buildLaoliFinalVideoKey(input.matchId);
  const finalUrl = await deps.storage.put(finalKey, generated.video, 'video/mp4');
  const statusKey = buildLaoliStatusKey(input.matchId);
  const reviewKey = buildLaoliReviewKey(input.matchId);
  const durationMs = Date.now() - startedAt;

  const status = {
    matchId: input.matchId,
    state: 'completed',
    mode: 'lean',
    provider: generated.provider,
    degraded: false,
    finalKey,
    finalUrl,
    bytes: generated.video.length,
    durationMs,
    narration,
    voice: tts.voice,
    completedAt: new Date().toISOString(),
  };
  const review = {
    matchId: input.matchId,
    reviewStatus: 'pending',
    publishStatus: 'blocked_until_approved',
    finalKey,
    aigcLabel: 'AI生成内容',
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
      provider: generated.provider,
      mode: 'lean',
      degraded: false,
      duration_ms: durationMs,
      bytes: generated.video.length,
      review_status: 'pending',
    },
  });

  return {
    matchId: input.matchId,
    finalKey,
    finalUrl,
    statusKey,
    reviewKey,
    provider: generated.provider,
    bytes: generated.video.length,
    durationMs,
    narration,
  };
}

function safePart(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown').replace(/%2F/gi, '');
}
