/**
 * 小红书笔记封面生成器(定版公式:悬念戏剧数字双色大字 + 可选国旗比分块)。
 * 用法: cd web && ./node_modules/.bin/tsx scripts/xhs-note-cover.ts <config.json>
 * config 字段:
 *   out:      输出 PNG 绝对路径
 *   badge:    左上金色角标文字(如「北京时间今晨 · 淘汰赛32强」)
 *   lines:    大字行 [{t:'文字', c:'w'|'g'}](白/金,2-3 行,每行≤7字)
 *   score?:   国旗比分块 {home,homeFlag,score,away,awayFlag,subline?}(flag=web/public/flags 的 ISO 码)
 *   box?:     无比分时的信息块(字符串数组,如金靴榜看点行)
 *   bottom:   底部 hook 一行(如「睡过今晨这场的姐妹,一条给你讲明白」)
 * 红线:大字/角标/底行不得含「最/第一/绝对/必/史上」;详见 tasks/XHS-OPERATION-SOP §4/§6/§12。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const Ff = (w: string) => require.resolve(`@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-${w}-normal.woff`);
const FONTS = [
  { name: 'NotoSansSC', data: readFileSync(Ff('400')), weight: 400 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(Ff('700')), weight: 700 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(Ff('900')), weight: 900 as const, style: 'normal' as const },
];
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, ''); // web/
const b64 = (iso: string) => `data:image/png;base64,${readFileSync(`${ROOT}/public/flags/${iso}.png`).toString('base64')}`;

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
function el(type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  let p = props || {};
  if (type === 'div') { const s = (p.style || {}) as Record<string, unknown>; if (!s.display) p = { ...p, style: { display: 'flex', ...s } }; }
  return { type, props: { ...p, children: kids.length === 1 ? kids[0] : kids } };
}

interface Cfg {
  out: string; badge: string;
  lines: { t: string; c: 'w' | 'g' }[];
  score?: { home: string; homeFlag: string; score: string; away: string; awayFlag: string; subline?: string };
  box?: string[];
  bottom: string;
  /** 真实比赛照片打底(绝对路径,jpg/png):铺满 1080×1440(cover 裁切)+暗化遮罩保大字可读。
   *  founder 2026-07-04 拍板:战报封面可用真实比赛照(仅小红书端);护栏见 SOP §12c——
   *  ①图不进小程序/公众号 ②优先无明显赛事商标构图 ③加字二创形态 ④被投诉即撤换回文字卡。 */
  bgImage?: string;
  /** 抖音横版封面(2026-07-06 founder):有照片时自动**再出一张 1440×1080(4:3·抖音横封面槽)横版**(文案沉左下、右留人物)。
   *  landscape:false 关闭;landscapeOut 覆盖输出路径(缺省=在 out 文件名后缀前插 -landscape)。文字卡(无照片)不出横版。 */
  landscape?: boolean;
  landscapeOut?: string;
}
const cfg: Cfg = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const BANNED = /最|第一|绝对|史上/; // 「必」单字误伤率高(必须/必看少用即可),四词硬拦
for (const s of [cfg.badge, ...cfg.lines.map((l) => l.t), cfg.bottom, ...(cfg.box || []), cfg.score?.subline || '']) {
  if (BANNED.test(s)) { console.error(`红线词命中: ${s}`); process.exit(1); }
}

const W = 1080, H = 1440, GOLD = '#FFC857', TEXT = '#F3F5FF', MUTED = '#A6AECB';
const BG = 'linear-gradient(160deg, #101534 0%, #1A2150 46%, #090B1A 100%)';
const flag = (iso: string) => el('img', { src: b64(iso), width: 56, height: 42, style: { borderRadius: 6, objectFit: 'cover' } });

const bgDataUrl = cfg.bgImage
  ? `data:image/${cfg.bgImage.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(cfg.bgImage).toString('base64')}`
  : null;

// 比分块 / 信息块(两种布局共用)。
// narrow=照片模式专用(founder 2026-07-05):左置窄版(宽 624,右缘 688)给老李视频
// PiP 区让位(2026-07-06 起 PiP 缩至 x≥840,旧口径 688<720 更保守,继续沿用),字号相应微缩;文字卡定版版式不动。
const scoreBlock = (marginTop: number, narrow = false) => {
  if (!cfg.score) return el('div', {});
  const nameFs = narrow ? 38 : 44;
  const scoreFs = narrow ? 44 : 48;
  const sublineFs = narrow ? 26 : 30;
  const gap = narrow ? 14 : 18;
  const fl = (iso: string) => narrow
    ? el('img', { src: b64(iso), width: 48, height: 36, style: { borderRadius: 6, objectFit: 'cover' } })
    : flag(iso);
  return el('div', { style: { marginTop, flexDirection: 'column', gap: 14, backgroundColor: 'rgba(10,12,26,0.6)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: narrow ? '22px 24px' : '26px 34px', ...(narrow ? { width: 624, alignSelf: 'flex-start' } : {}) } },
    el('div', { style: { alignItems: 'center', justifyContent: 'space-between' } },
      el('div', { style: { alignItems: 'center', gap } }, fl(cfg.score.homeFlag), el('div', { style: { color: TEXT, fontSize: nameFs, fontWeight: 700 } }, cfg.score.home)),
      el('div', { style: { color: GOLD, fontSize: scoreFs, fontWeight: 900 } }, cfg.score.score),
      el('div', { style: { alignItems: 'center', gap } }, el('div', { style: { color: TEXT, fontSize: nameFs, fontWeight: 700 } }, cfg.score.away), fl(cfg.score.awayFlag))),
    cfg.score.subline ? el('div', { style: { color: MUTED, fontSize: sublineFs, justifyContent: 'center' } }, cfg.score.subline) : el('div', {}),
  );
};
const boxBlock = (marginTop: number) => cfg.box && cfg.box.length
  ? el('div', { style: { marginTop, flexDirection: 'column', gap: 22, backgroundColor: 'rgba(10,12,26,0.6)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: '30px 34px' } },
      ...cfg.box.map((t) => el('div', { style: { color: TEXT, fontSize: 38, fontWeight: 700 } }, t)))
  : el('div', {});
const badgePill = el('div', { style: { alignSelf: 'flex-start', backgroundColor: GOLD, color: '#1a1200', fontSize: 30, fontWeight: 700, padding: '12px 26px', borderRadius: 999 } }, cfg.badge);

// 文字卡布局(定版公式,验证过的版式,不动):大字居中上部
const textCardTree = el('div', { style: { width: W, height: H, flexDirection: 'column', backgroundImage: BG, fontFamily: 'NotoSansSC', position: 'relative', padding: 64 } },
  badgePill,
  el('div', { style: { flexDirection: 'column', marginTop: 140 } },
    ...cfg.lines.map((l, i) => el('div', { style: { color: l.c === 'g' ? GOLD : '#ffffff', fontSize: 124, fontWeight: 900, lineHeight: 1.08, marginTop: i && l.c === 'g' ? 10 : 0 } }, l.t))),
  scoreBlock(76),
  boxBlock(76),
  el('div', { style: { position: 'absolute', left: 64, right: 64, bottom: 64, color: MUTED, fontSize: 34, justifyContent: 'center' } }, cfg.bottom),
);

// 照片布局(founder 反馈 2026-07-04:大字不得遮人物情绪面孔):
// 上 2/3 留给照片(面孔通常在上半区),文案整体沉底;遮罩上轻下重,底部文案区近实底可读。
const photoTree = bgDataUrl ? el('div', { style: { width: W, height: H, flexDirection: 'column', justifyContent: 'flex-end', fontFamily: 'NotoSansSC', position: 'relative', padding: '64px 64px 56px' } },
  el('img', { src: bgDataUrl, width: W, height: H, style: { position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' } }),
  el('div', { style: { position: 'absolute', top: 0, left: 0, width: W, height: H, backgroundImage: 'linear-gradient(180deg, rgba(9,11,26,0.30) 0%, rgba(9,11,26,0.06) 30%, rgba(9,11,26,0.10) 52%, rgba(9,11,26,0.72) 74%, rgba(9,11,26,0.94) 100%)' } }),
  el('div', { style: { position: 'absolute', top: 64, left: 64 } }, badgePill),
  el('div', { style: { flexDirection: 'column' } },
    ...cfg.lines.map((l, i) => el('div', { style: { color: l.c === 'g' ? GOLD : '#ffffff', fontSize: 108, fontWeight: 900, lineHeight: 1.1, marginTop: i && l.c === 'g' ? 8 : 0 } }, l.t))),
  scoreBlock(36, true),
  boxBlock(36),
  el('div', { style: { marginTop: 26, color: MUTED, fontSize: 34, justifyContent: 'center' } }, cfg.bottom),
) : null;

const portraitTree = photoTree ?? textCardTree;

// 抖音横版封面(**4:3·1440×1080**,抖音横封面槽尺寸,2026-07-06 founder 依抖音「封面不佳·文字展示不全」提示修正:
// 原 16:9 与抖音 4:3 槽不符会被裁到文字缺角)。照片铺满,文案沉**左下**并限宽(右侧留人物情绪面孔),
// 全部文字落安全边距内、不贴边(防抖音判「文字展示不全」)。双层遮罩(底重+左重)保左下文案可读。仅照片模式出横版。
const LW = 1440, LH = 1080;
// bgUrl 传**已裁成 1440×1080** 的横版底图(sharp 顶部锚定裁·保人脸,见下 IIFE);img 只需铺满。
function buildLandscapeTree(bgUrl: string): Node {
  return el('div', { style: { width: LW, height: LH, flexDirection: 'column', justifyContent: 'flex-end', fontFamily: 'NotoSansSC', position: 'relative', padding: '56px 64px 56px' } },
    el('img', { src: bgUrl, width: LW, height: LH, style: { position: 'absolute', top: 0, left: 0, width: LW, height: LH, objectFit: 'cover' } }),
    el('div', { style: { position: 'absolute', top: 0, left: 0, width: LW, height: LH, backgroundImage: 'linear-gradient(180deg, rgba(9,11,26,0.28) 0%, rgba(9,11,26,0.04) 24%, rgba(9,11,26,0.14) 48%, rgba(9,11,26,0.82) 72%, rgba(9,11,26,0.96) 100%)' } }),
    el('div', { style: { position: 'absolute', top: 0, left: 0, width: LW, height: LH, backgroundImage: 'linear-gradient(90deg, rgba(9,11,26,0.70) 0%, rgba(9,11,26,0.26) 42%, rgba(9,11,26,0.00) 74%)' } }),
    el('div', { style: { position: 'absolute', top: 56, left: 64 } }, badgePill),
    el('div', { style: { flexDirection: 'column', maxWidth: 940 } },
      ...cfg.lines.map((l, i) => el('div', { style: { color: l.c === 'g' ? GOLD : '#ffffff', fontSize: 80, fontWeight: 900, lineHeight: 1.12, marginTop: i && l.c === 'g' ? 8 : 0 } }, l.t))),
    scoreBlock(28, true),
    boxBlock(28),
    el('div', { style: { marginTop: 20, color: MUTED, fontSize: 32, justifyContent: 'flex-start' } }, cfg.bottom),
  );
}

async function renderOne(tree: Node, w: number, h: number, out: string): Promise<void> {
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: w, height: h, fonts: FONTS });
  const png = new Resvg(svg, { background: '#090B1A' }).render().asPng();
  writeFileSync(out, png);
  console.log('WROTE', out, png.length);
}

(async () => {
  await renderOne(portraitTree, W, H, cfg.out);
  // 抖音横版:仅照片封面出(文字卡无照片,横版意义不大);landscape:false 可关
  if (cfg.bgImage && cfg.landscape !== false) {
    // ⚠️ satori 不支持 img objectPosition(2026-07-07 实测:center top 无效仍居中裁,把顶部人脸切掉)。
    // 改用 **sharp 顶部锚定**(fit:cover + position:top)先把源图裁成 1440×1080 4:3——竖图源(3:4)裁 4:3 时
    // 保住上部的人脸(2026-07-07 美比横版把普利西奇脸裁没了的坑)。
    const sharp = (await import('sharp')).default;
    const cropped = await sharp(cfg.bgImage).resize(LW, LH, { fit: 'cover', position: 'top' }).png().toBuffer();
    const lbg = `data:image/png;base64,${cropped.toString('base64')}`;
    const lout = cfg.landscapeOut ?? cfg.out.replace(/(\.[a-z0-9]+)$/i, '-landscape$1');
    await renderOne(buildLandscapeTree(lbg), LW, LH, lout);
  }
})();
