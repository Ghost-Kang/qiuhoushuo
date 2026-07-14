/**
 * 老李视频共用 ffmpeg/ffprobe 工具(reel 合成 + 旧 compose/audio 可后续切换复用)。
 * - runFfmpeg:跑命令,非 0 退出抛(带 stderr 尾串);可选 timeoutMs 到点 SIGKILL(防 OOM/卡死拖死容器)。
 * - ffprobeDurationSec:取真实时长(秒),reel 时间轴一切窗口的权威来源。
 * spawn 经 opts.spawnImpl 可注入,单测无需 mock 模块。
 */
import { spawn as nodeSpawn } from 'node:child_process';

type SpawnFn = typeof nodeSpawn;

export interface RunFfmpegOpts {
  timeoutMs?: number;
  spawnImpl?: SpawnFn;
}

export async function runFfmpeg(
  args: string[],
  ffmpegPath: string = process.env.FFMPEG_PATH || 'ffmpeg',
  opts: RunFfmpegOpts = {},
): Promise<void> {
  const spawnImpl = opts.spawnImpl || nodeSpawn;
  await new Promise<void>((resolve, reject) => {
    const child = spawnImpl(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 进程已退出 */
        }
        done(() => reject(new Error(`[laoli-ffmpeg] ffmpeg timeout after ${opts.timeoutMs}ms`)));
      }, opts.timeoutMs);
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.on('error', (e: Error) => done(() => reject(e)));
    child.on('exit', (code: number | null) => {
      done(() => (code === 0 ? resolve() : reject(new Error(`[laoli-ffmpeg] ffmpeg exited ${code}: ${stderr.slice(-1200)}`))));
    });
  });
}

export async function ffprobeDurationSec(
  filePath: string,
  ffprobePath: string = process.env.FFPROBE_PATH || 'ffprobe',
  opts: { spawnImpl?: SpawnFn } = {},
): Promise<number> {
  const spawnImpl = opts.spawnImpl || nodeSpawn;
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawnImpl(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('exit', (code: number | null) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`[laoli-ffmpeg] ffprobe exited ${code}: ${stderr.slice(-300)}`));
    });
  });
  const n = parseFloat(out.trim());
  if (!Number.isFinite(n)) throw new Error(`[laoli-ffmpeg] ffprobe bad duration: ${out.trim().slice(0, 80)}`);
  return n;
}
