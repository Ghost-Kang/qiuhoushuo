import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { formationDots } from '../formation.js';

const t = {
  bg: '#0C1117',
  pitch: '#0E3B24',
  pitch2: '#0A301D',
  lineOn: 'rgba(245,247,250,0.42)',
  accent: '#00C776',
  accent2: '#61DAFB',
  text: '#F5F7FA',
  muted: '#A7B4C2',
  faint: '#687684',
  line: '#263241',
};

const PITCH = { left: 90, top: 206, width: 900, height: 1056 };
const HALF_H = PITCH.height / 2;
const DOT = 46;
const FALLBACK_FORMATION = '4-4-2';

export function tacticsTemplate(d: CardPayload) {
  const tac = d.tactics;
  const homeFormation = tac?.homeFormation || FALLBACK_FORMATION;
  const awayFormation = tac?.awayFormation || FALLBACK_FORMATION;
  return el('div', {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      position: 'relative',
      background: t.bg,
      color: t.text,
      fontFamily: 'NotoSansSC',
    },
  },
    box(48, 48, 152, 54, t.accent, '战术图解', { color: '#06110B', fontSize: 25, fontWeight: 900, justifyContent: 'center', alignItems: 'center' }),
    text(932, 70, 100, 24, d.date || '', { color: t.muted, fontSize: 20, textAlign: 'right' }),
    text(48, 120, 930, 26, `${d.competition ? `${d.competition} · ` : ''}${d.homeTeam} ${d.homeScore}:${d.awayScore} ${d.awayTeam}`, { color: t.muted, fontSize: 22 }),
    teamLabel(48, 158, t.accent2, `${d.awayTeam} · ${awayFormation}`, d.awayFlagUrl),
    pitch(),
    ...dots(awayFormation, 'away', t.accent2),
    ...dots(homeFormation, 'home', t.accent),
    teamLabel(48, 1278, t.accent, `${d.homeTeam} · ${homeFormation}`, d.homeFlagUrl),
    text(48, 1330, 700, 30, d.shareQuote || '两队首发站位，一眼看懂攻防侧重。', { color: t.accent, fontSize: 24, fontWeight: 900 }),
    text(48, 1392, 640, 18, tac?.note || 'AI 生成内容，站位基于官方首发阵型整理。', { color: t.faint, fontSize: 14 }),
    text(798, 1392, 232, 18, d.brand || '超帧球后说 · AI 生成', { color: t.muted, fontSize: 14, textAlign: 'right' }),
  );
}

function pitch() {
  const { left, top, width, height } = PITCH;
  return el('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      left,
      top,
      width,
      height,
      background: `linear-gradient(180deg, ${t.pitch}, ${t.pitch2})`,
      border: `3px solid ${t.lineOn}`,
    },
  },
    // 中线 / 中圈 / 上下禁区（坐标相对球场容器）
    mark(0, HALF_H - 1, width, 2),
    el('div', { style: { display: 'flex', position: 'absolute', left: width / 2 - 78, top: HALF_H - 78, width: 156, height: 156, borderRadius: 156, border: `2px solid ${t.lineOn}` } }),
    penaltyBox(width, 0, false),
    penaltyBox(width, height, true),
    text(width / 2 - 60, 14, 120, 20, '客队半场', { color: t.lineOn, fontSize: 16, justifyContent: 'center' }),
    text(width / 2 - 60, height - 36, 120, 20, '主队半场', { color: t.lineOn, fontSize: 16, justifyContent: 'center' }),
  );
}

function penaltyBox(pitchWidth: number, edgeY: number, bottom: boolean) {
  const bigW = 380;
  const bigH = 132;
  const smallW = 180;
  const smallH = 54;
  const left = (pitchWidth - bigW) / 2;
  const smallLeft = (pitchWidth - smallW) / 2;
  const bigTop = bottom ? edgeY - bigH : edgeY;
  const smallTop = bottom ? edgeY - smallH : edgeY;
  return el('div', { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: pitchWidth, height: 1 } },
    el('div', { style: { display: 'flex', position: 'absolute', left, top: bigTop, width: bigW, height: bigH, border: `2px solid ${t.lineOn}` } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: smallLeft, top: smallTop, width: smallW, height: smallH, border: `2px solid ${t.lineOn}` } }),
  );
}

function mark(left: number, top: number, width: number, height: number) {
  return el('div', { style: { display: 'flex', position: 'absolute', left, top, width, height, background: t.lineOn } });
}

function dots(formation: string, side: 'home' | 'away', color: string) {
  const placed = formationDots(formation) ?? formationDots(FALLBACK_FORMATION)!;
  return placed.map((dot) => {
    const x = PITCH.left + dot.fx * PITCH.width - DOT / 2;
    // fy: 0=本方球门线 → 1=中线。客队半场在上（球门线=球场顶edge），主队在下。
    const yInHalf = 10 + dot.fy * (HALF_H - 56);
    const y = side === 'away' ? PITCH.top + yInHalf : PITCH.top + PITCH.height - yInHalf - DOT;
    return el('div', {
      style: {
        display: 'flex',
        position: 'absolute',
        left: x,
        top: y,
        width: DOT,
        height: DOT,
        borderRadius: DOT,
        background: dot.line === 0 ? '#F5F7FA' : color,
        border: `3px solid rgba(12,17,23,0.55)`,
      },
    });
  });
}

function teamLabel(left: number, top: number, color: string, label: string, flagUrl?: string) {
  return el('div', { style: { display: 'flex', position: 'absolute', left, top, width: 760, height: 44, alignItems: 'center' } },
    el('div', { style: { display: 'flex', width: 22, height: 22, borderRadius: 22, background: color, marginRight: 14 } }),
    // 国旗(圆角矩形显全旗;复用赛事/战报/一图看懂同一套国旗图,缺旗则不占位)
    ...(flagUrl
      ? [el('div', { style: { display: 'flex', width: 54, height: 36, borderRadius: 6, overflow: 'hidden', border: `1px solid ${t.line}`, marginRight: 14 } },
          el('img', { src: flagUrl, width: 54, height: 36, style: { width: 54, height: 36, objectFit: 'cover' } }),
        )]
      : []),
    el('div', { style: { display: 'flex', fontSize: 30, fontWeight: 900 } }, label),
  );
}

function text(left: number, top: number, width: number, height: number, value: string, style: Record<string, unknown> = {}) {
  return el('div', {
    style: {
      display: 'flex',
      position: 'absolute',
      left,
      top,
      width,
      height,
      overflow: 'hidden',
      ...style,
    },
  }, value);
}

function box(left: number, top: number, width: number, height: number, background: string, value: string, style: Record<string, unknown> = {}) {
  return text(left, top, width, height, value, { background, ...style });
}
