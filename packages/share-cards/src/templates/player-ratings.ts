import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { flagImg } from '../el.js';
import { splitTextLines } from '../text-fit.js';

// 球员评分卡(小红书 3:4):顶部全场最佳横幅 + 主客两列各 Top5(姓名/位置/评分/进球助攻)。
// 配色与一图看懂同系:深色基调 + 绿/青强调;评分按高低着色。评分为第三方数据源算法值(底部标注)。
const t = {
  bg: 'linear-gradient(155deg, #0E1622 0%, #0A0E14 46%, #090C12 100%)',
  panel: '#141C26',
  panel2: '#0F161F',
  accent: '#00D982',
  accent2: '#5CC8FF',
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

/** 评分按高低着色:≥8 亮绿 / ≥7 青 / ≥6 白 / <6 暖红 / 无评分 暗。 */
function ratingColor(r: number | null): string {
  if (r == null) return t.faint;
  if (r >= 8) return t.accent;
  if (r >= 7) return t.accent2;
  if (r >= 6) return t.text;
  return '#FF7A7A';
}

function ratingText(r: number | null): string {
  return r == null ? '—' : r.toFixed(1);
}

interface PLine { name: string; rating: number | null; position: string; goals: number; assists: number }

/** 单个球员行:左 排名+姓名+位置/进球助攻,右 大评分。 */
function playerRow(left: number, top: number, width: number, rank: number, p: PLine, accent: string) {
  const ga: string[] = [];
  if (p.goals > 0) ga.push(`${p.goals} 球`);
  if (p.assists > 0) ga.push(`${p.assists} 助`);
  const sub = [p.position, ...ga].filter(Boolean).join(' · ');
  return el('div', {
    style: { display: 'flex', position: 'absolute', left, top, width, height: 116, background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 14 },
  },
    el('div', { style: { display: 'flex', position: 'absolute', left: 14, top: 40, width: 34, height: 34, borderRadius: 17, background: t.panel, border: `1px solid ${t.line}`, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: accent, fontSize: 18, fontWeight: 900 } }, String(rank))),
    text(60, 22, width - 180, 34, clampLine(p.name, 16), { color: t.text, fontSize: 28, fontWeight: 800, alignItems: 'center', height: 34 }),
    text(60, 64, width - 180, 26, clampLine(sub, 18), { color: t.muted, fontSize: 19, alignItems: 'center', height: 26 }),
    text(width - 116, 28, 100, 56, ratingText(p.rating), { color: ratingColor(p.rating), fontSize: 46, fontWeight: 900, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center', height: 56 }),
  );
}

function teamColumn(left: number, width: number, teamName: string, accent: string, players: PLine[], flagUrl?: string) {
  const rows = players.slice(0, 5).map((p, i) => playerRow(left, 350 + i * 126, width, i + 1, p, accent));
  const flag = flagUrl ? flagImg(flagUrl, 26) : null; // 队旗(已由 renderShareCard 预取为 data URL)
  return [
    // 队名表头(色条 + 国旗 + 队名)
    el('div', { style: { display: 'flex', position: 'absolute', left, top: 290, width, height: 44, alignItems: 'center' } },
      el('div', { style: { display: 'flex', width: 8, height: 28, borderRadius: 4, background: accent, marginRight: 12 } }),
      ...(flag ? [flag] : []),
      el('div', { style: { display: 'flex', color: t.text, fontSize: 28, fontWeight: 900, marginLeft: flag ? 10 : 0 } }, clampLine(teamName, 8))),
    ...rows,
  ];
}

export function playerRatingsTemplate(d: CardPayload) {
  const rc = d.ratingsCard;
  const motm = rc?.motm;
  const home = rc?.home ?? { team: d.homeTeam || '主队', players: [] };
  const away = rc?.away ?? { team: d.awayTeam || '客队', players: [] };
  return el('div', {
    style: { width: '100%', height: '100%', display: 'flex', position: 'relative', background: t.bg, color: t.text, fontFamily: 'NotoSansSC' },
  },
    // 顶栏:品牌徽标 + 日期
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 48, width: 168, height: 54, background: 'linear-gradient(120deg, #00D982 0%, #00B8C4 100%)', borderRadius: 14, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: '#04110A', fontSize: 26, fontWeight: 900, letterSpacing: 1 } }, '球员评分')),
    text(W - M - 240, 56, 240, 36, d.date || '', { color: t.faint, fontSize: 20, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
    // 赛事 + 比分行
    text(M, 122, CW, 32, clampLine(rc?.match_line || `${d.homeTeam} ${d.homeScore}:${d.awayScore} ${d.awayTeam}`, 34), { color: t.muted, fontSize: 24, fontWeight: 700 }),
    // 全场最佳横幅
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 168, width: CW, height: 96, background: 'linear-gradient(120deg, rgba(255,200,87,0.18) 0%, rgba(20,28,38,0.85) 60%)', border: `1px solid ${t.gold}`, borderRadius: 16, alignItems: 'center' } },
      el('div', { style: { display: 'flex', marginLeft: 24, marginRight: 20, color: t.gold, fontSize: 24, fontWeight: 900 } }, '全场最佳'),
      el('div', { style: { display: 'flex', flexDirection: 'column' } },
        el('div', { style: { display: 'flex', color: t.text, fontSize: 34, fontWeight: 900 } }, motm ? clampLine(motm.name, 20) : '—'),
        el('div', { style: { display: 'flex', color: t.muted, fontSize: 20, marginTop: 2 } }, motm ? `${motm.team}${motm.position ? ` · ${motm.position}` : ''}` : '暂无评分')),
      motm ? text(CW - 150, 20, 130, 56, motm.rating.toFixed(1), { color: ratingColor(motm.rating), fontSize: 52, fontWeight: 900, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center', height: 56 }) : el('div', {}),
    ),
    // 主客两列(主左客右,与比分行"主 X:Y 客"一致)。国旗由 d.homeFlagUrl/awayFlagUrl(已预取)
    ...teamColumn(M, 468, home.team, t.accent, home.players, d.homeFlagUrl),
    ...teamColumn(M + 504, 468, away.team, t.accent2, away.players, d.awayFlagUrl),
    // 底栏:数据来源 + 品牌
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: 1340, width: CW, height: 1, background: t.line } }),
    text(M, 1366, 760, 22, rc?.note || '球员评分为第三方数据源算法值 · AI 生成内容整理', { color: t.faint, fontSize: 15, alignItems: 'center' }),
    text(W - M - 280, 1366, 280, 22, d.brand || '超帧球后说 · 球员评分 · AI 生成', { color: t.muted, fontSize: 15, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
  );
}
