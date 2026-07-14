/**
 * 小红书动效视频(Emotion + Remotion)时间轴与混音参数——纯函数,无 IO。
 * 输入=现有静态素材(封面照片/系统内页卡)场景列表,输出=逐场景帧区间供合成组件消费;
 * buildXhsBgmMuxArgs 构造 ffmpeg 参数:视频轨 copy,BGM 循环+压低音量+结尾淡出。
 */

export type XhsVideoSceneKind = 'cover' | 'card' | 'outro';

export interface XhsVideoSceneInput {
  kind: XhsVideoSceneKind;
  /** 素材图(data URL 或 serveUrl 可达地址);outro 为纯排版场景可不传 */
  src?: string;
  seconds?: number;
}

export const XHS_SCENE_DEFAULT_SECONDS: Record<XhsVideoSceneKind, number> = {
  cover: 2.5,
  card: 4.5,
  outro: 2,
};

export interface XhsVideoSceneTiming extends XhsVideoSceneInput {
  seconds: number;
  fromFrame: number;
  durationInFrames: number;
}

export interface XhsVideoTimeline {
  fps: number;
  durationInFrames: number;
  scenes: XhsVideoSceneTiming[];
}

export type XhsVideoAspect = 'portrait' | 'landscape';

export interface XhsVideoDimensions {
  width: number;
  height: number;
}

const XHS_VIDEO_DIMENSIONS: Record<XhsVideoAspect, XhsVideoDimensions> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

/**
 * manifest.aspect(或 inputProps.aspect)→ 画布尺寸。缺省(undefined)= 'portrait' = 现状
 * 1080x1920,零变化;'landscape' = 1920x1080。参数按 string 收窄(非直接用 XhsVideoAspect)
 * 是因为真实输入来自 JSON.parse 的 manifest,静态类型管不住运行时野值——非法值直接抛错,
 * 不静默兜底成任意画幅。
 */
export function resolveXhsVideoDimensions(aspect?: string): XhsVideoDimensions {
  const key = aspect ?? 'portrait';
  if (key !== 'portrait' && key !== 'landscape') {
    throw new Error(`非法 aspect: ${aspect}`);
  }
  return XHS_VIDEO_DIMENSIONS[key];
}

export interface XhsImageFitStyle {
  width?: string;
  maxWidth?: string;
  maxHeight?: string;
  height?: string;
  objectFit?: 'contain';
}

/**
 * ImageScene 素材图尺寸约束。竖版(isLandscape=false)→ 只有 width:'94%'(现状不变,像素级)。
 * 横版画布更矮(1920x1080),3:4 及更长素材按宽缩放会超高、被居中裁切(标题/表头丢失)→
 * 改用 maxWidth+maxHeight(width/height:auto 让浏览器按交集缩放,borderRadius/boxShadow
 * 仍紧贴实际图片边缘,不留透明留白),确保素材完整 contain 进画面。
 */
export function resolveXhsImageFitStyle(isLandscape: boolean): XhsImageFitStyle {
  if (isLandscape) {
    return { maxWidth: '94%', maxHeight: '86%', width: 'auto', height: 'auto', objectFit: 'contain' };
  }
  return { width: '94%' };
}

/**
 * OutroScene 字号/间距缩放系数。字号/间距字面量是照竖版 1080x1920 画布调的死值。
 * 竖版(isLandscape=false)→ Math.min(width/1080, height/1920),1080x1920 时 scale=1,
 * 像素级不变。横版(isLandscape=true)→ 画布更矮更宽(1920x1080),若沿用竖版分母 1920
 * 会把 scale 收得过小(0.5625),标题只占画布宽约 25%、显空;起步试过分母 720(scale=1.5)
 * 实渲量得标题占宽达 68%,超出目标上限——改用横版专属基准分母 1000,1920x1080 时
 * scale=1.08,实渲量得标题占画布宽度约 49%,落在目标 40%-55% 区间、整块文字组竖直居中不显空。
 */
export function resolveXhsOutroScale(width: number, height: number): number {
  const isLandscape = width > height;
  return isLandscape ? Math.min(width / 1080, height / 1000) : Math.min(width / 1080, height / 1920);
}

export function buildXhsVideoTimeline(input: {
  scenes: XhsVideoSceneInput[];
  fps?: number;
}): XhsVideoTimeline {
  const fps = input.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps 必须为正数: ${fps}`);
  if (!input.scenes?.length) throw new Error('至少需要 1 个场景');
  let cursor = 0;
  const scenes = input.scenes.map((scene) => {
    const seconds = scene.seconds ?? XHS_SCENE_DEFAULT_SECONDS[scene.kind];
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`场景时长非法: ${String(scene.seconds)}`);
    }
    if (scene.kind !== 'outro' && !scene.src) throw new Error(`${scene.kind} 场景缺素材图`);
    const durationInFrames = Math.max(1, Math.round(seconds * fps));
    const timing: XhsVideoSceneTiming = { ...scene, seconds, fromFrame: cursor, durationInFrames };
    cursor += durationInFrames;
    return timing;
  });
  return { fps, durationInFrames: cursor, scenes };
}

/**
 * 老李口播片(或任意竖版成片)片头拼 xhs 封面页:封面静帧 coverSec 秒 + 原片,
 * 原片音轨整体顺延 coverSec。封面 3:4 → 深蓝 pad 到 9:16;concat 全程统一 fps/SAR/yuv420p。
 */
export function buildCoverPrependArgs(input: {
  coverInput: string;
  videoInput: string;
  output: string;
  coverSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  padColor?: string;
}): string[] {
  const coverSec = input.coverSec ?? 2.5;
  if (!Number.isFinite(coverSec) || coverSec <= 0) throw new Error(`封面时长非法: ${String(input.coverSec)}`);
  const w = input.width ?? 1080;
  const h = input.height ?? 1920;
  const fps = input.fps ?? 30;
  const pad = input.padColor ?? '0x0b1230';
  const delayMs = Math.round(coverSec * 1000);
  return [
    '-y',
    '-loop', '1', '-t', String(coverSec), '-i', input.coverInput,
    '-i', input.videoInput,
    '-filter_complex',
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,`
    + `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${pad},setsar=1,fps=${fps},format=yuv420p[c];`
    + `[1:v]fps=${fps},setsar=1,format=yuv420p[m];`
    + `[1:a]adelay=${delayMs}:all=1[da];`
    + `[c][m]concat=n=2:v=1:a=0[v]`,
    '-map', '[v]',
    '-map', '[da]',
    '-c:v', 'libx264',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    '-metadata', 'comment=AI生成内容',
    input.output,
  ];
}

/**
 * 老李口播片封面页·叠加式(founder 2026-07-05:解说从封面页开始,封面页右下角保留老李形象):
 * 封面盖在成片前 coverSec 秒的画面上,音轨原样不顺延——老李第一句 hook(结构=比分+胜负手金句,
 * 天然是封面解读)直接压着封面讲。封面 3:4 → 深蓝 pad 到 9:16 后裁掉底部(默认保留 y≥1640
 * 的字幕区),首句字幕照常可见。可选 pip:把成片右下角"说话中的老李"窗口从底片裁出、
 * 再叠回封面之上(坐标=生产 laoli-reel-compose 的 PIP 常量),封面页上老李是活的。
 */
export function buildCoverOverlayArgs(input: {
  coverInput: string;
  videoInput: string;
  output: string;
  coverSec?: number;
  width?: number;
  height?: number;
  padColor?: string;
  /** 封面叠加层保留到的高度(其下露出原片字幕区) */
  subtitleSafeY?: number;
  /** 老李 PiP 窗口(裁自底片同位置再叠回封面上);默认对齐生产 laoli-reel-compose 常量 */
  pip?: { x: number; y: number; w: number; h: number };
}): string[] {
  const coverSec = input.coverSec ?? 2.5;
  if (!Number.isFinite(coverSec) || coverSec <= 0) throw new Error(`封面时长非法: ${String(input.coverSec)}`);
  const w = input.width ?? 1080;
  const h = input.height ?? 1920;
  const pad = input.padColor ?? '0x0b1230';
  const safeY = input.subtitleSafeY ?? 1640;
  const pip = input.pip;
  if (pip && !(pip.w > 0 && pip.h > 0 && pip.x >= 0 && pip.y >= 0)) {
    throw new Error(`pip 窗口非法: ${JSON.stringify(pip)}`);
  }

  const inputs = [
    '-i', input.videoInput,
    '-loop', '1', '-t', String(coverSec), '-i', input.coverInput,
  ];
  let filter = pip ? `[0:v]split=2[base][pipsrc];` : '';
  filter +=
    `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,`
    + `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${pad},crop=${w}:${safeY}:0:0,setsar=1[cov];`
    + `[${pip ? 'base' : '0:v'}][cov]overlay=0:0:eof_action=pass[v0]`;
  let lastLabel = 'v0';
  if (pip) {
    filter += `;[pipsrc]crop=${pip.w}:${pip.h}:${pip.x}:${pip.y}[pipwin];`
      + `[v0][pipwin]overlay=${pip.x}:${pip.y}:enable='lte(t,${coverSec})':eof_action=pass[vp]`;
    lastLabel = 'vp';
  }
  return [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', `[${lastLabel}]`,
    '-map', '0:a',
    '-c:v', 'libx264',
    '-crf', '20',
    '-c:a', 'copy',
    '-shortest',
    '-movflags', '+faststart',
    '-metadata', 'comment=AI生成内容',
    input.output,
  ];
}

export function buildXhsBgmMuxArgs(input: {
  visualInput: string;
  bgmInput: string;
  output: string;
  durationSec: number;
  bgmVolume?: number;
}): string[] {
  const volume = input.bgmVolume ?? 0.25;
  const fadeStart = Math.max(0, input.durationSec - 1.2);
  return [
    '-y',
    '-i', input.visualInput,
    '-stream_loop', '-1', '-i', input.bgmInput,
    '-filter_complex', `[1:a]volume=${volume},afade=t=out:st=${fadeStart}:d=1.2[a]`,
    '-map', '0:v:0',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-t', String(input.durationSec),
    '-movflags', '+faststart',
    '-metadata', 'comment=AI生成内容',
    input.output,
  ];
}
