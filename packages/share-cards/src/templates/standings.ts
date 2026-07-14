import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { splitTextLines } from '../text-fit.js';

// 小组积分榜卡(小红书 3:4):单组 4 队完整积分表 + 出线区配色。赛事级、随赛程每日刷新。
// 仅展示客观积分位次(场次/胜平负/净胜/积分);出线区高亮为积分榜通用惯例,不含预测。
const t = {
  bg: 'linear-gradient(155deg, #0E1622 0%, #0A0E14 46%, #090C12 100%)',
  panel2: '#0F161F',
  panel3: '#10202A',
  green: '#00D982',
  gold: '#FFC857',
  text: '#F5F8FC',
  muted: '#9DAAB9',
  faint: '#5E6C7C',
  line: 'rgba(255,255,255,0.08)',
};

const W = 1080;
const M = 48;
const CW = W - M * 2; // 984

function clampLine(value: string, n: number): string {
  return splitTextLines(value, n, 1)[0] || '';
}
function text(left: number, top: number, width: number, height: number, value: string, style: Record<string, unknown> = {}) {
  return el('div', { style: { display: 'flex', position: 'absolute', left, top, width, height, overflow: 'hidden', ...style } }, value);
}

interface SRow { rank: number; team: string; played: number; win: number; draw: number; lose: number; goalsDiff: number; points: number; qualified: boolean; flag?: string }

/** 出线区配色:rank1-2 绿(出线区)/ rank3 金(待定)/ rank4+ 暗。 */
function zoneColor(rank: number): string {
  if (rank <= 2) return t.green;
  if (rank === 3) return t.gold;
  return t.faint;
}

function standingRow(top: number, rank: number, r: SRow) {
  const accent = zoneColor(rank);
  const gd = r.goalsDiff > 0 ? `+${r.goalsDiff}` : String(r.goalsDiff);
  const sub = `${r.played} 场 · ${r.win}胜${r.draw}平${r.lose}负 · 净胜 ${gd}`;
  return el('div', {
    style: { display: 'flex', position: 'absolute', left: M, top, width: CW, height: 184, background: rank <= 2 ? t.panel3 : t.panel2, border: `1px solid ${rank <= 2 ? 'rgba(0,217,130,0.28)' : t.line}`, borderRadius: 18 },
  },
    // 左侧出线区色条
    el('div', { style: { display: 'flex', position: 'absolute', left: 0, top: 28, width: 6, height: 128, borderRadius: 3, background: accent } }),
    // 排名
    el('div', { style: { display: 'flex', position: 'absolute', left: 28, top: 62, width: 56, height: 56, borderRadius: 28, background: t.panel2, border: `2px solid ${accent}`, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: accent, fontSize: 28, fontWeight: 900 } }, String(rank))),
    // 队旗 + 队名 + 副行
    r.flag ? el('img', { src: r.flag, width: 42, height: 30, style: { position: 'absolute', left: 108, top: 53, width: 42, height: 30, borderRadius: 4, objectFit: 'cover' } }) : el('div', {}),
    text(r.flag ? 162 : 108, 46, r.flag ? 466 : 520, 44, clampLine(r.team, 14), { color: t.text, fontSize: 38, fontWeight: 800, alignItems: 'center', height: 44 }),
    text(108, 104, 560, 32, clampLine(sub, 30), { color: t.muted, fontSize: 22, alignItems: 'center', height: 32 }),
    // 积分(大)
    text(CW - 184, 46, 130, 68, String(r.points), { color: rank <= 2 ? t.green : t.text, fontSize: 60, fontWeight: 900, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center', height: 68 }),
    text(CW - 48, 72, 42, 30, '分', { color: t.muted, fontSize: 20, alignItems: 'center', height: 30 }),
    // 已出线 chip(仅数据源官方确认时)
    r.qualified
      ? el('div', { style: { display: 'flex', position: 'absolute', left: CW - 188, top: 122, width: 134, height: 32, background: 'rgba(0,217,130,0.16)', border: `1px solid ${t.green}`, borderRadius: 8, alignItems: 'center', justifyContent: 'center' } },
          el('div', { style: { display: 'flex', color: t.green, fontSize: 18, fontWeight: 700 } }, '已出线'))
      : el('div', {}),
  );
}

export function standingsTemplate(d: CardPayload) {
  const sc = d.standingsCard;
  const rows = (sc?.rows ?? []).slice(0, 4);
  return el('div', {
    style: { width: '100%', height: '100%', display: 'flex', position: 'relative', background: t.bg, color: t.text, fontFamily: 'NotoSansSC' },
  },
    // 顶栏:品牌徽标 + 日期
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 48, width: 168, height: 54, background: 'linear-gradient(120deg, #00D982 0%, #00B8C4 100%)', borderRadius: 14, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: '#04110A', fontSize: 26, fontWeight: 900, letterSpacing: 1 } }, '积分榜')),
    text(W - M - 280, 56, 280, 36, sc?.asof || d.date || '', { color: t.faint, fontSize: 20, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
    // 赛事 + 小组行
    text(M, 122, CW, 40, clampLine(sc?.title_line || '国际大赛 · 积分榜', 26), { color: t.text, fontSize: 34, fontWeight: 900, alignItems: 'center', height: 40 }),
    // 图例
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 178, width: CW, height: 28, alignItems: 'center' } },
      el('div', { style: { display: 'flex', width: 14, height: 14, borderRadius: 4, background: t.green, marginRight: 8 } }),
      el('div', { style: { display: 'flex', color: t.muted, fontSize: 19, marginRight: 24 } }, '前二出线区'),
      el('div', { style: { display: 'flex', width: 14, height: 14, borderRadius: 4, background: t.gold, marginRight: 8 } }),
      el('div', { style: { display: 'flex', color: t.muted, fontSize: 19 } }, '第三名待定')),
    // 4 队积分行(行高 184 + 间距 32 → 纵向铺满,4 队组不空)
    ...rows.map((r, i) => standingRow(280 + i * 216, r.rank || i + 1, r)),
    // 底栏:数据来源 + 品牌
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 1340, width: CW, height: 1, background: t.line } }),
    text(M, 1366, 700, 22, sc?.note || '积分/排名来自第三方足球数据源 · AI 生成内容整理', { color: t.faint, fontSize: 15, alignItems: 'center' }),
    text(W - M - 280, 1366, 280, 22, d.brand || '超帧球后说 · 积分榜 · AI 生成', { color: t.muted, fontSize: 15, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
  );
}
