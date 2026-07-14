/**
 * 老李 reel 字幕/水印/兜底底图 PNG —— satori(文字转矢量)→ resvg 渲染。
 * 走 share-cards 同一管线:**不依赖系统 fontconfig**(绕开 ffmpeg drawtext/libass 的 CJK 豆腐块坑),
 * 字体取 @qhs/share-cards 的 FONTS(NotoSansSC,Dockerfile 已 cp 进 standalone)。
 * 字幕/水印**透明底**(给 ffmpeg overlay);标题兜底是**不透明全屏底图**(brief 全缺时铺底)。
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FONTS } from '@qhs/share-cards';

type SatoriNode = Parameters<typeof satori>[0];

/** 裸元素树(非 typed 模板)→ PNG。tree:unknown 再 cast 成 satori 入参,避开 ReactNode 类型摩擦(不用 any)。 */
async function toPng(tree: unknown, width: number, height: number, background?: string): Promise<Buffer> {
  const svg = await satori(tree as SatoriNode, { width, height, fonts: FONTS });
  const resvg = background ? new Resvg(svg, { background }) : new Resvg(svg);
  return Buffer.from(resvg.render().asPng());
}

const SUB_W = 1080;
const SUB_H = 240;

/** 底部字幕带(透明底·暗色圆角条衬白字,任意背景都清晰)。空文本→透明空图,不崩。 */
export async function renderReelSubtitlePng(line: string): Promise<Buffer> {
  const text = (line || '').trim();
  // 字号自适应:长旁白降号,保证 240px 画布内最多 3 行不溢出(故事化旁白 event 段可到 72 字)。
  const fontSize = text.length > 64 ? 34 : text.length > 52 ? 38 : text.length > 38 ? 42 : 50;
  const bar = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        maxWidth: '960px',
        padding: '14px 32px',
        borderRadius: '18px',
        backgroundColor: 'rgba(0,0,0,0.58)',
        color: '#FFFFFF',
        fontFamily: 'NotoSansSC',
        fontWeight: 900,
        fontSize,
        lineHeight: 1.28,
        textAlign: 'center',
      },
      children: text,
    },
  };
  const tree = {
    type: 'div',
    props: {
      style: { width: `${SUB_W}px`, height: `${SUB_H}px`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '24px' },
      children: text ? [bar] : [],
    },
  };
  return toPng(tree, SUB_W, SUB_H); // 透明
}

const BANNER_W = 1080;
const BANNER_H = 300;

/** 顶部大标题钩子(2026-07-06 抖音版式:居中大字·半透暗带,压顶部安全区,吸引点击)。空→透明空图。 */
export async function renderReelBannerPng(hook: string): Promise<Buffer> {
  const text = (hook || '').trim();
  if (!text) return toPng({ type: 'div', props: { style: { width: `${BANNER_W}px`, height: `${BANNER_H}px`, display: 'flex' } } }, BANNER_W, BANNER_H);
  // 字号自适应:钩子越短越大(≤12字最佳);15+ 字降到 54(一行放不下时优雅折两行,band 300px 够高)
  const fontSize = text.length > 15 ? 54 : text.length > 13 ? 62 : text.length > 10 ? 72 : text.length > 7 ? 82 : 92;
  const band = {
    type: 'div',
    props: {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        maxWidth: '1000px', padding: '18px 40px', borderRadius: '22px',
        backgroundColor: 'rgba(8,10,18,0.72)',
        color: '#FFFFFF', fontFamily: 'NotoSansSC', fontWeight: 900, fontSize, lineHeight: 1.22,
      },
      children: text,
    },
  };
  const tree = {
    type: 'div',
    props: {
      style: { width: `${BANNER_W}px`, height: `${BANNER_H}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 40px' },
      children: [band],
    },
  };
  return toPng(tree, BANNER_W, BANNER_H); // 透明底,带内部半透暗带
}

/** 常驻「AI生成内容」水印(透明底·右上角用·合规红线像素层)。 */
export async function renderReelWatermarkPng(label = 'AI生成内容'): Promise<Buffer> {
  const pill = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        padding: '10px 20px',
        borderRadius: '14px',
        backgroundColor: 'rgba(0,0,0,0.32)',
        color: 'rgba(255,255,255,0.88)',
        fontFamily: 'NotoSansSC',
        fontWeight: 700,
        fontSize: 30,
      },
      children: label,
    },
  };
  const tree = {
    type: 'div',
    props: {
      style: { width: '380px', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
      children: [pill],
    },
  };
  return toPng(tree, 380, 90);
}

/** brief/数据卡全缺时的兜底全屏底图(不透明·深色+标题)。 */
export async function renderReelTitleBgPng(title: string): Promise<Buffer> {
  const tree = {
    type: 'div',
    props: {
      style: {
        width: '1080px',
        height: '1920px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0B1020',
        padding: '0 90px',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', color: '#FFFFFF', fontFamily: 'NotoSansSC', fontWeight: 900, fontSize: 72, lineHeight: 1.3, textAlign: 'center' },
            children: title || '老李赛后说',
          },
        },
      ],
    },
  };
  return toPng(tree, 1080, 1920);
}
