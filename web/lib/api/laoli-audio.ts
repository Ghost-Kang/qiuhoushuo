import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pcmToWav } from './laoli-tts';
import type { LaoliVideoSegment } from './laoli-video-script';

/**
 * 「老李口播为主」分段对口型用的音频工具:
 * - wavDurationSec：从 WAV 头算时长(给 Seedance/OmniHuman 的单段 duration)。
 * - splitSegmentsIntoChunks：把脚本段按 maxSec 贪心合并成对口型分段(规避 Seedance 单段 15s 上限)。
 * - transcodeWavToMp3：TTS 出 WAV → MP3(火山数字人音频公网 URL 推荐 MP3)。
 */

export interface LaoliAudioChunk {
  index: number;
  narration: string;
  subtitle: string;
  startSec: number;
  endSec: number;
  scriptedDurationSec: number;
  segmentIndices: number[];
}

/** 贪心:相邻脚本段累计脚本时长 ≤ maxSec 就并到同一对口型分段;单段本身超限则自成一段(由 provider 钳制时长)。 */
export function splitSegmentsIntoChunks(segments: LaoliVideoSegment[], maxSec: number): LaoliAudioChunk[] {
  const cap = maxSec > 0 ? maxSec : 1;
  const chunks: LaoliAudioChunk[] = [];
  let current: { segs: LaoliVideoSegment[]; indices: number[]; start: number; end: number } | null = null;

  segments.forEach((segment, segmentIndex) => {
    if (current && segment.endSec - current.start <= cap) {
      current.segs.push(segment);
      current.indices.push(segmentIndex);
      current.end = segment.endSec;
      return;
    }
    if (current) chunks.push(finalizeChunk(current, chunks.length));
    current = { segs: [segment], indices: [segmentIndex], start: segment.startSec, end: segment.endSec };
  });
  if (current) chunks.push(finalizeChunk(current, chunks.length));
  return chunks;
}

function finalizeChunk(
  acc: { segs: LaoliVideoSegment[]; indices: number[]; start: number; end: number },
  index: number,
): LaoliAudioChunk {
  return {
    index,
    narration: acc.segs.map((segment) => segment.narration).join(''),
    subtitle: acc.segs.map((segment) => segment.subtitle).join(' '),
    startSec: acc.start,
    endSec: acc.end,
    scriptedDurationSec: Math.max(0, acc.end - acc.start),
    segmentIndices: acc.indices,
  };
}

/** 解析 WAV 头(支持 fmt/data 之间夹杂其它 chunk)算时长秒。非法/无 data → 0。 */
export function wavDurationSec(buffer: Buffer): number {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    return 0;
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 8 + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 8 + 8);
    } else if (id === 'data') {
      dataSize = Math.min(size, Math.max(0, buffer.length - (offset + 8)));
    }
    offset += 8 + size + (size % 2); // chunk 按偶数字节对齐
  }
  if (byteRate <= 0 || dataSize <= 0) return 0;
  return dataSize / byteRate;
}

interface PcmView {
  data: Buffer;
  sampleRate: number;
  channels: number;
}

function parseWav(buffer: Buffer): PcmView | null {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 8 + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(offset + 8 + 2);
      sampleRate = buffer.readUInt32LE(offset + 8 + 4);
    } else if (id === 'data') {
      const end = Math.min(offset + 8 + size, buffer.length);
      data = buffer.subarray(offset + 8, end);
    }
    offset += 8 + size + (size % 2);
  }
  if (!data || sampleRate <= 0 || channels <= 0) return null;
  return { data, sampleRate, channels };
}

/** 顺序拼接多段 TTS WAV 成一条连续旁白(同一 TTS 配置 → 同格式;以首段采样率/声道为准)。无效段跳过。 */
export function concatWavs(wavs: Buffer[]): Buffer {
  const views = wavs.map(parseWav).filter((view): view is PcmView => view !== null);
  if (views.length === 0) return pcmToWav(Buffer.alloc(0), 24000, 1);
  const sampleRate = views[0]!.sampleRate;
  const channels = views[0]!.channels;
  const pcm = Buffer.concat(views.map((view) => view.data));
  return pcmToWav(pcm, sampleRate, channels);
}

export function buildLaoliChunkAudioKey(matchId: string, chunkIndex: number): string {
  const safe = encodeURIComponent(matchId.trim() || 'unknown').replace(/%2F/gi, '');
  return `laoli-videos/${safe}/chunk-${chunkIndex}.mp3`;
}

export function buildWavToMp3Args(input: string, output: string): string[] {
  return ['-y', '-i', input, '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k', '-f', 'mp3', output];
}

export interface TranscodeDeps {
  runFfmpeg?: (args: string[], ffmpegPath: string) => Promise<void>;
  ffmpegPath?: string;
}

/** TTS WAV → MP3 字节。runFfmpeg 可注入以单测;默认走本机/生产机 ffmpeg。 */
export async function transcodeWavToMp3(wav: Buffer, deps: TranscodeDeps = {}): Promise<Buffer> {
  if (wav.length === 0) throw new Error('[laoli-audio] empty wav');
  const root = await mkdtemp(path.join(tmpdir(), 'laoli-audio-'));
  const input = path.join(root, 'in.wav');
  const output = path.join(root, 'out.mp3');
  try {
    await writeFile(input, wav);
    const run = deps.runFfmpeg || runFfmpeg;
    await run(buildWavToMp3Args(input, output), deps.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg');
    return await readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[laoli-audio] ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
