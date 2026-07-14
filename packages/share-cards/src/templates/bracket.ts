import type { BracketMatch, CardPayload } from '../types.js';
import { el } from '../el.js';

/**
 * 淘汰赛对阵图(新华社双向树):绝对定位 + bracket 桥接线 + 中央大力神杯。
 * 连线先画(在卡之下),卡覆盖其上 → 列内竖向汇聚线被卡遮、只在缝隙露出;横向两两汇聚用 ┐└ 阶梯线。
 * 上半区(32强8场→16强4→8强2→半决赛1)向下收拢 → 中央决赛(金·奖杯)+季军赛 → 下半区镜像。
 * 纯文字+国旗(已 base64),不带赛事官方 LOGO/队徽;已完赛显比分(点球内联),晋级方标绿,未打显 VS,后续轮次「待定」。
 */

/** 大力神杯(金色矢量·风格化);内联 SVG,resvg 渲染清晰、可缩放。 */
const TROPHY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0B0"/><stop offset="0.45" stop-color="#FFD24A"/><stop offset="1" stop-color="#D99A22"/></linearGradient></defs><ellipse cx="60" cy="34" rx="25" ry="27" fill="url(#g)" stroke="#A9781A" stroke-width="2"/><path d="M35 34 H85 M60 7 V61 M40 17 Q60 29 80 17 M40 51 Q60 39 80 51" stroke="#A9781A" stroke-width="1.3" fill="none" opacity="0.55"/><path d="M43 57 C 27 92, 42 122, 60 134 C 78 122, 93 92, 77 57 C 71 73, 49 73, 43 57 Z" fill="url(#g)" stroke="#A9781A" stroke-width="2"/><path d="M52 70 C 48 95, 54 118, 60 130 C 66 118, 72 95, 68 70" stroke="#A9781A" stroke-width="1.3" fill="none" opacity="0.5"/><rect x="47" y="131" width="26" height="14" rx="3" fill="url(#g)" stroke="#A9781A" stroke-width="1.5"/><rect x="39" y="144" width="42" height="13" rx="4" fill="#E7AE2E" stroke="#A9781A" stroke-width="1.5"/><rect x="34" y="156" width="52" height="14" rx="5" fill="#CE9420" stroke="#A9781A" stroke-width="1.5"/></svg>`;
const TROPHY = `data:image/svg+xml;base64,${Buffer.from(TROPHY_SVG).toString('base64')}`;

const W = 1080;
const BH = 2560; // 卡片固定高度(结构固定 → 高度固定;render 用 BRACKET_SIZE 同值)
const GOLD = '#FFD24A', LINE = 'rgba(255,210,74,0.7)', CARD = '#F4F7FB', INK = '#0C1A33', MUT = '#6B7A90', WIN = '#1FA463';
const CW = 236, CH = 92;
const CX = [156, 411, 666, 921];
const QX = [283, 794];
const MIDX = 540;

const abs = (x: number, y: number, w: number, h: number, style: Record<string, unknown>, ...kids: unknown[]) =>
  el('div', { style: { position: 'absolute', left: x, top: y, width: w, height: h, ...style } }, ...kids);
const vLine = (x: number, y0: number, y1: number) => abs(x - 1.5, Math.min(y0, y1), 3, Math.abs(y1 - y0), { backgroundColor: LINE });
const hLine = (x0: number, x1: number, y: number) => abs(Math.min(x0, x1), y - 1.5, Math.abs(x1 - x0), 3, { backgroundColor: LINE });

function won(m: BracketMatch, side: 'h' | 'a'): boolean {
  if (m.status !== 'finished') return false;
  const hs = m.penHome ?? m.homeScore ?? 0;
  const as = m.penAway ?? m.awayScore ?? 0;
  return side === 'h' ? hs > as : as > hs;
}
function nameRow(name: string | undefined, fl: string | undefined, m: BracketMatch, side: 'h' | 'a', fs: number) {
  const w = won(m, side);
  return el('div', { style: { alignItems: 'center', height: fs + 11 } },
    el('div', { style: { width: 30, height: 20, borderRadius: 3, overflow: 'hidden', backgroundColor: '#E3E8EF', marginRight: 8 } },
      fl ? el('img', { src: fl, width: 30, height: 20, style: { width: 30, height: 20, objectFit: 'cover' } }) : false),
    el('div', { style: { color: w ? WIN : INK, fontSize: fs, fontWeight: w ? 900 : 700 } }, name || '待定'));
}
function scoreCell(text: string, w: boolean, fs: number) {
  return el('div', { style: { height: fs + 11, alignItems: 'center', justifyContent: 'flex-end' } },
    el('div', { style: { color: w ? WIN : INK, fontSize: fs + 1, fontWeight: 900 } }, text));
}
function cardNode(m: BracketMatch, w: number, fs: number, gold: boolean) {
  const finished = m.status === 'finished';
  const hsc = m.homeScore != null ? `${m.homeScore}${m.penHome != null ? ` (${m.penHome})` : ''}` : '';
  const asc = m.awayScore != null ? `${m.awayScore}${m.penAway != null ? ` (${m.penAway})` : ''}` : '';
  const left = el('div', { style: { flexDirection: 'column', flexGrow: 1 } }, nameRow(m.homeName, m.homeFlag, m, 'h', fs), nameRow(m.awayName, m.awayFlag, m, 'a', fs));
  const right = finished
    ? el('div', { style: { flexDirection: 'column', marginLeft: 8 } }, scoreCell(hsc, won(m, 'h'), fs), scoreCell(asc, won(m, 'a'), fs))
    : el('div', { style: { marginLeft: 8, width: 44, height: 2 * (fs + 11), alignItems: 'center', justifyContent: 'center' } },
        el('div', { style: { color: '#7E8AA0', fontSize: fs + 5, fontWeight: 900, letterSpacing: 1 } }, 'VS'));
  return el('div', { style: { width: w, height: '100%', flexDirection: 'column', backgroundColor: CARD, borderRadius: 11, padding: '8px 13px', border: gold ? `3px solid ${GOLD}` : '1px solid rgba(0,0,0,0.06)', justifyContent: 'center' } },
    el('div', { style: { justifyContent: 'space-between', marginBottom: 2 } },
      el('div', { style: { color: MUT, fontSize: 16, fontWeight: 700 } }, m.date),
      el('div', { style: { color: '#9AA7B8', fontSize: 15, fontWeight: 700 } }, m.tag || '')),
    el('div', { style: { alignItems: 'center' } }, left, right));
}
const card = (cx: number, y: number, m: BracketMatch, w = CW, fs = 21, gold = false) => abs(cx - w / 2, y, w, gold ? 104 : CH, {}, cardNode(m, w, fs, gold));
const label = (y: number, big: string, sub: string) => abs(0, y, W, 70, { flexDirection: 'column', alignItems: 'center' },
  el('div', { style: { color: GOLD, fontSize: 44, fontWeight: 900, letterSpacing: 3 } }, big),
  el('div', { style: { color: '#A9C0E8', fontSize: 20, fontWeight: 700 } }, sub));

const empty: BracketMatch = { date: '待定', status: 'tbd' };
const at = (arr: BracketMatch[] | undefined, i: number): BracketMatch => (arr && arr[i]) || empty;

export function bracketTemplate(d: CardPayload): unknown {
  const b = d.bracketCard;
  const title = b?.title || '淘汰赛对阵图';
  const subtitle = b?.subtitle || '（北京时间）';
  const note = b?.note || '数据随赛程自动更新 · AI 整理';
  const topR32 = b?.topR32 || [], top16 = b?.top16 || [], top8 = b?.top8 || [];
  const botR32 = b?.botR32 || [], bot16 = b?.bot16 || [], bot8 = b?.bot8 || [];

  const lines: unknown[] = []; const labels: unknown[] = []; const cards: unknown[] = [];
  const LB = 74, yTitle = 36;
  // 上半区
  const r1y = 250, yL32 = r1y - LB, r2y = r1y + CH + 16;
  const r16y = r2y + CH + 100, yL16 = r16y - LB;
  const q8y = r16y + CH + 100, yL8 = q8y - LB;
  const sfy = q8y + CH + 100, yLsf = sfy - LB;
  const yLf = sfy + CH + 60, trophyY = yLf + 48, finalY = trophyY + 196;
  CX.forEach((cx) => lines.push(vLine(cx, r1y + CH, r16y)));
  ([[0, 1, QX[0]], [2, 3, QX[1]]] as [number, number, number][]).forEach(([a, c, qx]) => {
    const rail = r16y + CH + 26; lines.push(vLine(CX[a], r16y + CH, rail), vLine(CX[c], r16y + CH, rail), hLine(CX[a], CX[c], rail), vLine(qx, rail, q8y));
  });
  { const rail = q8y + CH + 26; lines.push(vLine(QX[0], q8y + CH, rail), vLine(QX[1], q8y + CH, rail), hLine(QX[0], QX[1], rail), vLine(MIDX, rail, sfy)); }
  lines.push(vLine(MIDX, sfy + CH, trophyY));
  labels.push(label(yL32, '32强', '1/16 决赛'), label(yL16, '16强', '1/8 决赛'), label(yL8, '8强', '1/4 决赛'), label(yLsf, '半决赛', 'Semi-finals'), label(yLf, '决赛', 'FINAL'));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r1y, at(topR32, i)));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r2y, at(topR32, i + 4)));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r16y, at(top16, i)));
  for (let i = 0; i < 2; i++) cards.push(card(QX[i], q8y, at(top8, i), 248, 23));
  cards.push(card(MIDX, sfy, at(b?.topSF, 0), 268, 24));
  cards.push(abs(MIDX - 66, trophyY, 132, 196, { alignItems: 'center' }, el('img', { src: TROPHY, width: 132, height: 196, style: { width: 132, height: 196 } })));
  cards.push(card(MIDX, finalY, at(b?.final, 0), 520, 30, true));
  const thirdY = finalY + 104 + 36;
  lines.push(vLine(MIDX, finalY + 104, thirdY + 36)); // 决赛 → 季军赛(中轴连线,标签覆于其上)
  labels.push(abs(0, thirdY - 4, W, 36, { justifyContent: 'center' }, el('div', { style: { color: '#A9C0E8', fontSize: 22, fontWeight: 700 } }, '季军赛 · 3rd Place')));
  cards.push(card(MIDX, thirdY + 36, at(b?.third, 0), 460, 24));
  // 下半区
  const sfby = thirdY + 126 + 96, yLsfb = sfby - LB;
  const q8by = sfby + CH + 100, yL8b = q8by - LB;
  const r16by = q8by + CH + 100, yL16b = r16by - LB;
  const r1by = r16by + CH + 100, yL32b = r1by - LB, r2by = r1by + CH + 16;
  lines.push(vLine(MIDX, thirdY + 36 + 90, sfby));
  { const rail = sfby + CH + 26; lines.push(vLine(MIDX, sfby + CH, rail), hLine(QX[0], QX[1], rail), vLine(QX[0], rail, q8by), vLine(QX[1], rail, q8by)); }
  ([[0, 1, QX[0]], [2, 3, QX[1]]] as [number, number, number][]).forEach(([a, c, qx]) => {
    const rail = q8by + CH + 26; lines.push(vLine(qx, q8by + CH, rail), hLine(CX[a], CX[c], rail), vLine(CX[a], rail, r16by), vLine(CX[c], rail, r16by));
  });
  CX.forEach((cx) => lines.push(vLine(cx, r16by + CH, r1by)));
  labels.push(label(yLsfb, '半决赛', 'Semi-finals'), label(yL8b, '8强', '1/4 决赛'), label(yL16b, '16强', '1/8 决赛'), label(yL32b, '32强', '1/16 决赛'));
  cards.push(card(MIDX, sfby, at(b?.botSF, 0), 268, 24));
  for (let i = 0; i < 2; i++) cards.push(card(QX[i], q8by, at(bot8, i), 248, 23));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r16by, at(bot16, i)));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r1by, at(botR32, i)));
  for (let i = 0; i < 4; i++) cards.push(card(CX[i], r2by, at(botR32, i + 4)));

  return el('div', { style: { position: 'relative', width: W, height: BH, backgroundImage: 'linear-gradient(180deg, #0B3A82 0%, #0A2E66 50%, #07224D 100%)', fontFamily: 'NotoSansSC' } },
    abs(0, yTitle, W, 110, { flexDirection: 'column', alignItems: 'center' },
      el('div', { style: { color: '#FFFFFF', fontSize: 60, fontWeight: 900, letterSpacing: 2 } }, title),
      el('div', { style: { color: GOLD, fontSize: 26, fontWeight: 700, marginTop: 4 } }, subtitle)),
    ...lines, ...labels, ...cards,
    abs(0, r2by + CH + 28, W, 30, { justifyContent: 'center' }, el('div', { style: { color: '#7E93B5', fontSize: 20, fontWeight: 400 } }, `${note} · ${d.brand || '超帧球后说'}`)));
}
