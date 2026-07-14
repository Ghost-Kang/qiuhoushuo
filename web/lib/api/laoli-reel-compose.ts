/**
 * 老李 reel ffmpeg 合成器(纯 ffmpeg·无 Remotion/Chromium)。
 * 单趟 main-pass 一条 filter_complex(2026-07-06 抖音版式:去老李 PiP):
 *   深色画布 + N 张主画面按时间窗 overlay(数据卡 contain 缩窄顶对齐 / 镜头图 cover 填满)
 *   + 顶部大标题钩子 banner 全程常驻 + 常驻「AI生成内容」水印(无 enable·不可关·合规红线)
 *   + N 段字幕按窗 overlay(卡片下方暗带) + N 段旁白 mp3 concat + apad → 9:16/1080×1920/H.264+AAC/T 秒。
 * 纯函数 buildLaoliReelFfmpegArgs 可单测;composeLaoliReel 管 temp 落盘 + 跑 + 清。
 * -threads 2 限 x264 内存峰值(让出 CPU 给在线 API,见 spec G2)。
 */
import { runFfmpeg } from './laoli-ffmpeg';

const CANVAS = 's=1080x1920';
const BG = '0x0B1020';
// 2026-07-06 founder「抖音版式」重排 → 2026-07-07 真机复调(字幕被抖音底部 UI 挡)。
// 抖音底部「简介/定位/作者声明/合集」条实际占到 ~y1350 起(比原估 y1620 高很多),
// 故:数据卡缩窄变矮(整体上移)+ 字幕上移到 ~y1290-1330,把底部 30%(y1350+)整块留给抖音 UI。
//   顶部大标题钩子(居中)y10 → 数据卡 contain 缩到 700 宽·顶对齐 y330(3:4→700×933,y330-1263;数据在上 2/3、右缘 x840 避右按钮)
//   → 字幕上移到卡片下方暗带 SUB_Y(内部条落 ~y1190-1330,只压卡片页脚不遮数据)→ 底部 y1350+ 全留抖音 UI。
const BANNER_Y = 10;      // 顶部钩子 overlay y
const CARD_W = 700;       // 数据卡(contain)缩放宽度(3:4 → 700×933,y330-1263;2026-07-07 由 860 缩到 700 让卡变矮上移)
const CARD_Y = 330;       // 数据卡顶部对齐 y(钩子之下)
const SUB_Y = 1100;       // 字幕 PNG overlay y(内部条底对齐→文字落 ~y1190-1330,卡片下方、抖音底部 UI 之上;2026-07-07 由 1374 上移)
// 背景乐(founder 2026-07-07:统一加一首·压在解说之下·结尾定时淡出防突兀)。
const BGM_VOL = 0.22;     // BGM 铺底音量(压在旁白之下但要听得见;bgm1 源 ~-16dB × 0.22 ≈ 混音 -29dB,低于旁白 ~-23dB 约 6dB)
const BGM_FADE_OUT = 3;   // 结尾淡出秒数(定时·避免戛然而止)
const BGM_FADE_IN = 1.2;  // 开头淡入秒数(避免突兀切入)

export interface LaoliReelScenePlan {
  backgroundPath: string;
  bgFit: 'contain' | 'cover';
  startSec: number;
  endSec: number;
  subtitlePath: string;
  narrationPath: string;
}

export interface LaoliReelComposeAssets {
  scenes: LaoliReelScenePlan[];
  bannerPath: string;      // 顶部大标题钩子 PNG(透明底);空钩子=透明空图
  watermarkPath: string;
  totalSec: number;
  output: string;
  bgmPath?: string;        // 背景乐 mp3(可选);给了就循环铺满 + 压低音量 + 结尾淡出,混进旁白。缺省=纯旁白(向后兼容)
}

/** main-pass(抖音版式):顶部钩子 + 数据卡顶对齐(contain 缩窄)/镜头图填满(cover) + 水印 + 字幕 + 旁白混音。
 *  去掉老李 PiP;关键信息避开抖音右按钮列与底栏。纯函数,arg/索引可单测。 */
export function buildLaoliReelFfmpegArgs(p: LaoliReelComposeAssets): string[] {
  const T = p.totalSec;
  const N = p.scenes.length;
  const CARD_X = Math.round((1080 - CARD_W) / 2); // 数据卡水平居中 x
  const args: string[] = ['-y'];
  let idx = 0;
  // input 0:深色基底画布
  args.push('-f', 'lavfi', '-t', String(T), '-i', `color=c=${BG}:${CANVAS}:r=30`);
  const baseIdx = idx++;
  // 背景图 inputs
  const bgIdx: number[] = [];
  for (const sc of p.scenes) { args.push('-loop', '1', '-i', sc.backgroundPath); bgIdx.push(idx++); }
  // 顶部钩子 banner
  args.push('-loop', '1', '-i', p.bannerPath); const bannerIdx = idx++;
  // 水印
  args.push('-loop', '1', '-i', p.watermarkPath); const wmIdx = idx++;
  // 字幕 inputs
  const subIdx: number[] = [];
  for (const sc of p.scenes) { args.push('-loop', '1', '-i', sc.subtitlePath); subIdx.push(idx++); }
  // 旁白 mp3 inputs
  const narrIdx: number[] = [];
  for (const sc of p.scenes) { args.push('-i', sc.narrationPath); narrIdx.push(idx++); }
  // 背景乐(可选):-stream_loop -1 循环铺满(BGM 常短于视频),后续 atrim 到 T
  let bgmInputIdx = -1;
  if (p.bgmPath) { args.push('-stream_loop', '-1', '-i', p.bgmPath); bgmInputIdx = idx++; }

  const f: string[] = [];
  // 背景缩放:contain(数据卡→缩到 CARD_W 宽·不裁字,顶部对齐)/ cover(镜头图/照片→填满全屏)
  p.scenes.forEach((sc, i) => {
    f.push(sc.bgFit === 'cover'
      ? `[${bgIdx[i]!}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[img${i}]`
      : `[${bgIdx[i]!}:v]scale=${CARD_W}:-1,setsar=1,fps=30[img${i}]`);
  });
  // 背景按时间窗逐层 overlay(cover→满屏 0:0;contain→居中顶对齐 CARD_X:CARD_Y)
  let cur = `[${baseIdx}:v]`;
  p.scenes.forEach((sc, i) => {
    const out = `[b${i}]`;
    const pos = sc.bgFit === 'cover' ? '0:0' : `${CARD_X}:${CARD_Y}`;
    f.push(`${cur}[img${i}]overlay=${pos}:enable='between(t,${sc.startSec},${sc.endSec})'${out}`);
    cur = out;
  });
  // 顶部钩子 banner(全程常驻·居中于自身 PNG,overlay x=0 top)
  f.push(`[${bannerIdx}:v]scale=1080:-1,setsar=1,fps=30[banner]`);
  f.push(`${cur}[banner]overlay=0:${BANNER_Y}[bp]`);
  // 水印(无 enable → 全程常驻·不可关·右上)
  f.push(`[bp][${wmIdx}:v]overlay=W-w-30:40[bw]`);
  // 字幕逐窗 overlay(卡片下方暗带,字幕 PNG 内左对齐限宽避右按钮)
  cur = '[bw]';
  p.scenes.forEach((sc, i) => {
    const out = i === N - 1 ? '[vout]' : `[s${i}]`;
    f.push(`${cur}[${subIdx[i]!}:v]overlay=0:${SUB_Y}:enable='between(t,${sc.startSec},${sc.endSec})'${out}`);
    cur = out;
  });
  // 旁白:各段统一格式 → concat → apad 补到 T(防音轨短于画面早停)
  p.scenes.forEach((_, i) => f.push(`[${narrIdx[i]!}:a]aformat=sample_rates=44100:channel_layouts=mono[a${i}]`));
  const aInputs = p.scenes.map((_, i) => `[a${i}]`).join('');
  f.push(`${aInputs}concat=n=${N}:v=0:a=1[voiceraw]`);
  if (bgmInputIdx >= 0) {
    // BGM:裁到 T → 立体声 → 压低音量 → 淡入/结尾定时淡出 → 与旁白 amix。
    // normalize=0:旁白全量不被衰减(始终盖过 BGM);alimiter 兜底防旁白+乐叠加偶发削顶。
    const fadeOut = Math.min(BGM_FADE_OUT, T);
    const fadeOutStart = Math.max(0, T - fadeOut).toFixed(2);
    const fadeIn = Math.min(BGM_FADE_IN, T / 2).toFixed(2);
    f.push(`[voiceraw]apad=whole_dur=${T},aformat=sample_rates=44100:channel_layouts=stereo[voice]`);
    f.push(`[${bgmInputIdx}:a]atrim=0:${T},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,volume=${BGM_VOL},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(2)}[bgm]`);
    f.push(`[voice][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
  } else {
    f.push(`[voiceraw]apad=whole_dur=${T}[aout]`);
  }

  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-r', '30', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-t', String(T), '-movflags', '+faststart', '-metadata', 'comment=AI生成内容',
    p.output);
  return args;
}

export interface ComposeReelScene {
  background: Buffer; // 已 resolve(含 null→标题兜底)
  bgExt: 'png' | 'jpg';
  bgFit: 'contain' | 'cover';
  startSec: number;
  endSec: number;
  subtitle: Buffer;
  narrationMp3: Buffer;
}

export interface ComposeReelInput {
  scenes: ComposeReelScene[];
  banner: Buffer;      // 顶部大标题钩子 PNG(透明底;空钩子=透明空图)
  watermark: Buffer;
  totalSec: number;
  bgm?: Buffer;        // 背景乐 mp3(可选);给了就混进旁白(压低+结尾淡出)。缺省=纯旁白
}

export async function composeLaoliReel(
  input: ComposeReelInput,
  deps: { runFfmpeg?: typeof runFfmpeg; ffmpegPath?: string } = {},
): Promise<{ video: Buffer; durationSec: number }> {
  const run = deps.runFfmpeg ?? runFfmpeg;
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laoli-reel-'));
  try {
    const scenePlans: LaoliReelScenePlan[] = [];
    for (let i = 0; i < input.scenes.length; i += 1) {
      const sc = input.scenes[i]!;
      const bgPath = path.join(dir, `bg-${i}.${sc.bgExt}`);
      const subPath = path.join(dir, `sub-${i}.png`);
      const narrPath = path.join(dir, `narr-${i}.mp3`);
      await fs.writeFile(bgPath, sc.background);
      await fs.writeFile(subPath, sc.subtitle);
      await fs.writeFile(narrPath, sc.narrationMp3);
      scenePlans.push({ backgroundPath: bgPath, bgFit: sc.bgFit, startSec: sc.startSec, endSec: sc.endSec, subtitlePath: subPath, narrationPath: narrPath });
    }
    const wmPath = path.join(dir, 'wm.png');
    await fs.writeFile(wmPath, input.watermark);
    const bannerPath = path.join(dir, 'banner.png');
    await fs.writeFile(bannerPath, input.banner);
    let bgmPath: string | undefined;
    if (input.bgm) {
      bgmPath = path.join(dir, 'bgm.mp3');
      await fs.writeFile(bgmPath, input.bgm);
    }

    const output = path.join(dir, 'final.mp4');
    // 超时随片长伸缩:五拍片(押球人机对决版 ~50s+)在 180s 固定上限下首跑即超时(2026-07-11 ep4 实测)
    const composeTimeoutMs = Math.max(180_000, Math.round(input.totalSec * 5_000) + 120_000);
    await run(buildLaoliReelFfmpegArgs({ scenes: scenePlans, bannerPath, watermarkPath: wmPath, totalSec: input.totalSec, output, bgmPath }), deps.ffmpegPath, { timeoutMs: composeTimeoutMs });

    const video = await fs.readFile(output);
    return { video, durationSec: input.totalSec };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
