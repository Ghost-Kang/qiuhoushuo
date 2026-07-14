import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { VideoScript } from './laoli-video-script';
import type { LaoliReferenceImageType } from './laoli-video';

export interface LaoliTalkingHeadComposeClip {
  video: Buffer;
  startSec: number;
  durationSec: number;
  subtitle: string;
}

export interface LaoliComposeAssets {
  referenceImage: Buffer;
  referenceImageType: LaoliReferenceImageType;
  rawVideo?: Buffer;
  briefImage?: Buffer;
  ttsAudio: Buffer;
  bgm?: Buffer;
  /** 「老李口播为主」对口型分段;非空即走 talking-head 主版式,老李全屏出镜。 */
  talkingHeadClips?: LaoliTalkingHeadComposeClip[];
  /** talking-head 真实总时长(各段音频时长之和)。 */
  totalSec?: number;
}

export interface LaoliComposeResult {
  video: Buffer;
  degraded: boolean;
  durationSec: number;
}

export interface RenderVisualsClip {
  src: string;
  startSec: number;
  durationSec: number;
  subtitle: string;
}

interface RenderVisualsInput {
  script: VideoScript;
  publicDir: string;
  output: string;
  referenceImage: string;
  rawVideo?: string;
  briefImage?: string;
  degraded: boolean;
  talkingHead?: boolean;
  clips?: RenderVisualsClip[];
  totalSec?: number;
}

interface ComposeDeps {
  renderVisuals?: (input: RenderVisualsInput) => Promise<void>;
  runFfmpeg?: (args: string[], ffmpegPath: string) => Promise<void>;
  ffmpegPath?: string;
}

export async function composeLaoliVideo(
  script: VideoScript,
  assets: LaoliComposeAssets,
  deps: ComposeDeps = {},
): Promise<LaoliComposeResult> {
  const root = await mkdtemp(path.join(tmpdir(), 'laoli-video-'));
  const publicDir = path.join(root, 'public');
  const visualOutput = path.join(root, 'visual.mp4');
  const finalOutput = path.join(root, 'final.mp4');
  const referenceName = assets.referenceImageType === 'image/png' ? 'reference.png' : 'reference.jpg';
  const usableClips = (assets.talkingHeadClips ?? []).filter((clip) => isLikelyMp4(clip.video));
  const talkingHead = usableClips.length > 0;
  const rawVideoUsable = isLikelyMp4(assets.rawVideo);
  // talking-head 成功即非降级(老李真出镜对口型);否则沿用「i2v 背景 + 数据卡」是否齐活判断。
  const degraded = talkingHead ? false : (!rawVideoUsable || !assets.briefImage);
  const durationSec = talkingHead && assets.totalSec
    ? Math.max(1, assets.totalSec)
    : Math.min(35, script.durationSec);
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(publicDir, { recursive: true }));
    await writeFile(path.join(publicDir, referenceName), assets.referenceImage);
    if (rawVideoUsable && assets.rawVideo) await writeFile(path.join(publicDir, 'raw.mp4'), assets.rawVideo);
    if (assets.briefImage) await writeFile(path.join(publicDir, 'brief.png'), assets.briefImage);
    await writeFile(path.join(root, 'narration.wav'), assets.ttsAudio);
    if (assets.bgm) await writeFile(path.join(root, 'bgm.wav'), assets.bgm);

    const clips: RenderVisualsClip[] = [];
    for (const [index, clip] of usableClips.entries()) {
      const src = `clip-${index}.mp4`;
      await writeFile(path.join(publicDir, src), clip.video);
      clips.push({ src, startSec: clip.startSec, durationSec: clip.durationSec, subtitle: clip.subtitle });
    }

    const renderVisuals = deps.renderVisuals || renderLaoliVisuals;
    await renderVisuals({
      script,
      publicDir,
      output: visualOutput,
      referenceImage: referenceName,
      rawVideo: rawVideoUsable ? 'raw.mp4' : undefined,
      briefImage: assets.briefImage ? 'brief.png' : undefined,
      degraded,
      talkingHead,
      clips: talkingHead ? clips : undefined,
      totalSec: talkingHead ? durationSec : undefined,
    });

    const args = buildFfmpegMixArgs({
      visualInput: visualOutput,
      narrationInput: path.join(root, 'narration.wav'),
      bgmInput: assets.bgm ? path.join(root, 'bgm.wav') : undefined,
      output: finalOutput,
      durationSec,
    });
    await (deps.runFfmpeg || runFfmpeg)(args, deps.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg');
    return {
      video: await readFile(finalOutput),
      degraded,
      durationSec,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function buildFfmpegMixArgs(input: {
  visualInput: string;
  narrationInput: string;
  bgmInput?: string;
  output: string;
  durationSec: number;
}): string[] {
  const args = ['-y', '-i', input.visualInput, '-i', input.narrationInput];
  if (input.bgmInput) {
    args.push('-stream_loop', '-1', '-i', input.bgmInput);
    args.push(
      '-filter_complex',
      `[1:a]apad=whole_dur=${input.durationSec},asplit=2[voice_mix][voice_side];`
      + `[2:a]volume=0.22[bed];`
      + '[bed][voice_side]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300[ducked];'
      + '[voice_mix][ducked]amix=inputs=2:duration=first:normalize=0[a]',
      '-map', '0:v:0',
      '-map', '[a]',
    );
  } else {
    args.push(
      '-filter_complex', `[1:a]apad=whole_dur=${input.durationSec}[a]`,
      '-map', '0:v:0',
      '-map', '[a]',
    );
  }
  args.push(
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-t', String(input.durationSec),
    '-movflags', '+faststart',
    '-metadata', 'comment=AI生成内容',
    input.output,
  );
  return args;
}

export function isLikelyMp4(video: Buffer | undefined): boolean {
  return Boolean(video && video.length >= 12 && video.subarray(4, 8).toString() === 'ftyp');
}

async function renderLaoliVisuals(input: RenderVisualsInput): Promise<void> {
  const progressEnabled = process.env.LAOLI_VIDEO_RENDER_PROGRESS === '1';
  if (progressEnabled) console.log('[laoli-compose] bundling Remotion entry');
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    import('@remotion/bundler'),
    import('@remotion/renderer'),
  ]);
  const entryPoint = path.join(process.cwd(), 'remotion', 'index.tsx');
  const serveUrl = await bundle({
    entryPoint,
    publicDir: input.publicDir,
    enableCaching: true,
    onProgress: (progress) => {
      if (progressEnabled && Math.round(progress) % 10 === 0) {
        console.log(`[laoli-compose] bundle ${Math.round(progress)}%`);
      }
    },
  });
  const inputProps = {
    script: input.script,
    referenceImage: input.referenceImage,
    rawVideo: input.rawVideo,
    briefImage: input.briefImage,
    degraded: input.degraded,
    talkingHead: input.talkingHead,
    clips: input.clips,
    totalSec: input.totalSec,
  };
  const browserExecutable = resolveBrowserExecutable();
  if (progressEnabled) console.log('[laoli-compose] selecting composition / preparing Chromium');
  const composition = await selectComposition({
    serveUrl,
    id: 'LaoliPostmatch',
    inputProps,
    logLevel: 'warn',
    browserExecutable,
  });
  if (input.totalSec && input.totalSec > 0) {
    composition.durationInFrames = Math.max(1, Math.round(input.totalSec * composition.fps));
  }
  if (progressEnabled) console.log(`[laoli-compose] rendering ${composition.durationInFrames} frames`);
  let lastProgress = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: input.output,
    inputProps,
    muted: true,
    crf: 21,
    pixelFormat: 'yuv420p',
    logLevel: 'warn',
    concurrency: 2,
    browserExecutable,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (progressEnabled && percent >= lastProgress + 5) {
        lastProgress = percent;
        console.log(`[laoli-compose] render ${percent}%`);
      }
    },
  });
  if (progressEnabled) console.log('[laoli-compose] visual render complete');
}

export function resolveBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (env.REMOTION_BROWSER_EXECUTABLE) return env.REMOTION_BROWSER_EXECUTABLE;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (platform === 'darwin' && existsSync(macChrome)) return macChrome;
  return undefined;
}

async function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[laoli-compose] ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}
