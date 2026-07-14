import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLaoliChunkAudioKey,
  buildWavToMp3Args,
  concatWavs,
  splitSegmentsIntoChunks,
  transcodeWavToMp3,
  wavDurationSec,
} from '@/lib/api/laoli-audio';
import { pcmToWav } from '@/lib/api/laoli-tts';
import type { LaoliVideoSegment } from '@/lib/api/laoli-video-script';

const seg = (start: number, end: number, text: string): LaoliVideoSegment => ({
  kind: 'body',
  startSec: start,
  endSec: end,
  visual: 'highlight',
  narration: text,
  subtitle: text,
});

describe('wavDurationSec', () => {
  it('computes duration from a canonical 24kHz mono 16-bit WAV', () => {
    const twoSeconds = pcmToWav(Buffer.alloc(2 * 24000 * 2), 24000, 1);
    expect(wavDurationSec(twoSeconds)).toBeCloseTo(2, 5);
  });

  it('returns 0 for non-WAV bytes', () => {
    expect(wavDurationSec(Buffer.from('not a wav'))).toBe(0);
    expect(wavDurationSec(Buffer.alloc(4))).toBe(0);
  });
});

describe('splitSegmentsIntoChunks', () => {
  it('greedily merges adjacent segments under the cap', () => {
    const segments = [seg(0, 3, 'a'), seg(3, 14, 'b'), seg(14, 24, 'c'), seg(24, 29, 'd'), seg(29, 35, 'e')];
    const chunks = splitSegmentsIntoChunks(segments, 14);
    expect(chunks.map((chunk) => chunk.segmentIndices)).toEqual([[0, 1], [2], [3, 4]]);
    expect(chunks[0]).toMatchObject({ narration: 'ab', startSec: 0, endSec: 14, scriptedDurationSec: 14 });
    expect(chunks[2]).toMatchObject({ narration: 'de', startSec: 24, endSec: 35 });
    chunks.forEach((chunk) => expect(chunk.scriptedDurationSec).toBeLessThanOrEqual(14));
  });

  it('keeps an over-cap single segment as its own chunk', () => {
    const chunks = splitSegmentsIntoChunks([seg(0, 20, 'long')], 14);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.segmentIndices).toEqual([0]);
  });
});

describe('concatWavs', () => {
  it('sums durations of like-formatted WAVs into one continuous track', () => {
    const a = pcmToWav(Buffer.alloc(1 * 24000 * 2), 24000, 1);
    const b = pcmToWav(Buffer.alloc(2 * 24000 * 2), 24000, 1);
    const joined = concatWavs([a, b]);
    expect(wavDurationSec(joined)).toBeCloseTo(3, 5);
  });

  it('skips invalid segments and tolerates an empty list', () => {
    const a = pcmToWav(Buffer.alloc(24000 * 2), 24000, 1);
    expect(wavDurationSec(concatWavs([a, Buffer.from('junk')]))).toBeCloseTo(1, 5);
    expect(wavDurationSec(concatWavs([]))).toBe(0);
  });
});

describe('buildLaoliChunkAudioKey', () => {
  it('builds a deterministic slash-safe key', () => {
    expect(buildLaoliChunkAudioKey('match/1', 2)).toBe('laoli-videos/match1/chunk-2.mp3');
  });
});

describe('transcodeWavToMp3', () => {
  it('builds mono mp3 ffmpeg args', () => {
    expect(buildWavToMp3Args('in.wav', 'out.mp3'))
      .toEqual(['-y', '-i', 'in.wav', '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k', '-f', 'mp3', 'out.mp3']);
  });

  it('runs ffmpeg and returns the produced mp3 bytes', async () => {
    const runFfmpeg = vi.fn(async (args: string[]) => {
      await writeFile(args[args.length - 1] as string, Buffer.from('ID3-mp3'));
    });
    const out = await transcodeWavToMp3(pcmToWav(Buffer.alloc(2400), 24000, 1), { runFfmpeg });
    expect(out.toString()).toBe('ID3-mp3');
    expect(runFfmpeg).toHaveBeenCalledOnce();
  });

  it('rejects empty input', async () => {
    await expect(transcodeWavToMp3(Buffer.alloc(0))).rejects.toThrow('empty wav');
  });
});
