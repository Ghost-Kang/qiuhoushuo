import type { CardPayload } from '../types.js';
import { el, flagImg } from '../el.js';
import { highlightMomentBlock } from '../highlight.js';
import { fitText } from '../text-fit.js';
import { type CardTheme, stackLines, heroFallbackText } from './wechat-layout.js';

/** 对比数据条:label 居中,主/客两侧数值 + 占比底条(谁大谁亮 accent)。小红书爱"数据可视化"。 */
function compareBar(label: string, home: number, away: number, homeStr: string, awayStr: string, t: CardTheme) {
  const total = home + away || 1;
  const homePct = Math.round((home / total) * 100);
  const homeBig = home >= away;
  return el('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 16 } },
    el('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 } },
      el('div', { style: { display: 'flex', fontSize: 26, fontWeight: 900, color: homeBig ? t.accent : t.text } }, homeStr),
      el('div', { style: { display: 'flex', fontSize: 19, fontWeight: 700, color: t.textMuted, letterSpacing: 2 } }, label),
      el('div', { style: { display: 'flex', fontSize: 26, fontWeight: 900, color: !homeBig ? t.accent : t.text } }, awayStr),
    ),
    el('div', { style: { display: 'flex', flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', background: t.divider } },
      el('div', { style: { display: 'flex', width: `${homePct}%`, height: 8, background: homeBig ? t.accent : t.textMuted } }),
      el('div', { style: { display: 'flex', flex: 1, height: 8, background: !homeBig ? t.accent : t.textMuted } }),
    ),
  );
}

/**
 * 小红书 3:4(1080×1440)统一版面 —— 攻略式信息图,为"收藏"而设计。
 * 比分主视觉 + 金句 + 真实镜头大图 + 全量数据可视化对比 + 站外纯文字引流(无码)。
 * 三风格(hardcore/duanzi/emotion)只换 theme。
 */
export function xhsLayout(d: CardPayload, t: CardTheme) {
  const homeWin = (d.homeScore ?? 0) > (d.awayScore ?? 0);
  const awayWin = (d.awayScore ?? 0) > (d.homeScore ?? 0);
  const title = fitText(d.title || d.shareQuote, '巴西用效率拆开了传控', { fontSize: 48, charsPerLine: 17, lineHeight: 1.18, maxLines: 2 }, [
    { minLength: 30, fontSize: 40, charsPerLine: 21, lineHeight: 1.2 },
  ]);
  const quote = fitText(d.shareQuote || d.subtitle || '', '比分公平，叙事不公平。', { fontSize: 28, charsPerLine: 26, lineHeight: 1.3, maxLines: 2 }, [
    { minLength: 42, fontSize: 24, charsPerLine: 31, lineHeight: 1.3 },
  ]);
  const lensPalette = { accent: t.accent, surface: t.surface, text: t.text, textMuted: t.textMuted, divider: t.divider };
  const hero = highlightMomentBlock(d, lensPalette, false) ?? heroFallbackText(d, t);

  // 数据对比(缺则不显该项)
  const bars: Array<() => ReturnType<typeof compareBar>> = [];
  if (d.homePoss != null && d.awayPoss != null) bars.push(() => compareBar('控球率', d.homePoss!, d.awayPoss!, `${d.homePoss}%`, `${d.awayPoss}%`, t));
  if (d.homeShots != null && d.awayShots != null) bars.push(() => compareBar('射门', d.homeShots!, d.awayShots!, String(d.homeShots), String(d.awayShots), t));
  if (d.homeShotsOn != null && d.awayShotsOn != null) bars.push(() => compareBar('射正', d.homeShotsOn!, d.awayShotsOn!, String(d.homeShotsOn), String(d.awayShotsOn), t));
  if (d.homeXG && d.awayXG) bars.push(() => compareBar('xG 预期进球', Number(d.homeXG) || 0, Number(d.awayXG) || 0, d.homeXG!, d.awayXG!, t));

  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: t.bg, padding: 56, fontFamily: t.fontFamily, color: t.text,
    },
  },
    // 顶栏
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 } },
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        el('div', { style: { display: 'flex', background: t.accent, borderRadius: 12, padding: '7px 14px' } },
          el('div', { style: { display: 'flex', color: t.bg, fontSize: 22, fontWeight: 900, letterSpacing: 1 } }, '赛后必看'),
        ),
        el('div', { style: { display: 'flex', color: t.textMuted, fontSize: 21, marginLeft: 16 } }, d.competition || '国际大赛'),
      ),
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        d.date ? el('div', { style: { display: 'flex', color: t.textMuted, fontSize: 20, marginRight: 14 } }, d.date) : null,
        el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', border: `2px solid ${t.accent}`, borderRadius: 14, padding: '4px 11px' } },
          el('div', { style: { display: 'flex', width: 8, height: 8, borderRadius: 8, background: t.accent, marginRight: 6 } }),
          el('div', { style: { display: 'flex', color: t.accent, fontSize: 16, fontWeight: 900 } }, 'AI 生成'),
        ),
      ),
    ),

    // 比分主视觉
    el('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 18, padding: '24px 36px', marginBottom: 24 } },
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 220 } },
        el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
          el('div', { style: { display: 'flex', fontSize: 32, fontWeight: 800, color: homeWin ? t.accent : t.text } }, d.homeTeam || '主队'),
          flagImg(d.homeFlagUrl, 28),
        ),
      ),
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        el('div', { style: { display: 'flex', fontSize: 96, fontWeight: 900, lineHeight: 1, color: homeWin ? t.accent : t.text } }, String(d.homeScore ?? '—')),
        el('div', { style: { display: 'flex', fontSize: 54, fontWeight: 700, color: t.textMuted, margin: '0 18px' } }, ':'),
        el('div', { style: { display: 'flex', fontSize: 96, fontWeight: 900, lineHeight: 1, color: awayWin ? t.accent : t.text } }, String(d.awayScore ?? '—')),
      ),
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 220 } },
        el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
          el('div', { style: { display: 'flex', fontSize: 32, fontWeight: 800, color: awayWin ? t.accent : t.text } }, d.awayTeam || '客队'),
          flagImg(d.awayFlagUrl, 28),
        ),
      ),
    ),

    // 标题 + 金句
    el('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 18 } },
      ...stackLines(title, { fontWeight: 900, color: t.text }),
      el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 6 } },
        ...stackLines(quote, { fontWeight: 800, color: t.accent }),
      ),
    ),

    // 关键镜头大图(缺图退球场示意;无 moment 整块消失)
    hero,

    // 数据对比可视化
    bars.length ? el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 14 } },
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 14 } },
        el('div', { style: { display: 'flex', width: 6, height: 22, background: t.accent, marginRight: 12 } }),
        el('div', { style: { display: 'flex', fontSize: 22, fontWeight: 900, color: t.text, letterSpacing: 2 } }, '数据对比'),
      ),
      ...bars.map((b) => b()),
    ) : null,

    el('div', { style: { display: 'flex', flex: 1 } }),

    // 站外引流(无码!)+ AI 合规
    el('div', { style: { display: 'flex', flexDirection: 'column', paddingTop: 18, borderTop: `1px solid ${t.divider}` } },
      el('div', { style: { display: 'flex', fontSize: 23, fontWeight: 900, color: t.text, marginBottom: 6 } }, '看完整数据榜单 · 微信搜小程序「超帧球后说」'),
      el('div', { style: { display: 'flex', fontSize: 20, fontWeight: 600, color: t.accent, marginBottom: 12 } }, '深度图文复盘 · 关注同名公众号 每场都有'),
      el('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between' } },
        el('div', { style: { display: 'flex', fontSize: 15, color: t.textMuted } }, 'AI 生成内容，基于可用事实整理'),
        el('div', { style: { display: 'flex', fontSize: 15, color: t.textMuted } }, d.brand || '超帧球后说 · AI 生成'),
      ),
    ),
  );
}
