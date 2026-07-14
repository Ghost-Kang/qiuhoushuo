import type { CardPayload } from '../types.js';
import { el, flagImg } from '../el.js';
import { highlightMomentBlock } from '../highlight.js';
import { fitText, splitTextLines } from '../text-fit.js';

/** 主题契约(取自 TOKENS[style]);wechat/xhs/x 三平台共用,只换皮肤。 */
export interface CardTheme {
  bg: string;
  surface: string;
  accent: string;
  text: string;
  textMuted: string;
  divider: string;
  fontFamily: string;
}

function logo(url: string | undefined, size: number, t: CardTheme) {
  return url
    ? el('img', { src: url, width: size, height: size, style: { display: 'flex', objectFit: 'contain' } })
    : null;
}

/**
 * 多行文字稳健堆叠:每行一个定高盒(height=lineHeightPx)+ 垂直居中 + 溢出裁剪,**不设 lineHeight 倍数**。
 * 旧写法在定高盒上又叠 lineHeight 倍数,satori 下行盒溢出致下一行骑到上一行(金句"球来便秘了"重叠)。
 * 三平台(wechat/xhs/x)所有多行金句/标题统一走这个,杜绝重叠。
 */
export function stackLines(
  fit: { lines: string[]; fontSize: number; lineHeightPx: number },
  style: Record<string, unknown> = {},
) {
  return fit.lines.map((line) =>
    el('div', {
      style: {
        display: 'flex', height: fit.lineHeightPx, flexShrink: 0, alignItems: 'center', overflow: 'hidden',
        whiteSpace: 'nowrap', fontSize: fit.fontSize, lineHeight: 1, ...style,
      },
    }, line),
  );
}

/**
 * 关键镜头缺图时的兜底:用「本场要点」文字面板(bodyExcerpt 战报首段)填上镜头位,
 * 把空白变成真内容——很多场没有 AI 镜头图,否则竖版卡会大片留白显得空。三平台共用。
 */
export function heroFallbackText(d: CardPayload, t: CardTheme) {
  const raw = (d.bodyExcerpt || d.subtitle || '').trim();
  if (!raw) return null;
  const body = splitTextLines(raw, 26, 4).join(''); // 钳到 ~4 行(satori 在面板内自然折行,这里只控长)
  return el('div', {
    style: {
      display: 'flex', flexDirection: 'column', background: t.surface, border: `1px solid ${t.divider}`,
      borderLeft: `5px solid ${t.accent}`, borderRadius: 14, padding: '22px 26px', marginTop: 10, marginBottom: 10,
    },
  },
    el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 12 } },
      el('div', { style: { display: 'flex', width: 6, height: 18, background: t.accent, marginRight: 10 } }),
      el('div', { style: { display: 'flex', fontSize: 18, fontWeight: 900, color: t.accent, letterSpacing: 2 } }, '本场要点'),
    ),
    el('div', { style: { display: 'flex', fontSize: 25, fontWeight: 500, color: t.text, lineHeight: 1.5 } }, body),
  );
}

/** 站内引流文案(wechat 专用):右下角叠真小程序码(withQrOverlay),底栏文字给"搜什么+服务号"。 */
function drainageFooter(d: CardPayload, t: CardTheme) {
  return el('div', { style: { display: 'flex', flexDirection: 'column', width: 820 } },
    el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 10 } },
      el('div', { style: { display: 'flex', width: 5, height: 26, background: t.accent, marginRight: 12 } }),
      el('div', { style: { display: 'flex', fontSize: 24, fontWeight: 900, color: t.text, letterSpacing: 1 } }, d.brand || '超帧球后说 · AI 生成'),
    ),
    el('div', { style: { display: 'flex', fontSize: 21, fontWeight: 700, color: t.text, marginBottom: 6 } }, '微信搜小程序「超帧球后说」· 看本场完整战报与数据'),
    el('div', { style: { display: 'flex', fontSize: 20, fontWeight: 500, color: t.textMuted } }, '公众号搜「超帧球后说」· 每场深度图文'),
  );
}

/**
 * 微信朋友圈 1:1(1080×1080)统一版面 —— 三风格(hardcore/duanzi/emotion)只换 theme。
 * 设计:做减法、一个钩子打透。金句升为主视觉,真实关键镜头图做 scroll-stopper,
 * 站内可叠小程序码(withQrOverlay 由 render 注入,底栏文字留在左侧 820px 不撞码安全区)。
 */
export function wechatLayout(d: CardPayload, t: CardTheme) {
  const homeWin = (d.homeScore ?? 0) > (d.awayScore ?? 0);
  const awayWin = (d.awayScore ?? 0) > (d.homeScore ?? 0);
  // xG 成对守卫(与 xhs/x 一致):只一侧有 xG 时两侧都不显,避免单边「xG x.x」暗示对方=0(审查 P3-2)
  const showXG = d.homeXG != null && d.awayXG != null;
  const title = fitText(d.shareQuote || d.title, '赢了控球率，输给了想象力。', { fontSize: 46, charsPerLine: 16, lineHeight: 1.22, maxLines: 2 }, [
    { minLength: 30, fontSize: 38, charsPerLine: 20, lineHeight: 1.24 },
    { minLength: 44, fontSize: 34, charsPerLine: 23, lineHeight: 1.26 },
  ]);
  const lensPalette = { accent: t.accent, surface: t.surface, text: t.text, textMuted: t.textMuted, divider: t.divider };
  const hero = highlightMomentBlock(d, lensPalette, false) ?? heroFallbackText(d, t);

  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: t.bg, padding: 48, fontFamily: t.fontFamily, color: t.text,
    },
  },
    // A 顶栏:赛事 · 日期 | AI 生成 角标(合规硬标识)
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        el('div', { style: { display: 'flex', width: 5, height: 24, background: t.accent, marginRight: 12 } }),
        el('div', { style: { display: 'flex', color: t.text, fontSize: 22, fontWeight: 700, letterSpacing: 1 } }, d.competition || '国际大赛'),
        d.date ? el('div', { style: { display: 'flex', color: t.textMuted, fontSize: 22, marginLeft: 14 } }, `· ${d.date}`) : null,
      ),
      el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', border: `2px solid ${t.accent}`, borderRadius: 16, padding: '5px 13px' } },
        el('div', { style: { display: 'flex', width: 9, height: 9, borderRadius: 9, background: t.accent, marginRight: 7 } }),
        el('div', { style: { display: 'flex', color: t.accent, fontSize: 18, fontWeight: 900, letterSpacing: 1 } }, 'AI 生成'),
      ),
    ),
    el('div', { style: { display: 'flex', height: 2, background: t.divider, marginBottom: 26 } }),

    // B 比分主区:队徽/旗 + 巨号比分 + xG
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 } },
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 } },
        logo(d.homeLogoUrl, 88, t),
        el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: d.homeLogoUrl ? 8 : 0, marginBottom: 4 } },
          el('div', { style: { display: 'flex', fontSize: 34, fontWeight: 800, color: homeWin ? t.accent : t.text } }, d.homeTeam || '主队'),
          flagImg(d.homeFlagUrl, 30),
        ),
        showXG ? el('div', { style: { display: 'flex', fontSize: 18, color: t.textMuted } }, `xG ${d.homeXG}`) : null,
      ),
      el('div', { style: { display: 'flex', alignItems: 'center' } },
        el('div', { style: { display: 'flex', fontSize: 100, fontWeight: 900, lineHeight: 1, color: homeWin ? t.accent : t.text } }, String(d.homeScore ?? '—')),
        el('div', { style: { display: 'flex', fontSize: 56, fontWeight: 700, color: t.textMuted, margin: '0 18px' } }, ':'),
        el('div', { style: { display: 'flex', fontSize: 100, fontWeight: 900, lineHeight: 1, color: awayWin ? t.accent : t.text } }, String(d.awayScore ?? '—')),
      ),
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 } },
        logo(d.awayLogoUrl, 88, t),
        el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: d.awayLogoUrl ? 8 : 0, marginBottom: 4 } },
          el('div', { style: { display: 'flex', fontSize: 34, fontWeight: 800, color: awayWin ? t.accent : t.text } }, d.awayTeam || '客队'),
          flagImg(d.awayFlagUrl, 30),
        ),
        showXG ? el('div', { style: { display: 'flex', fontSize: 18, color: t.textMuted } }, `xG ${d.awayXG}`) : null,
      ),
    ),

    // C 金句钩子:升为第一视觉
    el('div', { style: { display: 'flex', flexDirection: 'column', borderLeft: `5px solid ${t.accent}`, paddingLeft: 22, marginBottom: 8 } },
      ...stackLines(title, { fontWeight: 900, color: t.text }),
    ),

    // D 关键镜头(hero 16:9 真图;缺图自动退球场示意;无 moment 整块消失)
    hero,

    // 弹性留白把底栏顶到底
    el('div', { style: { display: 'flex', flex: 1 } }),

    // E 引流底栏(文字留左侧 820px,右下角约 205px 留给 withQrOverlay 注入的真码)
    drainageFooter(d, t),
  );
}
