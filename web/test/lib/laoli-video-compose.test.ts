import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFfmpegMixArgs,
  composeLaoliVideo,
  isLikelyMp4,
  resolveBrowserExecutable,
} from '@/lib/api/laoli-video-compose';
import { buildLaoliVideoScript } from '@/lib/api/laoli-video-script';
import { buildMetricCards } from '@/lib/api/laoli-video-motion';

const script = buildLaoliVideoScript({
  match: '韩国 vs 捷克',
  competition: '国际大赛',
  date: '2026-06-12',
  final_score: '2:1',
  events: [{ minute: 80, type: 'goal', team: '韩国', player: '金球员' }],
  stats: { possession: { home: 52, away: 48 }, shots_on_target: { home: 6, away: 3 } },
}, {});

describe('laoli video compose', () => {
  it('builds dynamic metric cards instead of one static wall of text', () => {
    const cards = buildMetricCards(['80分钟，金球员进球；射正6比3。控球52%比48%']);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ label: '射正', homeValue: 6, awayValue: 3, percent: 67 });
    expect(cards[1]).toMatchObject({ label: '控球', homeValue: 52, awayValue: 48, suffix: '%', percent: 52 });
    expect(cards[2]?.label).toContain('80分钟');
  });

  it('forces visible AIGC metadata and BGM ducking in final ffmpeg mix', () => {
    const args = buildFfmpegMixArgs({
      visualInput: 'visual.mp4',
      narrationInput: 'voice.wav',
      bgmInput: 'bgm.wav',
      output: 'final.mp4',
      durationSec: 35,
    });
    expect(args.join(' ')).toContain('sidechaincompress');
    expect(args.join(' ')).toContain('volume=0.22');
    expect(args.join(' ')).toContain('comment=AI生成内容');
    expect(args).toContain('35');
  });

  it('detects real MP4 headers and rejects mock bytes', () => {
    expect(isLikelyMp4(Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom')]))).toBe(true);
    expect(isLikelyMp4(Buffer.from('mock-laoli-video'))).toBe(false);
  });

  it('honors an explicit production browser executable', () => {
    expect(resolveBrowserExecutable({
      NODE_ENV: 'test',
      REMOTION_BROWSER_EXECUTABLE: '/usr/bin/chromium',
    }, 'linux')).toBe('/usr/bin/chromium');
  });

  it('degrades without raw video or brief image and still returns a complete result', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'compose-test-'));
    const renderVisuals = vi.fn(async ({ output }: { output: string }) => {
      await writeFile(output, Buffer.from('visual'));
    });
    const runFfmpeg = vi.fn(async (args: string[]) => {
      await writeFile(args.at(-1)!, Buffer.from('complete-final-video'));
    });
    const result = await composeLaoliVideo(script, {
      referenceImage: Buffer.from([0xff, 0xd8, 0xff]),
      referenceImageType: 'image/jpeg',
      ttsAudio: Buffer.from('wav'),
    }, { renderVisuals, runFfmpeg });
    expect(result.degraded).toBe(true);
    expect(result.video).toEqual(Buffer.from('complete-final-video'));
    expect(renderVisuals).toHaveBeenCalledWith(expect.objectContaining({ degraded: true, rawVideo: undefined }));
    expect(await readFile(path.join(root, 'missing')).catch(() => null)).toBeNull();
  });

  it('renders the talking-head hero version (non-degraded) with sequenced clips and real duration', async () => {
    let writtenClips = 0;
    const renderVisuals = vi.fn(async (inputArg: {
      output: string;
      talkingHead?: boolean;
      clips?: Array<{ src: string }>;
      totalSec?: number;
      publicDir: string;
    }) => {
      writtenClips = (await readFile(path.join(inputArg.publicDir, 'clip-0.mp4')).then(() => 1).catch(() => 0))
        + (await readFile(path.join(inputArg.publicDir, 'clip-1.mp4')).then(() => 1).catch(() => 0));
      await writeFile(inputArg.output, Buffer.from('visual'));
    });
    const ffmpegArgs: string[][] = [];
    const runFfmpeg = vi.fn(async (args: string[]) => {
      ffmpegArgs.push(args);
      await writeFile(args.at(-1)!, Buffer.from('hero-final'));
    });
    const clip = (tag: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from(tag)]);
    const result = await composeLaoliVideo(script, {
      referenceImage: Buffer.from([0xff, 0xd8, 0xff]),
      referenceImageType: 'image/jpeg',
      ttsAudio: Buffer.from('wav'),
      talkingHeadClips: [
        { video: clip('a'), startSec: 0, durationSec: 11, subtitle: '嚯' },
        { video: clip('b'), startSec: 11, durationSec: 12, subtitle: '关键回合' },
      ],
      totalSec: 23,
    }, { renderVisuals, runFfmpeg });

    expect(result.degraded).toBe(false);
    expect(result.durationSec).toBe(23);
    expect(result.video).toEqual(Buffer.from('hero-final'));
    expect(writtenClips).toBe(2);
    expect(renderVisuals).toHaveBeenCalledWith(expect.objectContaining({
      talkingHead: true,
      totalSec: 23,
      clips: expect.arrayContaining([expect.objectContaining({ src: 'clip-0.mp4', durationSec: 11 })]),
    }));
    // 终混时长用真实总时长而非固定 35s
    expect(ffmpegArgs[0]).toContain('23');
  });
});
