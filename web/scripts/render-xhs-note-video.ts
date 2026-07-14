/**
 * 小红书动效视频渲染 CLI(Emotion + Remotion,本地跑,不进生产链路)。
 * 用法:pnpm -C web exec tsx scripts/render-xhs-note-video.ts <manifest.json> <output.mp4>
 * manifest 例:
 * {
 *   "scenes": [
 *     { "kind": "cover", "src": "../tasks/assets/xhs-arg-1cover-photo-20260704.png", "seconds": 4 },
 *     { "kind": "card", "src": "../tasks/assets/xhs-arg-2brief-20260704.png" },
 *     { "kind": "outro" }
 *   ],
 *   "outroTitle": "球后~会看球的女孩",
 *   "outroSub": "赛后战报 · 每场更新",
 *   "outroCta": "关注看下一场",
 *   "bgm": "assets/bgm/heat.wav",
 *   "aspect": "landscape"
 * }
 * aspect 缺省 'portrait'(1080x1920,现状不变);'landscape' = 1920x1080。
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveBrowserExecutable } from '../lib/api/laoli-video-compose';
import {
  buildXhsBgmMuxArgs,
  buildXhsVideoTimeline,
  type XhsVideoSceneInput,
} from '../lib/api/xhs-video-timeline';

interface Manifest {
  scenes: Array<XhsVideoSceneInput & { src?: string }>;
  outroTitle: string;
  outroSub: string;
  outroCta?: string;
  bgm?: string;
  bgmVolume?: number;
  /** 缺省 'portrait'(1080x1920,现状不变);'landscape' = 1920x1080 */
  aspect?: 'portrait' | 'landscape';
}

async function toDataUrl(filePath: string, baseDir: string): Promise<string> {
  const abs = path.resolve(baseDir, filePath);
  const buf = await readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function main(): Promise<void> {
  const [manifestPath, outputArg] = process.argv.slice(2);
  if (!manifestPath) throw new Error('用法: render-xhs-note-video.ts <manifest.json> [output.mp4]');
  const manifestAbs = path.resolve(manifestPath);
  const baseDir = path.dirname(manifestAbs);
  const manifest = JSON.parse(await readFile(manifestAbs, 'utf8')) as Manifest;
  const output = path.resolve(outputArg || path.join(process.cwd(), 'xhs-note-video.mp4'));

  const scenes: XhsVideoSceneInput[] = await Promise.all(
    manifest.scenes.map(async (scene) =>
      scene.src ? { ...scene, src: await toDataUrl(scene.src, baseDir) } : scene,
    ),
  );
  const timeline = buildXhsVideoTimeline({ scenes });
  const durationSec = timeline.durationInFrames / timeline.fps;
  const inputProps = {
    scenes,
    watermark: 'AI生成内容',
    outroTitle: manifest.outroTitle,
    outroSub: manifest.outroSub,
    outroCta: manifest.outroCta,
    aspect: manifest.aspect,
  };

  console.log(`[xhs-video] ${scenes.length} 场景 / ${durationSec.toFixed(1)}s,开始 bundle`);
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    import('@remotion/bundler'),
    import('@remotion/renderer'),
  ]);
  const serveUrl = await bundle({
    entryPoint: path.join(process.cwd(), 'remotion', 'index.tsx'),
    enableCaching: true,
  });
  const browserExecutable = resolveBrowserExecutable();
  const composition = await selectComposition({
    serveUrl,
    id: 'XhsNoteVideo',
    inputProps,
    logLevel: 'warn',
    browserExecutable,
  });
  console.log(`[xhs-video] 渲染 ${composition.durationInFrames} 帧`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'xhs-video-'));
  try {
    const visual = path.join(tmp, 'visual.mp4');
    let last = -10;
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: visual,
      inputProps,
      muted: true,
      crf: 20,
      pixelFormat: 'yuv420p',
      logLevel: 'warn',
      concurrency: 2,
      browserExecutable,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= last + 10) {
          last = pct;
          console.log(`[xhs-video] render ${pct}%`);
        }
      },
    });
    if (manifest.bgm) {
      const bgmAbs = path.resolve(process.cwd(), manifest.bgm);
      await runFfmpeg(
        buildXhsBgmMuxArgs({
          visualInput: visual,
          bgmInput: bgmAbs,
          output,
          durationSec,
          bgmVolume: manifest.bgmVolume,
        }),
      );
    } else {
      await runFfmpeg(['-y', '-i', visual, '-c', 'copy', '-movflags', '+faststart', output]);
    }
    const size = await stat(output);
    console.log(JSON.stringify({ output, bytes: size.size, durationSec }));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
