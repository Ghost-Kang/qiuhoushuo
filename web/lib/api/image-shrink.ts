/**
 * 把大图压到字节上限内(供企微图文消息 2MB 限制)。豆包写真/合影成图约 7MB,远超限会被静默跳过。
 * 走 ffmpeg(reel 已装,runner 容器自带):写临时文件 → 逐档降边长 + 提 JPEG 压缩比 → 命中即返回。
 * 不引新依赖、不碰 sharp(未打进 standalone)。始终压不下来返回 null(调用方静默跳过)。
 */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg, type RunFfmpegOpts } from '@/lib/api/laoli-ffmpeg';

type RunImpl = (args: string[], ffmpegPath?: string, opts?: RunFfmpegOpts) => Promise<void>;

export interface ShrinkOpts {
  runImpl?: RunImpl;
  ffmpegPath?: string;
  /** 逐档 (长边像素, ffmpeg -q:v 质量数:2 最好 / 31 最差) */
  ladder?: ReadonlyArray<readonly [number, number]>;
}

const DEFAULT_LADDER = [
  [1280, 4],
  [1080, 6],
  [960, 9],
  [720, 14],
] as const;

/**
 * 压缩 bytes 到 ≤ maxBytes;已达标直接原样返回。
 * 每档:fit 进 edge×edge 框(保持比例,长短边都不超 edge)+ JPEG 重编码,产物 ≤ 上限即采用。
 */
export async function shrinkImageForWecom(bytes: Buffer, maxBytes: number, opts: ShrinkOpts = {}): Promise<Buffer | null> {
  if (bytes.length <= maxBytes) return bytes;
  const run: RunImpl = opts.runImpl || ((a, p, o) => runFfmpeg(a, p, o));
  const ffmpeg = opts.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const ladder = opts.ladder || DEFAULT_LADDER;
  const dir = await mkdtemp(join(tmpdir(), 'wecomimg-'));
  const inPath = join(dir, 'in');
  const outPath = join(dir, 'out.jpg');
  try {
    await writeFile(inPath, bytes);
    for (const [edge, q] of ladder) {
      // fit 进 edge×edge 框(force_original_aspect_ratio=decrease 保比例、长短边都 ≤ edge)
      await run(
        ['-y', '-i', inPath, '-vf', `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease`, '-q:v', String(q), outPath],
        ffmpeg,
        { timeoutMs: 20_000 },
      ).catch(() => {});
      const out = await readFile(outPath).catch(() => null);
      if (out && out.length > 0 && out.length <= maxBytes) return out;
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
