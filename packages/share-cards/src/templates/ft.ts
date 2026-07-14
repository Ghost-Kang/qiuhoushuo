import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { splitTextLines } from '../text-fit.js';

/**
 * 官方战报风卡(ft·XHS 3:4 1080×1440):国际官方赛后模版结构 × 球后品牌皮肤。
 * 结构:FT 徽 + 元数据行 → 比分区(旗/队名/大比分/进程行/双栏进球者)→ POTM 金条
 * → 横向数据对比条(绿=主队 蓝=客队)→ 关键时间线 → 金句 → 底部披露。
 * 与 brief 卡差异:去阵型图/胜负关键三段/镜头照片,官方骨架事实密度优先;
 * 无外部图片依赖(只用国旗 data URL)→ 渲染必成功、恒可缓存。
 */
const t = {
  bgGrad: 'linear-gradient(155deg, #0E1622 0%, #0A0E14 46%, #090C12 100%)',
  panel: 'rgba(20,28,38,0.86)',
  gold: '#FFC857',
  home: '#00D982',
  away: '#5CC8FF',
  text: '#F5F8FC',
  muted: '#9DAAB9',
  faint: '#5E6C7C',
  line: 'rgba(255,255,255,0.10)',
  lineSoft: 'rgba(255,255,255,0.06)',
};

const W = 1080;
const M = 56;

function clampLine(value: string, n: number): string {
  return splitTextLines(value, n, 1)[0] || '';
}

function flag(url: string | undefined, w: number) {
  if (!url) return null;
  return el('img', { src: url, width: w, height: Math.round(w * 0.72), style: { width: w, height: Math.round(w * 0.72), objectFit: 'cover', borderRadius: 8 } });
}

function bar(b: { label: string; home: string; away: string; home_ratio: number }) {
  const hw = Math.max(4, Math.min(96, Math.round(b.home_ratio))); // 极端值也保留双色可见
  return el('div', { style: { flexDirection: 'column', gap: 8 } },
    el('div', { style: { justifyContent: 'space-between', alignItems: 'center' } },
      el('div', { style: { color: t.home, fontSize: 30, fontWeight: 900, width: 120 } }, b.home),
      el('div', { style: { color: t.muted, fontSize: 26, fontWeight: 700 } }, b.label),
      el('div', { style: { color: t.away, fontSize: 30, fontWeight: 900, width: 120, justifyContent: 'flex-end' } }, b.away)),
    el('div', { style: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' } },
      el('div', { style: { width: `${hw}%`, backgroundColor: t.home } }),
      el('div', { style: { width: `${100 - hw}%`, backgroundColor: t.away } })),
  );
}

export function ftTemplate(d: CardPayload) {
  const ft = d.ftCard;
  const scoreText = `${d.homeScore} : ${d.awayScore}`;
  // 进球者双栏行数差过大时不强撑;每侧最多 4 行,超出并「等 N 人」
  const scorers = (list: string[]) => {
    const rows = list.slice(0, 4).map((s) => clampLine(s, 16));
    if (list.length > 4) rows[3] = `${rows[3]} 等`;
    return rows;
  };
  const homeScorers = scorers(ft?.home_scorers || []);
  const awayScorers = scorers(ft?.away_scorers || []);
  const timeline = (ft?.timeline || []).slice(0, 5);
  const bars = (ft?.bars || []).slice(0, 4);

  return el('div', { style: { width: W, height: 1440, flexDirection: 'column', backgroundImage: t.bgGrad, fontFamily: 'NotoSansSC', position: 'relative', padding: `40px ${M}px` } },
    // 顶栏:FT 徽 + 北京日期
    el('div', { style: { justifyContent: 'space-between', alignItems: 'center' } },
      el('div', { style: { backgroundColor: t.gold, color: '#1a1200', fontSize: 30, fontWeight: 900, padding: '10px 26px', borderRadius: 999 } }, '全场结束 FULL TIME'),
      el('div', { style: { color: t.muted, fontSize: 26 } }, ft?.date_line || d.date)),
    el('div', { style: { color: t.muted, fontSize: 24, marginTop: 14 } }, clampLine(ft?.meta_line || d.competition, 38)),

    // 比分区
    el('div', { style: { marginTop: 20, flexDirection: 'column', backgroundColor: t.panel, border: `1px solid ${t.line}`, borderRadius: 20, padding: '22px 32px', gap: 10 } },
      el('div', { style: { justifyContent: 'space-between', alignItems: 'center' } },
        el('div', { style: { flexDirection: 'column', alignItems: 'center', gap: 8, width: 240 } }, flag(d.homeFlagUrl, 68), el('div', { style: { color: t.text, fontSize: 36, fontWeight: 900 } }, clampLine(d.homeTeam, 6))),
        el('div', { style: { color: t.text, fontSize: 88, fontWeight: 900 } }, scoreText),
        el('div', { style: { flexDirection: 'column', alignItems: 'center', gap: 8, width: 240 } }, flag(d.awayFlagUrl, 68), el('div', { style: { color: t.text, fontSize: 36, fontWeight: 900 } }, clampLine(d.awayTeam, 6)))),
      ft?.progression ? el('div', { style: { justifyContent: 'center', color: t.gold, fontSize: 26, fontWeight: 700 } }, ft.progression) : null,
      // 进球者双栏(官方赛后图签名结构;乌龙随受益方列出并标注)
      (homeScorers.length || awayScorers.length)
        ? el('div', { style: { borderTop: `1px solid ${t.lineSoft}`, paddingTop: 12, justifyContent: 'space-between' } },
            el('div', { style: { flexDirection: 'column', gap: 6 } },
              ...homeScorers.map((s) => el('div', { style: { color: t.text, fontSize: 27 } }, s))),
            el('div', { style: { flexDirection: 'column', gap: 6, alignItems: 'flex-end' } },
              ...awayScorers.map((s) => el('div', { style: { color: t.text, fontSize: 27 } }, s))))
        : null,
    ),

    // POTM 金条
    ft?.potm ? el('div', { style: { marginTop: 14, backgroundImage: 'linear-gradient(90deg, rgba(255,200,87,0.22), rgba(255,200,87,0.04))', border: '1px solid rgba(255,200,87,0.5)', borderRadius: 14, padding: '12px 26px', alignItems: 'center', justifyContent: 'space-between' } },
      el('div', { style: { color: t.gold, fontSize: 30, fontWeight: 900 } }, clampLine(ft.potm, 22)),
      el('div', { style: { color: t.muted, fontSize: 24 } }, '评分:第三方数据源算法值')) : null,

    // 数据对比条(绿=主队 蓝=客队,颜色即表头)
    bars.length ? el('div', { style: { marginTop: 14, flexDirection: 'column', gap: 13, backgroundColor: t.panel, border: `1px solid ${t.line}`, borderRadius: 20, padding: '20px 32px' } },
      ...bars.map(bar)) : null,

    // 关键时间线
    timeline.length ? el('div', { style: { marginTop: 14, flexDirection: 'column', gap: 9, backgroundColor: t.panel, border: `1px solid ${t.line}`, borderRadius: 20, padding: '18px 32px' } },
      el('div', { style: { color: t.gold, fontSize: 26, fontWeight: 900 } }, '关键时间线'),
      ...timeline.map((row) => el('div', { style: { gap: 16, alignItems: 'center' } },
        el('div', { style: { color: t.gold, fontSize: 24, fontWeight: 700, width: 112 } }, clampLine(row.minute, 5)),
        el('div', { style: { color: t.text, fontSize: 26 } }, clampLine(row.text, 28))))) : null,

    // 金句(球后人设,一句就够)
    // 金句固定在披露行上方(absolute),内容高时不与底部叠(阿根廷卡 4 行时间线实测)
    ft?.quote ? el('div', { style: { position: 'absolute', left: M, right: M, bottom: 88, justifyContent: 'center', color: t.home, fontSize: 27, fontWeight: 700 } }, clampLine(`「${ft.quote}」`, 30)) : null,

    // 底部披露 + 落款
    el('div', { style: { position: 'absolute', left: M, right: M, bottom: 40, justifyContent: 'space-between' } },
      el('div', { style: { color: 'rgba(157,170,185,0.75)', fontSize: 22 } }, ft?.integrity_note || 'AI 生成内容,基于比分、战报与可用技术统计整理'),
      el('div', { style: { color: 'rgba(157,170,185,0.9)', fontSize: 22 } }, d.brand || '超帧球后说 · AI 生成')),
  );
}
