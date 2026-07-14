import { describe, expect, it } from 'vitest';
import {
  buildCoverOverlayArgs,
  buildCoverPrependArgs,
  buildXhsBgmMuxArgs,
  buildXhsVideoTimeline,
  resolveXhsImageFitStyle,
  resolveXhsOutroScale,
  resolveXhsVideoDimensions,
  XHS_SCENE_DEFAULT_SECONDS,
} from '@/lib/api/xhs-video-timeline';

describe('buildXhsVideoTimeline', () => {
  it('按默认时长排帧且区间连续', () => {
    const t = buildXhsVideoTimeline({
      scenes: [
        { kind: 'cover', src: 'data:image/png;base64,a' },
        { kind: 'card', src: 'data:image/png;base64,b' },
        { kind: 'outro' },
      ],
    });
    expect(t.fps).toBe(30);
    const coverFrames = XHS_SCENE_DEFAULT_SECONDS.cover * 30;
    const cardFrames = XHS_SCENE_DEFAULT_SECONDS.card * 30;
    expect(t.scenes.map((s) => s.fromFrame)).toEqual([
      0,
      coverFrames,
      coverFrames + cardFrames,
    ]);
    expect(t.durationInFrames).toBe(
      t.scenes.reduce((sum, s) => sum + s.durationInFrames, 0),
    );
  });

  it('自定义 seconds 覆盖默认并四舍五入到帧', () => {
    const t = buildXhsVideoTimeline({
      scenes: [{ kind: 'card', src: 'x', seconds: 7.25 }],
      fps: 30,
    });
    expect(t.scenes.map((s) => s.durationInFrames)).toEqual([Math.round(7.25 * 30)]);
  });

  it('空场景 / 非法 fps / 非法时长 / 图场景缺素材 → 抛错', () => {
    expect(() => buildXhsVideoTimeline({ scenes: [] })).toThrow('至少需要 1 个场景');
    expect(() =>
      buildXhsVideoTimeline({ scenes: [{ kind: 'outro' }], fps: 0 }),
    ).toThrow('fps 必须为正数');
    expect(() =>
      buildXhsVideoTimeline({ scenes: [{ kind: 'card', src: 'x', seconds: -1 }] }),
    ).toThrow('场景时长非法');
    expect(() => buildXhsVideoTimeline({ scenes: [{ kind: 'cover' }] })).toThrow(
      'cover 场景缺素材图',
    );
  });

  it('outro 无图合法', () => {
    const t = buildXhsVideoTimeline({ scenes: [{ kind: 'outro' }] });
    expect(t.scenes.map((s) => s.durationInFrames)).toEqual([
      Math.round(XHS_SCENE_DEFAULT_SECONDS.outro * 30),
    ]);
  });
});

describe('buildCoverPrependArgs', () => {
  it('封面静帧 2.5s + concat 两段 + 音轨顺延 2500ms + AIGC metadata', () => {
    const args = buildCoverPrependArgs({
      coverInput: 'cover.png',
      videoInput: 'reel.mp4',
      output: 'out.mp4',
    });
    expect(args[args.indexOf('-loop') + 2]).toBe('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('2.5');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('concat=n=2:v=1:a=0');
    expect(filter).toContain('adelay=2500:all=1');
    expect(filter).toContain('pad=1080:1920');
    expect(filter).toContain('color=0x0b1230');
    expect(args[args.indexOf('-metadata') + 1]).toBe('comment=AI生成内容');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('自定义时长/画幅生效;非法时长抛错', () => {
    const args = buildCoverPrependArgs({
      coverInput: 'c.png',
      videoInput: 'v.mp4',
      output: 'o.mp4',
      coverSec: 3,
      width: 720,
      height: 1280,
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('adelay=3000:all=1');
    expect(filter).toContain('pad=720:1280');
    expect(() =>
      buildCoverPrependArgs({ coverInput: 'c', videoInput: 'v', output: 'o', coverSec: 0 }),
    ).toThrow('封面时长非法');
  });
});

describe('buildCoverOverlayArgs', () => {
  it('封面叠加前 2.5s、裁到字幕安全线、音轨 copy 不顺延、AIGC metadata', () => {
    const args = buildCoverOverlayArgs({
      coverInput: 'cover.png',
      videoInput: 'reel.mp4',
      output: 'out.mp4',
    });
    // 主视频是第 0 路输入,封面 -loop 1 -t 2.5 是第 1 路
    expect(args[args.indexOf('-i') + 1]).toBe('reel.mp4');
    expect(args[args.indexOf('-loop') + 3]).toBe('2.5');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('crop=1080:1640:0:0');
    expect(filter).toContain('overlay=0:0:eof_action=pass');
    expect(filter).not.toContain('adelay'); // 解说从封面页开始,音轨不顺延
    expect(args[args.indexOf('-map') + 3]).toBe('0:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args[args.indexOf('-metadata') + 1]).toBe('comment=AI生成内容');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('pip:底片裁老李窗叠回封面、只在封面窗生效;非法窗口/时长抛错', () => {
    const args = buildCoverOverlayArgs({
      coverInput: 'c.png',
      videoInput: 'v.mp4',
      output: 'o.mp4',
      pip: { x: 720, y: 980, w: 324, h: 576 }, // 生产 laoli-reel-compose PIP 常量
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[0:v]split=2[base][pipsrc]');
    expect(filter).toContain('crop=324:576:720:980');
    expect(filter).toContain("overlay=720:980:enable='lte(t,2.5)'");
    expect(args[args.indexOf('-map') + 1]).toBe('[vp]');
    expect(() =>
      buildCoverOverlayArgs({
        coverInput: 'c', videoInput: 'v', output: 'o',
        pip: { x: 720, y: 980, w: 0, h: 576 },
      }),
    ).toThrow('pip 窗口非法');
    expect(() =>
      buildCoverOverlayArgs({ coverInput: 'c', videoInput: 'v', output: 'o', coverSec: -1 }),
    ).toThrow('封面时长非法');
  });
});

describe('resolveXhsVideoDimensions', () => {
  it('manifest 无 aspect(undefined)→ 竖版 1080x1920,现状不变', () => {
    expect(resolveXhsVideoDimensions()).toEqual({ width: 1080, height: 1920 });
    expect(resolveXhsVideoDimensions(undefined)).toEqual({ width: 1080, height: 1920 });
  });

  it("aspect: 'portrait' 显式声明同缺省", () => {
    expect(resolveXhsVideoDimensions('portrait')).toEqual({ width: 1080, height: 1920 });
  });

  it("aspect: 'landscape' → 横版 1920x1080", () => {
    expect(resolveXhsVideoDimensions('landscape')).toEqual({ width: 1920, height: 1080 });
  });

  it('非法 aspect 抛错,不静默兜底成任意画幅', () => {
    expect(() => resolveXhsVideoDimensions('square')).toThrow('非法 aspect');
    expect(() => resolveXhsVideoDimensions('')).toThrow('非法 aspect');
  });
});

describe('resolveXhsImageFitStyle', () => {
  it('竖版(isLandscape=false)→ 只有 width:94%,现状不变', () => {
    expect(resolveXhsImageFitStyle(false)).toEqual({ width: '94%' });
  });

  it('横版(isLandscape=true)→ maxWidth/maxHeight 收敛 + width/height auto + objectFit contain,素材完整可见不被裁切', () => {
    expect(resolveXhsImageFitStyle(true)).toEqual({
      maxWidth: '94%',
      maxHeight: '86%',
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
    });
  });
});

describe('resolveXhsOutroScale', () => {
  it('竖版画布 1080x1920 → scale=1,像素级不变', () => {
    expect(resolveXhsOutroScale(1080, 1920)).toBe(1);
  });

  it('横版画布 1920x1080 → scale=1.08(专属基准分母 1000,非竖版的 1920;经实渲目检:标题占画布宽度约 49%)', () => {
    expect(resolveXhsOutroScale(1920, 1080)).toBeCloseTo(1.08, 10);
  });

  it('横版判定按 width>height,而非画布尺寸的字面量匹配', () => {
    // 同为横版比例但尺寸不同(如 960x540)也要落在横版分支,不因未命中 1920x1080 字面量而误判成竖版
    expect(resolveXhsOutroScale(960, 540)).toBeCloseTo(Math.min(960 / 1080, 540 / 1000), 10);
  });
});

describe('buildXhsBgmMuxArgs', () => {
  it('视频轨 copy + BGM 循环限时 + 尾部淡出 + AIGC metadata', () => {
    const args = buildXhsBgmMuxArgs({
      visualInput: 'v.mp4',
      bgmInput: 'b.wav',
      output: 'out.mp4',
      durationSec: 30,
    });
    expect(args).toContain('-stream_loop');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-t') + 1]).toBe('30');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('volume=0.25');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('afade=t=out:st=28.8');
    expect(args[args.indexOf('-metadata') + 1]).toBe('comment=AI生成内容');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('自定义音量生效且淡出起点不为负', () => {
    const args = buildXhsBgmMuxArgs({
      visualInput: 'v.mp4',
      bgmInput: 'b.wav',
      output: 'out.mp4',
      durationSec: 0.5,
      bgmVolume: 0.1,
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('volume=0.1');
    expect(filter).toContain('afade=t=out:st=0');
  });
});
