import type { CardPayload } from '../types.js';
import { el } from '../el.js';
import { fitText, splitTextLines } from '../text-fit.js';
import { formationDots } from '../formation.js';

/** 单行裁剪 + 省略号：盒子是定高单行 overflow:hidden，长文必须在此截净，否则被拦腰切断在半字。 */
function clampLine(value: string, charsPerLine: number): string {
  return splitTextLines(value, charsPerLine, 1)[0] || '';
}

/**
 * 配色:深色高级基调 + 年轻化渐变强调。绿(主队/正向)→ 青(客队/数据)双色系,
 * 卡片用半透明描边 + 微圆角营造"信息图"质感,避免大色块杂乱。
 */
const t = {
  bg: '#0A0E14',
  bgGrad: 'linear-gradient(155deg, #0E1622 0%, #0A0E14 46%, #090C12 100%)',
  panel: '#141C26',
  panel2: '#0F161F',
  panelHi: '#18222E',
  accent: '#00D982',          // 主队 / 正向绿
  accentDim: '#0B3A28',
  accent2: '#5CC8FF',         // 客队 / 数据青
  accent2Dim: '#103044',
  gold: '#FFC857',            // 镜头 / 高光暖金
  text: '#F5F8FC',
  muted: '#9DAAB9',
  faint: '#5E6C7C',
  line: 'rgba(255,255,255,0.08)',
  lineSoft: 'rgba(255,255,255,0.05)',
  pitch: '#0D3A26',
  pitch2: '#0A2C1D',
  pitchLine: 'rgba(245,248,252,0.30)',
  radius: 18,
};

const W = 1080;
const M = 56;                 // 外边距
const CW = W - M * 2;         // 内容宽 968

export function briefTemplate(d: CardPayload) {
  const brief = d.briefCard;
  const lens = brief?.highlight_lens;
  const formation = brief?.formation;
  const hasPitch = Boolean(formation && (formationDots(formation.home) || formationDots(formation.away)));

  const title = fitText(brief?.title || d.title, '一图看懂这场比赛', { fontSize: 50, charsPerLine: 16, lineHeight: 1.14, maxLines: 2 }, [
    { minLength: 34, fontSize: 42, charsPerLine: 19, lineHeight: 1.16 },
    { minLength: 26, fontSize: 46, charsPerLine: 17, lineHeight: 1.14 },
  ]);
  const summary = fitText(brief?.one_sentence_summary || d.subtitle || d.shareQuote, '胜负手落在效率和关键回合。', { fontSize: 27, charsPerLine: 27, lineHeight: 1.26, maxLines: 2 }, [
    { minLength: 46, fontSize: 24, charsPerLine: 31, lineHeight: 1.26 },
  ]);
  const share = fitText(brief?.share_line || d.shareQuote, '两分钟看懂这场球的重点。', { fontSize: 26, charsPerLine: 26, lineHeight: 1.2, maxLines: 2 }, [
    { minLength: 44, fontSize: 22, charsPerLine: 31, lineHeight: 1.22 },
  ]);

  // ── 垂直布局基线(全固定) ────────────────────────────────────────
  // 关键:中段以下全部固定基线,标题/摘要在「保留带 316→512」内顶对齐
  // (短文留白、长文最多 2 行不下溢)。球场/镜头/胜负关键/数据/时间线/底栏
  // 位置确定,任意文案长度都不重叠不溢出画布。
  const heroTop = 124;
  const titleTop = 312;
  const summaryTop = titleTop + title.lines.length * title.lineHeightPx + 8;
  const tagsTop = summaryTop + summary.lines.length * summary.lineHeightPx + 12;
  const midTop = 536;            // 球场 / 镜头并排行(保留带 312→528 容 2 行标题 + 2 行摘要 + 标签)
  const midH = 268;              // 536 → 804,留 12px 到胜负关键
  const reasonsTop = 816;        // section label
  const reasonRowH = 72;
  const dataTop = 1084;          // 数据/时间线 section label
  const footerY = 1332;

  return el('div', {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      position: 'relative',
      background: t.bgGrad,
      color: t.text,
      fontFamily: 'NotoSansSC',
    },
  },
    // 顶部装饰:左上角斜向光晕(年轻化高级感),纯叠加色块不抢信息
    el('div', { style: { display: 'flex', position: 'absolute', left: -120, top: -160, width: 520, height: 420, borderRadius: 420, background: 'radial-gradient(circle, rgba(0,217,130,0.16) 0%, rgba(0,217,130,0) 70%)' } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: 720, top: -120, width: 440, height: 380, borderRadius: 440, background: 'radial-gradient(circle, rgba(92,200,255,0.12) 0%, rgba(92,200,255,0) 70%)' } }),

    // ── 顶栏:品牌徽标 + 赛事(单行裁净) + 日期 ──
    // 只放赛事名:比分在主视觉卡、日期在右上,不重复 match_line 全串(全串过长会换行被压,用户报修)。
    brandPill(M, 48),
    text(M + 152, 56, 580, 36, clampLine(d.competition || `${d.homeTeam} vs ${d.awayTeam}`, 36), { color: t.muted, fontSize: 20, alignItems: 'center' }),
    text(W - M - 200, 56, 200, 36, d.date || '', { color: t.faint, fontSize: 20, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),

    // ── 比分主视觉:大比分 + 队徽 + 队名 ──
    scoreHero(heroTop, d),

    // ── 标题 + 一句话摘要 + 关注点标签 ──
    ...textLines(M, titleTop, CW, title, { fontWeight: 900, letterSpacing: -0.5 }),
    ...textLines(M, summaryTop, CW, summary, { color: t.accent2, fontWeight: 800 }),
    ...(brief?.focus_tags ?? []).slice(0, 3).map((tag, i) =>
      tagPill(M + i * 150, tagsTop, clampLine(tag, 8))),

    // ── 中段并排:紧凑球场阵型 + 精彩镜头 (无阵型时镜头占满) ──
    ...(hasPitch
      ? [
          pitchPanel(M, midTop, 452, midH, formation!, d),
          lensPanel(M + 452 + 24, midTop, CW - 452 - 24, midH, lens),
        ]
      : [lensPanel(M, midTop, CW, midH, lens)]),

    // ── 胜负关键三条 ──
    sectionLabel(M, reasonsTop, '胜负关键', t.accent),
    ...(brief?.key_reasons ?? []).slice(0, 3).map((reason, i) =>
      reasonBox(M, reasonsTop + 30 + i * reasonRowH, i + 1, reason.title, reason.evidence)),

    // ── 数据证据 + 时间线 (并排两列) ──
    sectionLabel(M, dataTop, '数据证据', t.accent2),
    ...(brief?.data_points ?? []).slice(0, 4).map((p, i) =>
      dataBox(M + (i % 2) * 246, dataTop + 30 + Math.floor(i / 2) * 68, p.label, p.value, p.note)),
    sectionLabel(M + 504, dataTop, '关键时间线', t.gold),
    ...(brief?.timeline ?? []).slice(0, 4).map((item, i) =>
      timelineRow(M + 504, dataTop + 30 + i * 50, item.minute, item.text)),

    // ── 底部:分享句 + 诚信说明 + 品牌 ──
    el('div', { style: { display: 'flex', position: 'absolute', left: M, top: footerY, width: CW, height: 1, background: t.line } }),
    ...textLines(M, footerY + 14, 760, share, { color: t.accent, fontWeight: 900 }),
    text(M, 1416, 600, 18, brief?.integrity_note || 'AI 生成内容，基于可用事实整理。', { color: t.faint, fontSize: 14, alignItems: 'center' }),
    text(W - M - 280, 1416, 280, 18, d.brand || '超帧球后说 · 一图看懂 · AI 生成', { color: t.muted, fontSize: 14, textAlign: 'right', justifyContent: 'flex-end', alignItems: 'center' }),
  );
}

type BriefLens = NonNullable<NonNullable<CardPayload['briefCard']>['highlight_lens']>;

function logo(url: string | undefined, size: number) {
  return url
    ? el('img', { src: url, width: size, height: size, style: { display: 'flex', objectFit: 'contain' } })
    : el('div', { style: { display: 'flex', width: size, height: size, borderRadius: size / 2, background: t.panel, border: `2px solid ${t.line}` } });
}

/** 国旗徽章:圆角矩形显全旗(竖三色旗不裁切失真),与赛事/战报小程序同一套国旗图。缺旗回退队徽/占位。 */
function teamBadge(flagUrl: string | undefined, logoUrl: string | undefined) {
  const W = 108;
  const H = 72;
  if (flagUrl) {
    return el('div', { style: { display: 'flex', width: W, height: H, borderRadius: 14, overflow: 'hidden', border: `1px solid ${t.line}` } },
      el('img', { src: flagUrl, width: W, height: H, style: { width: W, height: H, objectFit: 'cover' } }),
    );
  }
  return logo(logoUrl, 88);
}

/** 品牌徽标:绿→青渐变胶囊,年轻化锚点。 */
function brandPill(left: number, top: number) {
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width: 132, height: 52,
      background: 'linear-gradient(120deg, #00D982 0%, #00B8C4 100%)',
      borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    },
  },
    el('div', { style: { display: 'flex', color: '#04110A', fontSize: 25, fontWeight: 900, letterSpacing: 1 } }, '一图看懂'),
  );
}

/** 比分主视觉:左队徽+队名 / 中大比分 / 右队徽+队名,横向居中。 */
function scoreHero(top: number, d: CardPayload) {
  const homeWin = (d.homeScore ?? 0) > (d.awayScore ?? 0);
  const awayWin = (d.awayScore ?? 0) > (d.homeScore ?? 0);
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left: M, top, width: CW, height: 168,
      background: 'linear-gradient(160deg, rgba(24,34,46,0.85) 0%, rgba(15,22,31,0.85) 100%)',
      border: `1px solid ${t.line}`, borderRadius: t.radius,
      alignItems: 'center', justifyContent: 'space-between', padding: '0 44px',
    },
  },
    // 主队
    el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 240 } },
      teamBadge(d.homeFlagUrl, d.homeLogoUrl),
      el('div', { style: { display: 'flex', marginTop: 12, fontSize: 30, fontWeight: 800, color: homeWin ? t.accent : t.text } }, clampLine(d.homeTeam || '主队', 8)),
    ),
    // 比分
    el('div', { style: { display: 'flex', alignItems: 'center' } },
      el('div', { style: { display: 'flex', fontSize: 104, fontWeight: 900, lineHeight: 1, color: homeWin ? t.accent : t.text } }, String(d.homeScore ?? 0)),
      el('div', { style: { display: 'flex', fontSize: 60, fontWeight: 700, color: t.faint, margin: '0 22px', marginTop: 6 } }, ':'),
      el('div', { style: { display: 'flex', fontSize: 104, fontWeight: 900, lineHeight: 1, color: awayWin ? t.accent2 : t.text } }, String(d.awayScore ?? 0)),
    ),
    // 客队
    el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 240 } },
      teamBadge(d.awayFlagUrl, d.awayLogoUrl),
      el('div', { style: { display: 'flex', marginTop: 12, fontSize: 30, fontWeight: 800, color: awayWin ? t.accent2 : t.text } }, clampLine(d.awayTeam || '客队', 8)),
    ),
  );
}

/** 关注点标签胶囊:固定宽度,8 字内裁净。 */
function tagPill(left: number, top: number, label: string) {
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width: 134, height: 40,
      background: t.panel, border: `1px solid ${t.line}`, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
    },
  },
    el('div', { style: { display: 'flex', color: t.muted, fontSize: 18, fontWeight: 800 } }, `# ${label}`),
  );
}

/**
 * 紧凑竖版球场:客队半场在上(青),主队半场在下(绿)。
 * 复用 formationDots 半场分数坐标,在 panel 内按上下半场翻转换算像素。
 * 非法/缺阵型由调用方 hasPitch 拦截,这里两队都按各自串解析(单边非法降级 4-4-2)。
 */
function pitchPanel(left: number, top: number, width: number, height: number, formation: { home: string; away: string }, d: CardPayload) {
  const FALLBACK = '4-4-2';
  const homeF = formationDots(formation.home) ? formation.home : FALLBACK;
  const awayF = formationDots(formation.away) ? formation.away : FALLBACK;

  // 球场绘制区(留出上下队名标签与边距)
  const pad = 18;
  const labelH = 26;
  const px = pad;
  const pTop = labelH;
  const pw = width - pad * 2;
  const ph = height - labelH * 2;
  const halfH = ph / 2;
  const DOT = 20;
  const rowMargin = 7; // 半场内上下边距

  const dots = (f: string, side: 'home' | 'away', color: string) => {
    const placed = formationDots(f) ?? formationDots(FALLBACK)!;
    // 按线序均匀铺满半场:窄紧凑半场(~100px)放 3-4-2-1 这类 5 排点时,formationDots 原始 fy
    // 会把各线挤在 ~50px 内致圆点竖向重叠(F67i 报修)。改用 line 索引等距铺开,行距最大化。
    const maxLine = Math.max(1, ...placed.map((p) => p.line));
    const usable = halfH - DOT - rowMargin * 2;
    return placed.map((dot) => {
      const x = px + dot.fx * pw - DOT / 2;
      // rowFrac:0=门将(本方球门线)→ 1=最前线(中线)
      const rowFrac = dot.line / maxLine;
      const yInHalf = rowMargin + rowFrac * usable;
      const y = side === 'away' ? pTop + yInHalf : pTop + ph - yInHalf - DOT;
      return el('div', {
        style: {
          display: 'flex', position: 'absolute', left: x, top: y, width: DOT, height: DOT,
          borderRadius: DOT, background: dot.line === 0 ? t.text : color,
          border: '2px solid rgba(10,14,20,0.6)',
        },
      });
    });
  };

  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width, height,
      background: t.panel, border: `1px solid ${t.line}`, borderRadius: t.radius,
      overflow: 'hidden',
    },
  },
    // 草坪
    el('div', {
      style: {
        display: 'flex', position: 'absolute', left: px, top: pTop, width: pw, height: ph,
        background: `linear-gradient(180deg, ${t.pitch} 0%, ${t.pitch2} 100%)`,
        borderRadius: 10, border: `2px solid ${t.pitchLine}`,
      },
    },
      // 中线
      el('div', { style: { display: 'flex', position: 'absolute', left: 0, top: halfH - 1, width: pw, height: 2, background: t.pitchLine } }),
      // 中圈
      el('div', { style: { display: 'flex', position: 'absolute', left: pw / 2 - 38, top: halfH - 38, width: 76, height: 76, borderRadius: 76, border: `2px solid ${t.pitchLine}` } }),
      // 上禁区(客队)
      penaltyBox(pw, 0, false),
      // 下禁区(主队)
      penaltyBox(pw, ph, true),
    ),
    // 阵型点
    ...dots(awayF, 'away', t.accent2),
    ...dots(homeF, 'home', t.accent),
    // 上标签(客队)
    pitchTeamLabel(px, 6, width - pad * 2, t.accent2, clampLine(d.awayTeam || '客队', 6), awayF, 'flex-start'),
    // 下标签(主队)
    pitchTeamLabel(px, height - labelH + 2, width - pad * 2, t.accent, clampLine(d.homeTeam || '主队', 6), homeF, 'flex-end'),
  );
}

function pitchTeamLabel(left: number, top: number, width: number, color: string, name: string, formation: string, align: 'flex-start' | 'flex-end') {
  return el('div', { style: { display: 'flex', position: 'absolute', left, top, width, height: 28, alignItems: 'center', justifyContent: align } },
    el('div', { style: { display: 'flex', width: 14, height: 14, borderRadius: 14, background: color, marginRight: 9 } }),
    el('div', { style: { display: 'flex', fontSize: 20, fontWeight: 900, color: t.text, marginRight: 10 } }, name),
    el('div', { style: { display: 'flex', fontSize: 17, fontWeight: 800, color } }, formation),
  );
}

function penaltyBox(pitchWidth: number, edgeY: number, bottom: boolean) {
  const bigW = pitchWidth * 0.46;
  const bigH = 56;
  const smallW = pitchWidth * 0.22;
  const smallH = 24;
  const left = (pitchWidth - bigW) / 2;
  const smallLeft = (pitchWidth - smallW) / 2;
  const bigTop = bottom ? edgeY - bigH : edgeY;
  const smallTop = bottom ? edgeY - smallH : edgeY;
  return el('div', { style: { display: 'flex', position: 'absolute', left: 0, top: 0, width: pitchWidth, height: 1 } },
    el('div', { style: { display: 'flex', position: 'absolute', left, top: bigTop, width: bigW, height: bigH, border: `2px solid ${t.pitchLine}` } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: smallLeft, top: smallTop, width: smallW, height: smallH, border: `2px solid ${t.pitchLine}` } }),
  );
}

/**
 * 精彩镜头面板:配图 + 标题 + 说明。
 * 有球场时窄列(配图占顶部),无球场时宽幅(配图左、文字右)。
 */
function lensPanel(left: number, top: number, width: number, height: number, lens?: BriefLens) {
  const wide = width > 600; // 无球场降级 → 宽幅横排
  const title = clampLine(lens?.title || '精彩镜头', wide ? 18 : 14);
  const captionLines = splitTextLines(lens?.caption || '这一下是整篇战报的主画面。', wide ? 22 : 17, wide ? 3 : 2);

  if (wide) {
    const imgW = 420;
    const imgH = height - 36;
    return el('div', {
      style: {
        display: 'flex', position: 'absolute', left, top, width, height,
        background: t.panelHi, border: `1px solid ${t.line}`, borderRadius: t.radius, overflow: 'hidden',
      },
    },
      el('div', { style: { display: 'flex', position: 'absolute', left: 18, top: 18, width: imgW, height: imgH, borderRadius: 12, border: `2px solid ${t.gold}`, overflow: 'hidden' } },
        lens?.image_url
          ? el('img', { src: lens.image_url, width: imgW, height: imgH, style: { width: imgW, height: imgH, objectFit: 'cover' } })
          : fallbackPitchImg(imgW, imgH),
        text(10, imgH - 30, 100, 22, 'AI 示意画面', { position: 'absolute', color: '#FFFFFF', background: 'rgba(0,0,0,0.5)', fontSize: 12, fontWeight: 900, padding: '4px 8px', borderRadius: 6, alignItems: 'center' }),
      ),
      lensBadge(imgW + 40, 28),
      text(imgW + 40, 70, width - imgW - 60, 40, title, { fontSize: 30, fontWeight: 900, lineHeight: 1.16, alignItems: 'center' }),
      ...captionLines.map((line, i) => text(imgW + 40, 124 + i * 30, width - imgW - 60, 28, line, { color: t.muted, fontSize: 19, lineHeight: 1.3 })),
    );
  }

  // 窄列:配图占顶部 ~52%,文字区在下(随 panel 高度自适应,不写死)。
  const imgW = width - 32;
  const imgH = Math.round(height * 0.46);     // 268 → 123,给文字区留 2 行说明
  const textTop = 16 + imgH + 12;             // 文字区起点
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width, height,
      background: t.panelHi, border: `1px solid ${t.line}`, borderRadius: t.radius, overflow: 'hidden',
    },
  },
    el('div', { style: { display: 'flex', position: 'absolute', left: 16, top: 16, width: imgW, height: imgH, borderRadius: 12, border: `2px solid ${t.gold}`, overflow: 'hidden' } },
      lens?.image_url
        ? el('img', { src: lens.image_url, width: imgW, height: imgH, style: { width: imgW, height: imgH, objectFit: 'cover' } })
        : fallbackPitchImg(imgW, imgH),
      text(10, imgH - 28, 100, 22, 'AI 示意画面', { position: 'absolute', color: '#FFFFFF', background: 'rgba(0,0,0,0.5)', fontSize: 12, fontWeight: 900, padding: '3px 7px', borderRadius: 6, alignItems: 'center' }),
    ),
    lensBadge(16, textTop),
    text(16, textTop + 36, width - 32, 28, title, { fontSize: 23, fontWeight: 900, lineHeight: 1.14, alignItems: 'center' }),
    ...captionLines.map((line, i) => text(16, textTop + 68 + i * 24, width - 32, 22, line, { color: t.muted, fontSize: 16, lineHeight: 1.26 })),
  );
}

function lensBadge(left: number, top: number) {
  return el('div', {
    style: { display: 'flex', position: 'absolute', left, top, height: 30, background: t.accentDim, border: `1px solid ${t.gold}`, borderRadius: 8, alignItems: 'center', padding: '0 12px' },
  },
    el('div', { style: { display: 'flex', width: 8, height: 8, borderRadius: 8, background: t.gold, marginRight: 8 } }),
    el('div', { style: { display: 'flex', color: t.gold, fontSize: 16, fontWeight: 900, letterSpacing: 1 } }, '代表镜头'),
  );
}

/**
 * 胜负关键单条:序号徽 + 标题(单行裁净) + evidence(2 行,~96 字完整可读,>96 字末行省略)。
 * F67e 回归意图保留:evidence 走 2 行不断半字。
 */
function reasonBox(left: number, top: number, index: number, title: string, evidence: string) {
  const evLines = splitTextLines(evidence, 48, 2);
  const accents = [t.accent, t.accent2, t.gold];
  const c = accents[(index - 1) % accents.length];
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width: CW, height: 66,
      background: t.panel, border: `1px solid ${t.line}`, borderRadius: 14,
      borderLeft: `4px solid ${c}`,
    },
  },
    el('div', { style: { display: 'flex', position: 'absolute', left: 16, top: 13, width: 32, height: 32, borderRadius: 16, background: c, alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { display: 'flex', color: '#04110A', fontSize: 17, fontWeight: 900 } }, String(index)),
    ),
    text(62, 8, 884, 24, clampLine(title, 36), { fontSize: 20, fontWeight: 900, alignItems: 'center', height: 24 }),
    ...evLines.map((line, i) => text(62, 35 + i * 18, 888, 18, line, { color: t.muted, fontSize: 15, lineHeight: 1.22 })),
  );
}

/** 数据块:label + 大数值 + note,半透明卡片。 */
function dataBox(left: number, top: number, label: string, value: string, note: string) {
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width: 230, height: 66,
      background: t.panel2, border: `1px solid ${t.lineSoft}`, borderRadius: 12,
    },
  },
    text(14, 10, 100, 18, clampLine(label, 8), { color: t.accent2, fontSize: 15, fontWeight: 800, alignItems: 'center', height: 18 }),
    text(14, 30, 130, 28, clampLine(value, 9), { fontSize: 25, fontWeight: 900, alignItems: 'center', height: 28 }),
    // 注释占右侧 80px 窄列：单行只放得下 6 字会拦腰切断长注释(用户报修「只显示一半」),改 2 行铺满盒高。
    ...splitTextLines(note, 6, 2).map((line, i) =>
      text(146, 26 + i * 16, 80, 16, line, { color: t.faint, fontSize: 12, lineHeight: 1.15 })),
  );
}

/** 时间线行:节点圆点 + 标签 + 文本。 */
function timelineRow(left: number, top: number, minute: string, textValue: string) {
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width: 464, height: 46,
      alignItems: 'center',
    },
  },
    el('div', { style: { display: 'flex', width: 12, height: 12, borderRadius: 12, background: t.gold, marginRight: 14, marginLeft: 4 } }),
    el('div', { style: { display: 'flex', flexDirection: 'column' } },
      el('div', { style: { display: 'flex', color: t.gold, fontSize: 14, fontWeight: 900 } }, clampLine(minute, 16)),
      el('div', { style: { display: 'flex', color: t.text, fontSize: 17, fontWeight: 700, marginTop: 2 } }, clampLine(textValue, 22)),
    ),
  );
}

function sectionLabel(left: number, top: number, value: string, color: string) {
  return el('div', { style: { display: 'flex', position: 'absolute', left, top, alignItems: 'center', height: 24 } },
    el('div', { style: { display: 'flex', width: 6, height: 20, borderRadius: 3, background: color, marginRight: 12 } }),
    el('div', { style: { display: 'flex', color, fontSize: 19, fontWeight: 900, letterSpacing: 3 } }, value),
  );
}

function text(left: number, top: number, width: number, height: number, value: string, style: Record<string, unknown> = {}) {
  return el('div', {
    style: {
      display: 'flex', position: 'absolute', left, top, width, height, overflow: 'hidden', ...style,
    },
  }, value);
}

function textLines(left: number, top: number, width: number, fit: ReturnType<typeof fitText>, style: Record<string, unknown> = {}) {
  return fit.lines.map((line, i) => text(left, top + i * fit.lineHeightPx, width, fit.lineHeightPx, line, {
    fontSize: fit.fontSize,
    lineHeight: fit.lineHeight,
    ...style,
  }));
}

/** 镜头缺图兜底:简易球门草坪示意,与配图同尺寸。 */
function fallbackPitchImg(width: number, height: number) {
  return el('div', { style: { display: 'flex', width, height, position: 'relative', background: `linear-gradient(135deg, ${t.pitch} 0%, ${t.pitch2} 100%)` } },
    el('div', { style: { display: 'flex', position: 'absolute', left: width * 0.18, top: height * 0.16, width: width * 0.64, height: height * 0.68, border: `2px solid ${t.pitchLine}` } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: width / 2 - 1, top: height * 0.16, width: 2, height: height * 0.68, background: t.pitchLine } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: width / 2 - 26, top: height / 2 - 26, width: 52, height: 52, borderRadius: 52, border: `2px solid ${t.pitchLine}` } }),
  );
}
