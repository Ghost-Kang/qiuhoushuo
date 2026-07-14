import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import {
  buildLaoliReelFfmpegArgs,
  composeLaoliReel,
  type LaoliReelScenePlan,
  type ComposeReelInput,
} from '@/lib/api/laoli-reel-compose';

function fc(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1] ?? '';
}

describe('buildLaoliReelFfmpegArgs（抖音版式·去老李 PiP）', () => {
  const scenes: LaoliReelScenePlan[] = [
    { backgroundPath: '/bg0.png', bgFit: 'contain', startSec: 0, endSec: 8, subtitlePath: '/s0.png', narrationPath: '/n0.mp3' },
    { backgroundPath: '/bg1.jpg', bgFit: 'cover', startSec: 8, endSec: 16, subtitlePath: '/s1.png', narrationPath: '/n1.mp3' },
  ];
  const args = buildLaoliReelFfmpegArgs({ scenes, bannerPath: '/banner.png', watermarkPath: '/wm.png', totalSec: 16, output: '/out.mp4' });
  const graph = fc(args);

  it('输入索引:base lavfi + 2 bg + banner(idx3) + wm(idx4) + 2 sub(5/6) + 2 narr(7/8)', () => {
    expect(args).toContain('color=c=0x0B1020:s=1080x1920:r=30');
    expect(graph).toContain('[3:v]scale=1080:-1'); // banner 缩放
    expect(graph).toContain('[4:v]overlay=W-w-30:40[bw]'); // 水印
    expect(graph).toContain('[7:a]aformat');
    expect(graph).toContain('[8:a]aformat');
    // 去老李 PiP:没有 216x384 PiP 轨、没有 840:1146 overlay
    expect(graph).not.toContain('216:384');
    expect(graph).not.toContain('840:1146');
  });

  it('数据卡 contain 缩窄居中顶对齐(190:330);镜头图 cover 填满(0:0)', () => {
    expect(graph).toContain('[1:v]scale=700:-1'); // contain 缩到卡宽 700(2026-07-07 由 860 缩窄让卡变矮上移)
    expect(graph).toContain("[img0]overlay=190:330:enable='between(t,0,8)'"); // 居中(x=190)顶对齐(y=330)
    expect(graph).toContain('force_original_aspect_ratio=increase,crop=1080:1920'); // cover 填满
    expect(graph).toContain("[img1]overlay=0:0:enable='between(t,8,16)'");
  });

  it('顶部大标题钩子 banner 全程常驻(overlay 0:10);水印常驻无 enable', () => {
    expect(graph).toContain('overlay=0:10[bp]'); // banner 压顶
    expect(graph).toContain('[bp][4:v]overlay=W-w-30:40[bw]');
    expect(/overlay=W-w-30:40\[bw\]/.test(graph)).toBe(true);
    expect(graph).not.toMatch(/overlay=W-w-30:40:enable/);
  });

  it('字幕逐窗落卡片下方暗带(y1100·避抖音底部UI)+ 旁白 concat + apad', () => {
    expect(graph).toContain("[5:v]overlay=0:1100:enable='between(t,0,8)'[s0]");
    expect(graph).toContain('[vout]');
    expect(graph).toContain('concat=n=2:v=0:a=1[voiceraw]');
    expect(graph).toContain('apad=whole_dur=16[aout]');
  });

  it('编码参数:libx264 + threads 2 + -t 16 + AIGC 水印元数据', () => {
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-threads', '2', '-t', '16', '-pix_fmt', 'yuv420p']));
    const mi = args.indexOf('-metadata');
    expect(args[mi + 1]).toBe('comment=AI生成内容');
    expect(args[args.length - 1]).toBe('/out.mp4');
  });

  it('无 bgmPath:纯旁白(apad→[aout]·无 amix)——向后兼容', () => {
    expect(graph).toContain('apad=whole_dur=16[aout]');
    expect(graph).not.toContain('amix');
    expect(args).not.toContain('-stream_loop');
  });

  describe('带 bgmPath(背景乐:循环铺满·压低·结尾定时淡出)', () => {
    const a = buildLaoliReelFfmpegArgs({ scenes, bannerPath: '/banner.png', watermarkPath: '/wm.png', totalSec: 16, output: '/out.mp4', bgmPath: '/bgm.mp3' });
    const g = fc(a);
    it('BGM 走 -stream_loop -1 循环输入,索引接在旁白之后(idx9)', () => {
      // 2 scene:base0 bg1/2 banner3 wm4 sub5/6 narr7/8 → bgm=9
      const si = a.indexOf('-stream_loop');
      expect(si).toBeGreaterThan(-1);
      expect(a[si + 1]).toBe('-1');
      expect(a[si + 2]).toBe('-i');
      expect(a[si + 3]).toBe('/bgm.mp3');
      expect(g).toContain('[9:a]atrim=0:16');
    });
    it('压低音量 + 淡入 + 结尾定时淡出(st=13.00:d=3.00)+ amix normalize=0(旁白不衰减)+ 限幅兜底', () => {
      expect(g).toContain('volume=0.22');
      expect(g).toContain('afade=t=in:st=0:d=1.20');
      expect(g).toContain('afade=t=out:st=13.00:d=3.00');
      expect(g).toContain('[voice][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]');
    });
    it('旁白升立体声后仍先 concat→apad(不早停)', () => {
      expect(g).toContain('concat=n=2:v=0:a=1[voiceraw]');
      expect(g).toContain('[voiceraw]apad=whole_dur=16,aformat=sample_rates=44100:channel_layouts=stereo[voice]');
    });
  });

  it('短视频(T<淡出秒数)夹紧:淡出=整段,不出现负 st', () => {
    const a = buildLaoliReelFfmpegArgs({
      scenes: [scenes[0]!], bannerPath: '/b.png', watermarkPath: '/w.png', totalSec: 2, output: '/o.mp4', bgmPath: '/bgm.mp3',
    });
    const g = fc(a);
    expect(g).toContain('afade=t=out:st=0.00:d=2.00'); // T=2<3 → 从 0 淡出、时长=2
    expect(g).not.toMatch(/st=-/);
  });
});

describe('composeLaoliReel', () => {
  it('落 temp → 单趟 main-pass(1 次 ffmpeg)→ 读回成片,无 any', async () => {
    const calls: number[] = [];
    const fakeRun = vi.fn(async (a: string[]) => {
      const out = a[a.length - 1]!;
      await writeFile(out, Buffer.from('MP4-BYTES'));
      calls.push(a.length);
    });
    const input: ComposeReelInput = {
      scenes: [
        { background: Buffer.from('bg0'), bgExt: 'png', bgFit: 'contain', startSec: 0, endSec: 8, subtitle: Buffer.from('s0'), narrationMp3: Buffer.from('n0') },
        { background: Buffer.from('bg1'), bgExt: 'png', bgFit: 'cover', startSec: 8, endSec: 16, subtitle: Buffer.from('s1'), narrationMp3: Buffer.from('n1') },
      ],
      banner: Buffer.from('BANNER'),
      watermark: Buffer.from('wm'),
      totalSec: 16,
    };
    const r = await composeLaoliReel(input, { runFfmpeg: fakeRun as unknown as typeof import('@/lib/api/laoli-ffmpeg').runFfmpeg });
    expect(r.video.toString()).toBe('MP4-BYTES');
    expect(r.durationSec).toBe(16);
    expect(fakeRun).toHaveBeenCalledTimes(1); // 去 PiP 后无 pre-pass,单趟合成
  });

  it('input.bgm 存在 → 落 temp mp3 并作 -stream_loop 输入喂 ffmpeg', async () => {
    let seen: string[] = [];
    const fakeRun = vi.fn(async (a: string[]) => { seen = a; await writeFile(a[a.length - 1]!, Buffer.from('MP4')); });
    const input: ComposeReelInput = {
      scenes: [{ background: Buffer.from('bg'), bgExt: 'png', bgFit: 'contain', startSec: 0, endSec: 8, subtitle: Buffer.from('s'), narrationMp3: Buffer.from('n') }],
      banner: Buffer.from('B'), watermark: Buffer.from('w'), totalSec: 8, bgm: Buffer.from('BGM-BYTES'),
    };
    await composeLaoliReel(input, { runFfmpeg: fakeRun as unknown as typeof import('@/lib/api/laoli-ffmpeg').runFfmpeg });
    const si = seen.indexOf('-stream_loop');
    expect(si).toBeGreaterThan(-1);
    expect(seen[si + 3]).toMatch(/bgm\.mp3$/); // 落盘的 bgm 临时文件作输入
  });
});
