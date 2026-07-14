import type { CardPayload } from '../types.js';
import { el, flagImg } from '../el.js';
import { fitText, splitTextLines } from '../text-fit.js';
import { type CardTheme, stackLines } from './wechat-layout.js';

/** 一行数据(label + 主队值 : 客队值),竖排堆在左栏,做"数据权威感"。 */
function statRow(label: string, home: string, away: string, t: CardTheme) {
  return el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 10 } },
    el('div', { style: { display: 'flex', width: 96, fontSize: 18, color: t.textMuted, fontWeight: 700 } }, label),
    el('div', { style: { display: 'flex', fontSize: 22, fontWeight: 900, color: t.text } }, `${home}`),
    el('div', { style: { display: 'flex', fontSize: 18, color: t.textMuted, margin: '0 8px' } }, ':'),
    el('div', { style: { display: 'flex', fontSize: 22, fontWeight: 900, color: t.text } }, `${away}`),
  );
}

/** 一支队:旗 + 队名 + 大比分(本方),竖排。 */
function teamScore(name: string, flagUrl: string | undefined, score: number | undefined, win: boolean, t: CardTheme) {
  return el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 6 } },
    el('div', { style: { display: 'flex', fontSize: 80, fontWeight: 900, lineHeight: 1, width: 96, color: win ? t.accent : t.text } }, String(score ?? '—')),
    el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginLeft: 18 } },
      el('div', { style: { display: 'flex', fontSize: 30, fontWeight: 800, color: win ? t.accent : t.text } }, name),
      flagImg(flagUrl, 26),
    ),
  );
}

/**
 * 微博/X 16:9(1200×675)统一版面 —— 左右双栏,左=事实(比分/数据)、右=观点(金句/镜头)。
 * 缩略图预览只读清"比分+金句",大图看论据。站外:绝不叠码,底栏纯文字引流。
 */
export function xLayout(d: CardPayload, t: CardTheme) {
  const homeWin = (d.homeScore ?? 0) > (d.awayScore ?? 0);
  const awayWin = (d.awayScore ?? 0) > (d.homeScore ?? 0);
  // 右栏可用宽 ~600px:charsPerLine × fontSize 必须 < 600,否则单行放不下被裁/折(金句重叠真因)。
  const quote = fitText(d.shareQuote || d.title, '赢了控球率，输给了想象力。', { fontSize: 40, charsPerLine: 13, lineHeight: 1.25, maxLines: 3 }, [
    { minLength: 27, fontSize: 34, charsPerLine: 16, lineHeight: 1.26 },
    { minLength: 40, fontSize: 29, charsPerLine: 19, lineHeight: 1.28 },
  ]);
  const hook = d.subtitle || (d.highlightMoment?.title ? `${d.highlightMoment.minute || ''} ${d.highlightMoment.title}`.trim() : '');
  const hookLines = hook ? splitTextLines(hook, 26, 2) : [];
  const img = d.highlightMoment?.image_url;

  // 数据行(缺则不显)
  const stats: Array<[string, string, string]> = [];
  if (d.homeXG && d.awayXG) stats.push(['xG', d.homeXG, d.awayXG]);
  if (d.homePoss != null && d.awayPoss != null) stats.push(['控球率', `${d.homePoss}%`, `${d.awayPoss}%`]);
  if (d.homeShots != null && d.awayShots != null) stats.push(['射门', String(d.homeShots), String(d.awayShots)]);

  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: t.bg, padding: '36px 48px', fontFamily: t.fontFamily, color: t.text,
    },
  },
    // 顶栏:赛事·日期 | AI 生成
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 } },
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        el('div', { style: { display: 'flex', width: 5, height: 22, background: t.accent, marginRight: 11 } }),
        el('div', { style: { display: 'flex', color: t.text, fontSize: 20, fontWeight: 700, letterSpacing: 1 } }, d.competition || '国际大赛'),
        d.date ? el('div', { style: { display: 'flex', color: t.textMuted, fontSize: 20, marginLeft: 12 } }, `· ${d.date}`) : null,
      ),
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', border: `2px solid ${t.accent}`, borderRadius: 14, padding: '4px 11px' } },
        el('div', { style: { display: 'flex', width: 8, height: 8, borderRadius: 8, background: t.accent, marginRight: 6 } }),
        el('div', { style: { display: 'flex', color: t.accent, fontSize: 16, fontWeight: 900 } }, 'AI 生成'),
      ),
    ),

    // 主体:左右双栏
    el('div', { style: { display: 'flex', flexDirection: 'row', flex: 1 } },
      // 左栏:事实(比分 + 数据)
      el('div', { style: { display: 'flex', flexDirection: 'column', width: 442, justifyContent: 'center', paddingRight: 28, borderRight: `2px solid ${t.divider}` } },
        teamScore(d.homeTeam || '主队', d.homeFlagUrl, d.homeScore, homeWin, t),
        teamScore(d.awayTeam || '客队', d.awayFlagUrl, d.awayScore, awayWin, t),
        stats.length ? el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 18, paddingTop: 16, borderTop: `1px solid ${t.divider}` } },
          ...stats.map(([l, h, a]) => statRow(l, h, a, t)),
        ) : null,
      ),
      // 右栏:观点(金句 + 镜头 + 钩子)
      el('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, paddingLeft: 32, justifyContent: 'center' } },
        el('div', { style: { display: 'flex', flexDirection: 'column', borderLeft: `5px solid ${t.accent}`, paddingLeft: 20, marginBottom: 16 } },
          ...stackLines(quote, { fontWeight: 900, color: t.text }),
        ),
        img ? el('div', { style: { display: 'flex', width: '100%', height: 150, borderRadius: 10, overflow: 'hidden', border: `2px solid ${t.accent}`, position: 'relative' } },
          el('img', { src: img, width: 614, height: 150, style: { display: 'flex', width: '100%', height: '100%', objectFit: 'cover' } }),
          el('div', { style: { display: 'flex', position: 'absolute', left: 8, bottom: 8, color: '#FFFFFF', fontSize: 13, fontWeight: 900, background: 'rgba(0,0,0,0.5)', padding: '3px 8px' } }, 'AI 示意画面'),
        ) : null,
        hookLines.length ? el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 12 } },
          ...hookLines.map((line) => el('div', { style: { display: 'flex', fontSize: 18, fontWeight: 700, color: t.textMuted, lineHeight: 1.3 } }, line)),
        ) : null,
      ),
    ),

    // 底栏:站外纯文字引流(无码!)+ AI 合规
    el('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${t.divider}` } },
      el('div', { style: { display: 'flex', flexDirection: 'column' } },
        el('div', { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: t.text } }, '完整战报 · 微信小程序「超帧球后说」'),
        el('div', { style: { display: 'flex', fontSize: 17, fontWeight: 500, color: t.textMuted, marginTop: 3 } }, '深度图文 · 关注同名公众号 每场都有'),
      ),
      el('div', { style: { display: 'flex', fontSize: 15, color: t.textMuted } }, 'AI 生成 · 不含预测'),
    ),
  );
}
