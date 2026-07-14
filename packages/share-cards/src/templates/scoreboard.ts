import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { splitTextLines } from '../text-fit.js';

// 射手榜/助攻榜卡(小红书 3:4):顶部金靴领跑横幅 + 主客两列(射手榜金 / 助攻榜青)各 Top8。
// 赛事级榜单,数据随赛程推进每日刷新(key 带日期戳)。配色与一图看懂/球员评分同系。
const t = {
  bg: 'linear-gradient(155deg, #0E1622 0%, #0A0E14 46%, #090C12 100%)',
  panel: '#141C26',
  panel2: '#0F161F',
  gold: '#FFC857',
  cyan: '#5CC8FF',
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

interface LRow { name: string; team: string; count: number; apps: number; flag?: string }

/** 单个榜行:左 排名+姓名+队旗+队·场次,右 大计数 + 单位(球/助)。 */
function leaderRow(left: number, top: number, width: number, rank: number, r: LRow, accent: string, unit: string) {
  const sub = [r.team, r.apps > 0 ? `${r.apps} 场` : ''].filter(Boolean).join(' · ');
  const subLeft = r.flag ? 94 : 60; // 有旗时副行文字右移让位
  return el('div', {
    style: { display: 'flex', position: 'absolute', left, top, width, height: 104, background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 14 },
  },
    el('div', { style: { display: 'flex', position: 'absolute', left: 14, top: 35, width: 34, height: 34, borderRadius: 17, background: t.panel, border: `1px solid ${t.line}`, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: accent, fontSize: 18, fontWeight: 900 } }, String(rank))),
    text(60, 18, width - 158, 32, clampLine(r.name, 14), { color: t.text, fontSize: 27, fontWeight: 800, alignItems: 'center', height: 32 }),
    r.flag ? el('img', { src: r.flag, width: 26, height: 18, style: { position: 'absolute', left: 60, top: 60, width: 26, height: 18, borderRadius: 3, objectFit: 'cover' } }) : el('div', {}),
    text(subLeft, 56, width - 98 - subLeft, 26, clampLine(sub, 18), { color: t.muted, fontSize: 18, alignItems: 'center', height: 26 }),
    text(width - 98, 22, 60, 52, String(r.count), { color: accent, fontSize: 46, fontWeight: 900, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center', height: 52 }),
    text(width - 34, 40, 28, 24, unit, { color: t.muted, fontSize: 17, alignItems: 'center', height: 24 }),
  );
}

function leaderColumn(left: number, width: number, heading: string, accent: string, rows: LRow[], unit: string) {
  const list = rows.slice(0, 8).map((r, i) => leaderRow(left, 364 + i * 116, width, i + 1, r, accent, unit));
  return [
    el('div', { style: { display: 'flex', position: 'absolute', left, top: 300, width, height: 44, alignItems: 'center' } },
      el('div', { style: { display: 'flex', width: 8, height: 28, borderRadius: 4, background: accent, marginRight: 12 } }),
      el('div', { style: { display: 'flex', color: t.text, fontSize: 28, fontWeight: 900 } }, heading)),
    ...list,
  ];
}

export function scoreboardTemplate(d: CardPayload) {
  const sc = d.scoreboardCard;
  const scorers = sc?.scorers ?? [];
  const assists = sc?.assists ?? [];
  const leader = scorers[0];
  return el('div', {
    style: { width: '100%', height: '100%', display: 'flex', position: 'relative', background: t.bg, color: t.text, fontFamily: 'NotoSansSC' },
  },
    // 顶栏:品牌徽标 + 日期
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 48, width: 268, height: 54, background: 'linear-gradient(120deg, #FFC857 0%, #FF9F45 100%)', borderRadius: 14, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: '#1A1206', fontSize: 26, fontWeight: 900, letterSpacing: 1 } }, '射手榜 & 助攻榜')),
    text(W - M - 280, 56, 280, 36, sc?.asof || d.date || '', { color: t.faint, fontSize: 20, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
    // 赛事行
    text(M, 122, CW, 32, clampLine(sc?.title_line || '国际大赛 · 射手榜 & 助攻榜', 34), { color: t.muted, fontSize: 24, fontWeight: 700 }),
    // 金靴领跑横幅
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 168, width: CW, height: 96, background: 'linear-gradient(120deg, rgba(255,200,87,0.18) 0%, rgba(20,28,38,0.85) 60%)', border: `1px solid ${t.gold}`, borderRadius: 16, alignItems: 'center' } },
      el('div', { style: { display: 'flex', marginLeft: 24, marginRight: 20, color: t.gold, fontSize: 24, fontWeight: 900 } }, '金靴领跑'),
      el('div', { style: { display: 'flex', flexDirection: 'column' } },
        el('div', { style: { display: 'flex', color: t.text, fontSize: 34, fontWeight: 900 } }, leader ? clampLine(leader.name, 16) : '—'),
        el('div', { style: { display: 'flex', alignItems: 'center', marginTop: 4 } },
          leader?.flag ? el('img', { src: leader.flag, width: 26, height: 18, style: { width: 26, height: 18, borderRadius: 3, objectFit: 'cover', marginRight: 8 } }) : el('div', {}),
          el('div', { style: { display: 'flex', color: t.muted, fontSize: 20 } }, leader ? leader.team : '暂无数据'))),
      leader ? el('div', { style: { display: 'flex', position: 'absolute', right: 24, top: 20, width: 160, height: 56, alignItems: 'baseline', justifyContent: 'flex-end' } },
        el('div', { style: { display: 'flex', color: t.gold, fontSize: 52, fontWeight: 900 } }, String(leader.count)),
        el('div', { style: { display: 'flex', color: t.muted, fontSize: 22, marginLeft: 6 } }, '球'),
      ) : el('div', {}),
    ),
    // 两列(射手榜金左,助攻榜青右)
    ...leaderColumn(M, 468, '射手榜', t.gold, scorers, '球'),
    ...leaderColumn(M + 504, 468, '助攻榜', t.cyan, assists, '助'),
    // 底栏:数据来源 + 品牌
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 1340, width: CW, height: 1, background: t.line } }),
    text(M, 1366, 700, 22, sc?.note || '数据来源第三方足球数据源 · AI 生成内容整理', { color: t.faint, fontSize: 15, alignItems: 'center' }),
    text(W - M - 320, 1366, 320, 22, d.brand || '超帧球后说 · 射手榜&助攻榜 · AI 生成', { color: t.muted, fontSize: 15, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
  );
}
