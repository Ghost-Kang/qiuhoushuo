import type { CardPayload } from './types.js';
import { el } from './el.js';

type HighlightPalette = {
  accent: string;
  surface: string;
  text: string;
  textMuted: string;
  divider?: string;
};

type HighlightMoment = NonNullable<CardPayload['highlightMoment']>;

export function highlightMomentBlock(d: CardPayload, t: HighlightPalette, compact = false) {
  const moment = d.highlightMoment;
  if (!moment?.title) return null;
  return compact ? stripLens(moment, t) : heroLens(moment, t);
}

function stripLens(moment: HighlightMoment, t: HighlightPalette) {
  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 16,
      background: t.surface,
      border: `2px solid ${t.divider || t.accent}`,
      padding: '12px 14px',
      marginTop: 18,
      marginBottom: 18,
    },
  },
    lensVisual(moment, t, { width: 136, height: 96, compact: true }),
    el('div', {
      style: {
        display: 'flex',
        flex: 1,
        minWidth: 0,
        flexDirection: 'column',
        justifyContent: 'center',
      },
    },
      labelRow(moment, t, true),
      el('div', {
        style: {
          display: 'flex',
          fontSize: 22,
          color: t.text,
          fontWeight: 900,
          lineHeight: 1.18,
          marginTop: 6,
        },
      }, moment.title),
      el('div', {
        style: {
          display: 'flex',
          width: 52,
          height: 4,
          background: t.accent,
          marginTop: 10,
        },
      }),
    ),
  );
}

function heroLens(moment: HighlightMoment, t: HighlightPalette) {
  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      background: t.surface,
      border: `2px solid ${t.divider || t.accent}`,
      padding: 16,
      marginTop: 24,
      marginBottom: 24,
    },
  },
    lensVisual(moment, t, { width: '100%', height: 214, compact: false }),
    el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 2px 2px 2px',
      },
    },
      labelRow(moment, t, false),
      el('div', {
        style: {
          display: 'flex',
          fontSize: 30,
          color: t.text,
          fontWeight: 900,
          lineHeight: 1.18,
          marginTop: 8,
        },
      }, moment.title),
      el('div', {
        style: {
          display: 'flex',
          fontSize: 18,
          color: t.textMuted,
          lineHeight: 1.38,
          marginTop: 8,
        },
      }, moment.description || '关键镜头 · 战报画面'),
    ),
  );
}

function labelRow(moment: HighlightMoment, t: HighlightPalette, compact: boolean) {
  const label = moment.minute ? `精彩镜头 · ${moment.minute}` : '精彩镜头';
  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
  },
    el('div', {
      style: {
        display: 'flex',
        background: t.accent,
        color: '#FFFFFF',
        fontSize: compact ? 13 : 15,
        fontWeight: 900,
        padding: compact ? '5px 9px' : '6px 11px',
      },
    }, label),
  );
}

function lensVisual(
  moment: HighlightMoment,
  t: HighlightPalette,
  opts: { width: number | string; height: number; compact: boolean },
) {
  return el('div', {
    style: {
      display: 'flex',
      flexShrink: 0,
      width: opts.width,
      height: opts.height,
      position: 'relative',
      overflow: 'hidden',
      background: `linear-gradient(135deg, ${t.accent}, ${t.surface})`,
      border: `2px solid ${t.accent}`,
    },
  },
    moment.image_url
      ? el('img', {
          src: moment.image_url,
          alt: moment.image_alt || moment.title,
          width: opts.width,
          height: opts.height,
          style: {
            display: 'flex',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          },
        })
      : fallbackPitch(t),
    el('div', {
      style: {
        display: 'flex',
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: opts.compact ? 30 : 58,
        background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.62))',
      },
    }),
    el('div', {
      style: {
        display: 'flex',
        position: 'absolute',
        left: opts.compact ? 8 : 12,
        bottom: opts.compact ? 7 : 12,
        color: '#FFFFFF',
        fontSize: opts.compact ? 11 : 13,
        fontWeight: 900,
        background: 'rgba(0,0,0,0.48)',
        padding: opts.compact ? '3px 6px' : '4px 8px',
      },
    }, 'AI 示意画面'),
  );
}

function fallbackPitch(t: HighlightPalette) {
  return el('div', {
    style: {
      display: 'flex',
      width: '100%',
      height: '100%',
      position: 'relative',
      background: `linear-gradient(135deg, ${t.accent}, ${t.surface})`,
    },
  },
    el('div', { style: { display: 'flex', position: 'absolute', left: 18, right: 18, top: 18, bottom: 18, border: `2px solid ${t.text}`, opacity: 0.38 } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: '50%', top: 18, bottom: 18, width: 2, background: t.text, opacity: 0.24 } }),
    el('div', { style: { display: 'flex', position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, marginLeft: -23, marginTop: -23, borderRadius: 46, border: `2px solid ${t.text}`, opacity: 0.28 } }),
    el('div', { style: { display: 'flex', position: 'absolute', right: 22, bottom: 18, width: 24, height: 24, borderRadius: 24, background: t.text, opacity: 0.72 } }),
  );
}
