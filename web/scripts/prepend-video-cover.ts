/**
 * 给成片片头拼封面页(本地跑;抖音日更老李口播片用,SKILL §3c)。
 * 用法:pnpm -C web exec tsx scripts/prepend-video-cover.ts <cover.png> <in.mp4> <out.mp4> [coverSec=2.5]
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildCoverPrependArgs } from '../lib/api/xhs-video-timeline';

async function main(): Promise<void> {
  const [cover, video, out, secArg] = process.argv.slice(2);
  if (!cover || !video || !out) {
    throw new Error('用法: prepend-video-cover.ts <cover.png> <in.mp4> <out.mp4> [coverSec]');
  }
  const args = buildCoverPrependArgs({
    coverInput: path.resolve(cover),
    videoInput: path.resolve(video),
    output: path.resolve(out),
    coverSec: secArg ? Number(secArg) : undefined,
  });
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
  const size = await stat(path.resolve(out));
  console.log(JSON.stringify({ output: path.resolve(out), bytes: size.size }));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
