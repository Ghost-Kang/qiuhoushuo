import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { shrinkImageForWecom } from '@/lib/api/image-shrink';

const MAX = 2 * 1024 * 1024;

describe('shrinkImageForWecom', () => {
  it('已 ≤ 上限 → 原样返回,不调 ffmpeg', async () => {
    const small = Buffer.alloc(1000, 1);
    const runImpl = vi.fn(async () => {});
    const out = await shrinkImageForWecom(small, MAX, { runImpl });
    expect(out).toBe(small);
    expect(runImpl).not.toHaveBeenCalled();
  });

  it('超限 → 逐档压,首档即达标则返回该产物并停止', async () => {
    const big = Buffer.alloc(MAX + 5_000_000, 7); // ~7MB
    // 假 ffmpeg:把一份达标产物写到 outPath(args 末位)
    const runImpl = vi.fn(async (args: string[]) => {
      const outPath = args[args.length - 1]!;
      await writeFile(outPath, Buffer.alloc(500_000, 9)); // 0.5MB < 2MB
    });
    const out = await shrinkImageForWecom(big, MAX, { runImpl });
    expect(out).not.toBeNull();
    expect(out!.length).toBe(500_000);
    expect(runImpl).toHaveBeenCalledTimes(1); // 首档命中即停
  });

  it('每档都压不到上限 → 走完梯子返回 null', async () => {
    const big = Buffer.alloc(MAX + 1, 7);
    const runImpl = vi.fn(async (args: string[]) => {
      const outPath = args[args.length - 1]!;
      await writeFile(outPath, Buffer.alloc(MAX + 100, 9)); // 始终超限
    });
    const out = await shrinkImageForWecom(big, MAX, { runImpl, ladder: [[1280, 4], [720, 14]] });
    expect(out).toBeNull();
    expect(runImpl).toHaveBeenCalledTimes(2); // 走完两档
  });

  it('ffmpeg 抛错(产物不存在)→ 不崩,继续下一档/最终 null', async () => {
    const big = Buffer.alloc(MAX + 1, 7);
    const runImpl = vi.fn(async () => {
      throw new Error('ffmpeg boom');
    });
    const out = await shrinkImageForWecom(big, MAX, { runImpl, ladder: [[1280, 4]] });
    expect(out).toBeNull();
  });

  it('ffmpeg scale 滤镜 fit 进 edge×edge 框(保持比例)', async () => {
    const big = Buffer.alloc(MAX + 1, 7);
    let seenVf = '';
    const runImpl = vi.fn(async (args: string[]) => {
      const i = args.indexOf('-vf');
      seenVf = args[i + 1] ?? '';
      await writeFile(args[args.length - 1]!, Buffer.alloc(100, 9));
    });
    await shrinkImageForWecom(big, MAX, { runImpl, ladder: [[1280, 4]] });
    expect(seenVf).toContain('force_original_aspect_ratio=decrease');
    expect(seenVf).toContain('1280');
  });
});
