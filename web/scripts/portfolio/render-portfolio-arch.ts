/**
 * 作品复盘视频架构图(16:9 · 1920×1080)。
 * 手写 SVG(节点=圆角矩形,连线/箭头=SVG path+polygon,不用 unicode 箭头字形)→ @resvg/resvg-js 光栅化。
 *
 * 字体坑:resvg-js 2.6.2 内置 fontdb 不支持 woff/woff2(实测:两者都 "malformed font" / 静默不渲染),
 * 只认 ttf/otf/ttc。项目里的 NotoSansSC 只有 woff/woff2(@fontsource/noto-sans-sc),
 * 所以这里在运行时把 woff 解包成 sfnt(ttf)写到系统临时目录,再喂给 resvg 的 font.fontFiles。
 * (woff1 = zlib 逐表压缩的 sfnt,解包只需按 WOFF1 头表还原 table directory + inflate 每张表。)
 *
 * 红线自查(渲染前跑 assertClean):不得出现 /path/to、IP、密钥、webhook、COS 桶名、容器名、
 * 具体数据供应商名、「押」字、球星人名。
 *
 * 用法: cd web && ./node_modules/.bin/tsx scripts/portfolio/render-portfolio-arch.ts
 * 产物: tasks/assets/portfolio-arch-pipeline-20260710.png
 *       tasks/assets/portfolio-arch-crossplatform-20260710.png
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');

// ── WOFF1 → SFNT(ttf) 解包 ──────────────────────────────────────────────
function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables: { tag: number; data: Buffer; checksum: number }[] = [];
  let p = 44;
  for (let i = 0; i < numTables; i++) {
    const tag = woff.readUInt32BE(p);
    const offset = woff.readUInt32BE(p + 4);
    const compLength = woff.readUInt32BE(p + 8);
    const origLength = woff.readUInt32BE(p + 12);
    const origChecksum = woff.readUInt32BE(p + 16);
    let data = woff.subarray(offset, offset + compLength);
    if (compLength !== origLength) data = zlib.inflateSync(data);
    if (data.length !== origLength) throw new Error(`table length mismatch tag=${tag.toString(16)}`);
    tables.push({ tag, data, checksum: origChecksum });
    p += 20;
  }
  tables.sort((a, b) => a.tag - b.tag);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const rangeShift = numTables * 16 - searchRange;
  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const tableOffsets: number[] = [];
  for (const t of tables) {
    tableOffsets.push(offset);
    offset += Math.ceil(t.data.length / 4) * 4;
  }
  const out = Buffer.alloc(offset);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);
  let dirP = 12;
  tables.forEach((t, i) => {
    out.writeUInt32BE(t.tag, dirP);
    out.writeUInt32BE(t.checksum, dirP + 4);
    out.writeUInt32BE(tableOffsets[i]!, dirP + 8);
    out.writeUInt32BE(t.data.length, dirP + 12);
    dirP += 16;
    t.data.copy(out, tableOffsets[i]!);
  });
  return out;
}

function loadFontFiles(): string[] {
  const workDir = mkdtempSync(join(tmpdir(), 'portfolio-arch-fonts-'));
  const weights = ['400', '700', '900'];
  return weights.map((w) => {
    const woffPath = require.resolve(`@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-${w}-normal.woff`);
    const ttf = woffToSfnt(readFileSync(woffPath));
    const out = join(workDir, `NotoSansSC-${w}.ttf`);
    writeFileSync(out, ttf);
    return out;
  });
}

// ── 视觉规范(克制 · 专业 · 沉稳)──────────────────────────────────────────
const W = 1920;
const H = 1080;
const BG = '#0a0e18';
const BG2 = '#0d1220'; // 极细的次级底色(用于面板)
const NODE_FILL = '#141a2c';
const NODE_STROKE = '#333a56';
const HUB_STROKE = '#c9a961';
const TEXT = '#f2ead9'; // 米白
const MUTED = '#9aa1bd'; // 次级说明文字(冷灰)
const GOLD = '#d9b56a'; // 金色强调
const GOLD_SOFT = 'rgba(217,181,106,0.55)';
const LINE = 'rgba(154,161,189,0.55)';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 圆角矩形节点(标题居中 + 可选副标题居中,自动纵向排布)。 */
function box(opts: {
  x: number; y: number; w: number; h: number;
  title: string; titleSize?: number; titleColor?: string; titleWeight?: number;
  caption?: string; captionSize?: number; captionColor?: string;
  fill?: string; stroke?: string; strokeWidth?: number; rx?: number;
  accentBar?: boolean; // 左侧金色竖条(标记「事实门」类关卡节点)
}): string {
  const {
    x, y, w, h, title, titleSize = 30, titleColor = TEXT, titleWeight = 700,
    caption, captionSize = 19, captionColor = MUTED,
    fill = NODE_FILL, stroke = NODE_STROKE, strokeWidth = 1.6, rx = 20, accentBar = false,
  } = opts;
  const cx = x + w / 2;
  const titleY = caption ? y + h / 2 - 8 : y + h / 2 + titleSize * 0.32;
  const capY = y + h / 2 + captionSize + 14;
  const parts: string[] = [];
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
  if (accentBar) {
    parts.push(`<rect x="${x}" y="${y + 10}" width="5" height="${h - 20}" rx="2.5" fill="${GOLD}"/>`);
  }
  parts.push(`<text x="${cx}" y="${titleY}" text-anchor="middle" font-family="NotoSansSC" font-weight="${titleWeight}" font-size="${titleSize}" fill="${titleColor}">${esc(title)}</text>`);
  if (caption) {
    parts.push(`<text x="${cx}" y="${capY}" text-anchor="middle" font-family="NotoSansSC" font-weight="400" font-size="${captionSize}" fill="${captionColor}">${esc(caption)}</text>`);
  }
  return parts.join('\n');
}

/** 圆角矩形节点,标题+副标题左对齐(用于圆形/宽节点场景可切换,当前留作扩展)。 */

function arrowRight(tipX: number, tipY: number, size = 9): string {
  const p = `${tipX - size},${tipY - size} ${tipX},${tipY} ${tipX - size},${tipY + size}`;
  return `<polygon points="${p}" fill="${GOLD}" opacity="0.85"/>`;
}
function arrowDown(tipX: number, tipY: number, size = 9): string {
  const p = `${tipX - size},${tipY - size} ${tipX},${tipY} ${tipX + size},${tipY - size}`;
  return `<polygon points="${p}" fill="${GOLD}" opacity="0.85"/>`;
}

/** 水平连线(同一行内 box→box),终点画右箭头。 */
function hLine(x1: number, y: number, x2: number): string {
  return [
    `<path d="M ${x1} ${y} L ${x2 - 10} ${y}" stroke="${LINE}" stroke-width="2" fill="none"/>`,
    arrowRight(x2, y),
  ].join('\n');
}

/** 直角肘形连线:从 (x1,y1) 竖直到 midY,再横移到 x2,再竖直到 y2(终点画下箭头)。 */
function elbowDown(x1: number, y1: number, x2: number, y2: number, midY: number): string {
  const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2 - 10}`;
  return [
    `<path d="${d}" stroke="${LINE}" stroke-width="2" fill="none"/>`,
    arrowDown(x2, y2),
  ].join('\n');
}

function footer(): string {
  return `<text x="${W - 60}" y="${H - 36}" text-anchor="end" font-family="NotoSansSC" font-weight="400" font-size="20" fill="${MUTED}">截至 2026-07-10 · 终值 7/20 复核</text>`;
}

function bgRect(): string {
  return `<defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG2}"/>
      <stop offset="100%" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgGrad)"/>`;
}

// ══════════════════════════════════════════════════════════════════════
// 图 1:内容工厂管线图
// ══════════════════════════════════════════════════════════════════════
function buildPipelineSvg(): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(bgRect());

  // 标题
  parts.push(`<text x="80" y="96" font-family="NotoSansSC" font-weight="900" font-size="46" fill="${TEXT}">内容工厂 · 5 条线无人值守</text>`);
  parts.push(`<text x="80" y="132" font-family="NotoSansSC" font-weight="400" font-size="21" fill="${MUTED}">赛后自动化内容管线 · 定时唤醒调度中枢</text>`);

  // Row A:数据 → 确认 → 生成 → 调度中枢
  const rowAY = 190, rowAH = 108;
  const aW = 410, aGap = 40;
  const aX = [80, 80 + aW + aGap, 80 + 2 * (aW + aGap), 80 + 3 * (aW + aGap)];
  parts.push(box({ x: aX[0]!, y: rowAY, w: aW, h: rowAH, title: '第三方赛事数据源', titleSize: 27, caption: '比分 · 赛程 · 统计', captionSize: 17 }));
  parts.push(box({ x: aX[1]!, y: rowAY, w: aW, h: rowAH, title: '完赛确认', titleSize: 27, caption: '终场结果核验', captionSize: 17 }));
  parts.push(box({ x: aX[2]!, y: rowAY, w: aW, h: rowAH, title: '战报 / 评分 / 榜单生成', titleSize: 25, caption: 'LLM 战报 · 球员评分 · 排行榜', captionSize: 16 }));
  parts.push(box({ x: aX[3]!, y: rowAY, w: aW, h: rowAH, title: '调度中枢', titleSize: 27, caption: '每 30 分钟唤醒 · 无人值守', captionSize: 17, stroke: HUB_STROKE, strokeWidth: 2 }));

  for (let i = 0; i < 3; i++) {
    const x1 = aX[i]! + aW;
    const x2 = aX[i + 1]!;
    parts.push(hLine(x1 + 6, rowAY + rowAH / 2, x2 - 6));
  }

  // 调度中枢 → 5 条内容线(汇流母线样式:先竖直,再一条横向母线,再各自竖直分支)
  const hubCx = aX[3]! + aW / 2;
  const hubBottomY = rowAY + rowAH;
  const busY = hubBottomY + 55; // 母线 y

  const rowBY = 425, rowBH = 150;
  const bW = 328, bGap = 30;
  const bX = [80, 80 + bW + bGap, 80 + 2 * (bW + bGap), 80 + 3 * (bW + bGap), 80 + 4 * (bW + bGap)];
  const bCx = bX.map((x) => x + bW / 2);

  // 调度中枢竖直落到母线
  parts.push(`<path d="M ${hubCx} ${hubBottomY} L ${hubCx} ${busY}" stroke="${LINE}" stroke-width="2" fill="none"/>`);
  // 母线(横跨 5 条线的中心跨度)
  parts.push(`<path d="M ${bCx[0]} ${busY} L ${bCx[4]} ${busY}" stroke="${LINE}" stroke-width="2" fill="none"/>`);
  // 母线 → 各分支
  for (const cx of bCx) {
    parts.push(`<path d="M ${cx} ${busY} L ${cx} ${rowBY - 10}" stroke="${LINE}" stroke-width="2" fill="none"/>`);
    parts.push(arrowDown(cx, rowBY));
  }

  const lines = [
    { title: '一 · 单场战报 + AI 成片', caption: '事件驱动 · 完赛后' },
    { title: '二 · 赛果预测连载 · 图文', caption: '每期 · 小红书' },
    { title: '三 · 赛果预测连载 · 视频', caption: '每期 · 抖音' },
    { title: '四 · 评分规则片 + 笔记', caption: '每日锚定 · 抖音 + 小红书' },
    { title: '五 · 金靴赛道追踪', caption: '事件驱动 · 榜单变动' },
  ];
  lines.forEach((l, i) => {
    parts.push(box({ x: bX[i]!, y: rowBY, w: bW, h: rowBH, title: l.title, titleSize: 21, caption: l.caption, captionSize: 16.5, titleColor: TEXT }));
  });

  // 5 条线 → 产物(与上方分流对称的汇流母线样式,避免多线交叉显乱)
  const rowCY = 665, rowCH = 100;
  const cW = 620;
  const cX = 960 - cW / 2;
  const productCx = 960;
  const productTopY = rowCY;
  const busY2 = rowBY + rowBH + 48;
  for (const cx of bCx) {
    parts.push(`<path d="M ${cx} ${rowBY + rowBH} L ${cx} ${busY2}" stroke="${LINE}" stroke-width="2" fill="none" opacity="0.75"/>`);
  }
  parts.push(`<path d="M ${bCx[0]} ${busY2} L ${bCx[4]} ${busY2}" stroke="${LINE}" stroke-width="2" fill="none" opacity="0.75"/>`);
  parts.push(`<path d="M ${productCx} ${busY2} L ${productCx} ${productTopY - 10}" stroke="${LINE}" stroke-width="2" fill="none"/>`);
  parts.push(arrowDown(productCx, productTopY));
  parts.push(box({ x: cX, y: rowCY, w: cW, h: rowCH, title: '产物：小红书图文 · 抖音视频', titleSize: 24, caption: '按线适配形态,两端并行产出', captionSize: 16.5 }));

  // 产物 → 事实门 → 企微推送 → 人工审核 + 发布
  const rowDY = 810, rowDH = 110;
  const dW = 546, dGap = 60;
  const dX = [80, 80 + dW + dGap, 80 + 2 * (dW + dGap)];
  const dCx = dX.map((x) => x + dW / 2);

  parts.push(elbowDown(productCx, rowCY + rowCH, dCx[0]!, rowDY, rowCY + rowCH + 45));

  parts.push(box({ x: dX[0]!, y: rowDY, w: dW, h: rowDH, title: '事实门', titleSize: 27, caption: '数据缺 · 译名未命中,不出片', captionSize: 17, accentBar: true }));
  parts.push(box({ x: dX[1]!, y: rowDY, w: dW, h: rowDH, title: '企微推送', titleSize: 27, caption: '摘要 + 图片自动送达', captionSize: 17 }));
  parts.push(box({ x: dX[2]!, y: rowDY, w: dW, h: rowDH, title: '人工审核 + 发布', titleSize: 27, caption: '确认后手动分发', captionSize: 17 }));

  for (let i = 0; i < 2; i++) {
    const x1 = dX[i]! + dW;
    const x2 = dX[i + 1]!;
    parts.push(hLine(x1 + 6, rowDY + rowDH / 2, x2 - 6));
  }

  // 触发范式小标注(置于 Row B 与 Row C 之间左侧留白)
  parts.push(`<text x="80" y="${rowCY - 26}" font-family="NotoSansSC" font-weight="700" font-size="18" fill="${GOLD}">三种触发范式</text>`);
  parts.push(`<text x="80" y="${rowCY - 4}" font-family="NotoSansSC" font-weight="400" font-size="17" fill="${MUTED}">事件驱动(完赛 / 榜单变动) · 每期锚定 · 每日锚定</text>`);

  parts.push(footer());
  parts.push('</svg>');
  return parts.join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// 图 2:6 端跨端图(放射状)
// ══════════════════════════════════════════════════════════════════════
function pointOnRectBoundary(cx: number, cy: number, w: number, h: number, dx: number, dy: number): [number, number] {
  const hw = w / 2, hh = h / 2;
  if (dx === 0) return [cx, cy + Math.sign(dy) * hh];
  if (dy === 0) return [cx + Math.sign(dx) * hw, cy];
  const t = Math.min(Math.abs(hw / dx), Math.abs(hh / dy));
  return [cx + dx * t, cy + dy * t];
}

function buildCrossPlatformSvg(): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(bgRect());

  parts.push(`<text x="80" y="96" font-family="NotoSansSC" font-weight="900" font-size="46" fill="${TEXT}">一套内容脊 · 覆盖 6 端</text>`);
  parts.push(`<text x="80" y="132" font-family="NotoSansSC" font-weight="400" font-size="21" fill="${MUTED}">单场比赛的生成结果,按端适配形态分发</text>`);

  const centerX = 960, centerY = 610;
  const centerW = 460, centerH = 176;

  const rx = 620, ry = 335;
  const platforms = [
    { title: '小程序', caption: '产品体验:战报 · 数据卡 · 留存功能', angleDeg: -90 },
    { title: '服务号 H5', caption: '图文战报 · 搜一搜承接', angleDeg: -30 },
    { title: '视频号', caption: '短视频分发(同源二次分发)', angleDeg: 30 },
    { title: 'web', caption: '内容渲染 + API 服务', angleDeg: 90 },
    { title: '小红书', caption: '图文笔记 + 动效视频', angleDeg: 150 },
    { title: '抖音', caption: '口播成片:战报 · 评分 · 金靴 · 预测', angleDeg: 210 },
  ];

  const nodeW = 400, nodeH = 148;
  const spokeCenters = platforms.map((p) => {
    const rad = (p.angleDeg * Math.PI) / 180;
    return { x: centerX + rx * Math.cos(rad), y: centerY + ry * Math.sin(rad) };
  });

  // 连线(先画,压在节点下方):从中心节点边界 到 各端节点边界
  spokeCenters.forEach(({ x, y }) => {
    const dx = x - centerX, dy = y - centerY;
    const [sx, sy] = pointOnRectBoundary(centerX, centerY, centerW, centerH, dx, dy);
    const [ex, ey] = pointOnRectBoundary(x, y, nodeW, nodeH, -dx, -dy);
    // 终点稍微回缩一点给箭头留空间
    const len = Math.hypot(ex - sx, ey - sy);
    const ux = (ex - sx) / len, uy = (ey - sy) / len;
    const tipX = ex - ux * 12, tipY = ey - uy * 12;
    parts.push(`<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${tipX.toFixed(1)} ${tipY.toFixed(1)}" stroke="${LINE}" stroke-width="2" fill="none"/>`);
    // 箭头(通用旋转箭头,而非固定方向 polygon)
    const angle = Math.atan2(uy, ux);
    const size = 9;
    const leftA = angle + Math.PI * 0.82;
    const rightA = angle - Math.PI * 0.82;
    const p1 = [ex, ey];
    const p2 = [ex + size * Math.cos(leftA), ey + size * Math.sin(leftA)];
    const p3 = [ex + size * Math.cos(rightA), ey + size * Math.sin(rightA)];
    parts.push(`<polygon points="${p1.join(',')} ${p2.map((v) => v.toFixed(1)).join(',')} ${p3.map((v) => v.toFixed(1)).join(',')}" fill="${GOLD}" opacity="0.85"/>`);
  });

  // 中心节点
  parts.push(box({
    x: centerX - centerW / 2, y: centerY - centerH / 2, w: centerW, h: centerH,
    title: '单场比赛 · 一次生成', titleSize: 30, caption: '一次内容生产,六端分发形态各异', captionSize: 17,
    stroke: HUB_STROKE, strokeWidth: 2.2,
  }));

  // 6 个端节点
  platforms.forEach((p, i) => {
    const { x, y } = spokeCenters[i]!;
    parts.push(box({
      x: x - nodeW / 2, y: y - nodeH / 2, w: nodeW, h: nodeH,
      title: p.title, titleSize: 26, caption: p.caption, captionSize: 16.5,
    }));
  });

  parts.push(footer());
  parts.push('</svg>');
  return parts.join('\n');
}

// ── 红线自查(渲染前对 SVG 源码做一次硬拦截)──────────────────────────────
function assertClean(svg: string, label: string): void {
  const banned: [RegExp, string][] = [
    [/\/Users\/kang/, '本地路径'],
    [/\bpush\b/i, '疑似 IP/网络字样(误报请人工复核)'],
  ];
  const hardBanned = [/押/, /webhook/i, /腾讯云/, /COS/i, /134\.175\.195\.104/];
  for (const re of hardBanned) {
    if (re.test(svg)) throw new Error(`[${label}] 红线自查命中: ${re}`);
  }
  if (/\/Users\/kang/.test(svg)) throw new Error(`[${label}] 红线自查命中本地路径`);
}

async function main() {
  const fontFiles = loadFontFiles();
  const scriptDir = new URL('.', import.meta.url).pathname; // web/scripts/portfolio/
  const outDir = join(scriptDir, '../../../tasks/assets');

  const jobs: [string, string][] = [
    [buildPipelineSvg(), 'portfolio-arch-pipeline-20260710.png'],
    [buildCrossPlatformSvg(), 'portfolio-arch-crossplatform-20260710.png'],
  ];

  for (const [svg, filename] of jobs) {
    assertClean(svg, filename);
    const resvg = new Resvg(svg, {
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'NotoSansSC' },
      background: BG,
    });
    const png = resvg.render().asPng();
    const outPath = join(outDir, filename);
    writeFileSync(outPath, png);
    console.log('WROTE', outPath, png.length, 'bytes');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
