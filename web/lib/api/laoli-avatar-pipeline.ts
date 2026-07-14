import type { CardStorageClient, StorageContentType } from './card-storage';
import {
  buildLaoliChunkAudioKey,
  concatWavs,
  splitSegmentsIntoChunks,
  transcodeWavToMp3,
  wavDurationSec,
  type LaoliAudioChunk,
} from './laoli-audio';
import { buildLaoliLipsyncPrompt, type LaoliAvatarProvider } from './laoli-avatar';
import { pcmToWav, type LaoliTtsProvider } from './laoli-tts';
import type { LaoliReferenceImageType } from './laoli-video';
import type { VideoScript } from './laoli-video-script';

/**
 * 「老李口播为主」对口型主链:脚本分段 → 每段 TTS → WAV→MP3→COS 公网 URL → avatar.generate 对口型片段。
 * 片段按真实音频时长顺序排布成 talking-head 时间轴,旁白用 concatWavs 拼成一条连续音轨。
 * 任一步失败由调用方(pipeline)兜底回退到「数据卡 + i2v 动态背景」老路径,绝不空手。
 */
export interface LaoliTalkingHeadClip {
  video: Buffer;
  rawKey: string;
  startSec: number;
  durationSec: number;
  subtitle: string;
}

export interface LaoliTalkingHeadResult {
  clips: LaoliTalkingHeadClip[];
  narrationAudio: Buffer;
  totalSec: number;
  provider: string;
  warnings: string[];
}

export interface LaoliTalkingHeadInput {
  matchId: string;
  script: VideoScript;
  referenceImage: Buffer;
  referenceImageType: LaoliReferenceImageType;
}

export interface LaoliTalkingHeadDeps {
  storage: CardStorageClient;
  ttsProvider: LaoliTtsProvider;
  avatarProvider: LaoliAvatarProvider;
  transcode?: typeof transcodeWavToMp3;
  /** omnihuman 需公网图 URL;不传则上传 referenceImage 到 COS。 */
  refImageUrl?: string;
}

const CHUNK_HEADROOM_SEC = 1;

export function buildLaoliTalkingHeadRawKey(matchId: string, chunkIndex: number): string {
  const safe = encodeURIComponent(matchId.trim() || 'unknown').replace(/%2F/gi, '');
  return `laoli-videos/${safe}/clip-${chunkIndex}.mp4`;
}

export async function buildLaoliTalkingHead(
  input: LaoliTalkingHeadInput,
  deps: LaoliTalkingHeadDeps,
): Promise<LaoliTalkingHeadResult> {
  const warnings: string[] = [];
  const transcode = deps.transcode || transcodeWavToMp3;
  const maxChunkSec = Math.max(4, deps.avatarProvider.maxClipSec - CHUNK_HEADROOM_SEC);
  const chunks = splitSegmentsIntoChunks(input.script.segments, maxChunkSec);
  if (chunks.length === 0) throw new Error('[laoli-avatar-pipeline] no segments to narrate');

  const imageUrl = deps.avatarProvider.name === 'omnihuman'
    ? deps.refImageUrl || await uploadReferenceImage(input, deps.storage)
    : deps.refImageUrl;

  const clips: LaoliTalkingHeadClip[] = [];
  const narrationParts: Buffer[] = [];
  let cursorSec = 0;

  for (const chunk of chunks) {
    const wav = await synthesizeChunk(chunk, deps.ttsProvider, warnings);
    const durationSec = roundDuration(wavDurationSec(wav) || chunk.scriptedDurationSec || 4);
    const mp3 = await transcode(wav);
    const audioUrl = await deps.storage.put(
      buildLaoliChunkAudioKey(input.matchId, chunk.index),
      mp3,
      'audio/mpeg' as StorageContentType,
    );
    const generated = await deps.avatarProvider.generate({
      matchId: input.matchId,
      segmentIndex: chunk.index,
      referenceImage: input.referenceImage,
      referenceImageType: input.referenceImageType,
      imageUrl,
      audioUrl,
      audioDurationSec: durationSec,
      prompt: buildLaoliLipsyncPrompt(),
    });
    const rawKey = buildLaoliTalkingHeadRawKey(input.matchId, chunk.index);
    await deps.storage.put(rawKey, generated.video, 'video/mp4');
    clips.push({ video: generated.video, rawKey, startSec: cursorSec, durationSec, subtitle: chunk.subtitle });
    narrationParts.push(wav);
    cursorSec += durationSec;
  }

  return {
    clips,
    narrationAudio: concatWavs(narrationParts),
    totalSec: cursorSec,
    provider: deps.avatarProvider.name,
    warnings,
  };
}

async function synthesizeChunk(
  chunk: LaoliAudioChunk,
  provider: LaoliTtsProvider,
  warnings: string[],
): Promise<Buffer> {
  try {
    const out = await provider.synthesize({ text: chunk.narration });
    return out.audio;
  } catch (error) {
    warnings.push(`tts-chunk-${chunk.index}:${(error as Error).message}`);
    const seconds = Math.max(1, Math.ceil(chunk.scriptedDurationSec || 4));
    return pcmToWav(Buffer.alloc(seconds * 24000 * 2), 24000, 1);
  }
}

async function uploadReferenceImage(
  input: LaoliTalkingHeadInput,
  storage: CardStorageClient,
): Promise<string> {
  const safe = encodeURIComponent(input.matchId.trim() || 'unknown').replace(/%2F/gi, '');
  const ext = input.referenceImageType === 'image/png' ? 'png' : 'jpg';
  return storage.put(`laoli-videos/${safe}/ref.${ext}`, input.referenceImage, input.referenceImageType);
}

function roundDuration(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
