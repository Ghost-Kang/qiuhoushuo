/**
 * 老李口播片封面页·叠加式 CLI(本地跑):封面全屏盖在成片前 coverSec 秒上、音轨不顺延,解说从封面页开始。
 * ⚠️ --pip 是 **legacy**:2026-07-06 抖音版式去掉了老李形象,reel 里 840,1146 已无老李(是数据卡/字幕一角),
 *    新片一律**不要**加 --pip;此 flag 仅为回叠「老李时代」旧底片保留。
 * 用法:pnpm -C web exec tsx scripts/overlay-video-cover.ts <cover.png> <in.mp4> <out.mp4> [coverSec=2.5] [--pip[=x,y,w,h]]
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildCoverOverlayArgs } from '../lib/api/xhs-video-timeline';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
/** legacy 老李 PiP 窗口坐标(旧 reel 右下角老李·216×384@840,1146);新版式已无老李,仅回叠旧片时用。 */
const REEL_PIP = { x: 840, y: 1146, w: 216, h: 384 };

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function main(): Promise<void> {
  const positional: string[] = [];
  let pip: { x: number; y: number; w: number; h: number } | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--pip') pip = REEL_PIP;
    else if (arg.startsWith('--pip=')) {
      const [x, y, w, h] = arg.slice(6).split(',').map(Number);
      pip = { x: x!, y: y!, w: w!, h: h! };
    } else positional.push(arg);
  }
  const [cover, video, out, secArg] = positional;
  if (!cover || !video || !out) {
    throw new Error('用法: overlay-video-cover.ts <cover.png> <in.mp4> <out.mp4> [coverSec] [--pip[=x,y,w,h]]');
  }
  const args = buildCoverOverlayArgs({
    coverInput: path.resolve(cover),
    videoInput: path.resolve(video),
    output: path.resolve(out),
    coverSec: secArg ? Number(secArg) : undefined,
    pip,
  });
  await run(FFMPEG, args);
  const size = await stat(path.resolve(out));
  console.log(JSON.stringify({ output: path.resolve(out), bytes: size.size, pip: pip ?? null }));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
