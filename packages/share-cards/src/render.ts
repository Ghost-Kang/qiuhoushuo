import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FONTS } from './fonts.js';
import { SIZES, BRACKET_SIZE } from './sizes.js';
import { MP_QR_DATA_URI } from './mp-qr.js';
import type { CardPayload, Platform, RenderOptions, Style } from './types.js';
import { hardcoreWechat } from './templates/hardcore-wechat.js';
import { hardcoreXhs } from './templates/hardcore-xhs.js';
import { hardcoreX } from './templates/hardcore-x.js';
import { duanziWechat } from './templates/duanzi-wechat.js';
import { duanziXhs } from './templates/duanzi-xhs.js';
import { duanziX } from './templates/duanzi-x.js';
import { emotionWechat } from './templates/emotion-wechat.js';
import { emotionXhs } from './templates/emotion-xhs.js';
import { emotionX } from './templates/emotion-x.js';
import { briefTemplate } from './templates/brief.js';
import { tacticsTemplate } from './templates/tactics.js';
import { playerRatingsTemplate } from './templates/player-ratings.js';
import { scoreboardTemplate } from './templates/scoreboard.js';
import { standingsTemplate } from './templates/standings.js';
import { bracketTemplate } from './templates/bracket.js';
import { ftTemplate } from './templates/ft.js';

type Template = (data: CardPayload) => any;

export const TEMPLATES: Record<Style, Record<Platform, Template>> = {
  hardcore: { wechat: hardcoreWechat, xhs: hardcoreXhs, x: hardcoreX },
  duanzi: { wechat: duanziWechat, xhs: duanziXhs, x: duanziX },
  emotion: { wechat: emotionWechat, xhs: emotionXhs, x: emotionX },
  brief: { wechat: briefTemplate, xhs: briefTemplate, x: briefTemplate },
  tactics: { wechat: tacticsTemplate, xhs: tacticsTemplate, x: tacticsTemplate },
  ratings: { wechat: playerRatingsTemplate, xhs: playerRatingsTemplate, x: playerRatingsTemplate },
  scoreboard: { wechat: scoreboardTemplate, xhs: scoreboardTemplate, x: scoreboardTemplate },
  standings: { wechat: standingsTemplate, xhs: standingsTemplate, x: standingsTemplate },
  bracket: { wechat: bracketTemplate, xhs: bracketTemplate, x: bracketTemplate },
  ft: { wechat: ftTemplate, xhs: ftTemplate, x: ftTemplate },
};

/** 仅微信生态(朋友圈/群)可叠小程序码;站外(小红书/微博)严禁带微信码=限流封号红线。 */
export function qrOverlayAllowed(platform: Platform): boolean {
  return platform === 'wechat';
}

export async function renderCard(style: Style, platform: Platform, data: CardPayload, options: RenderOptions = {}): Promise<Buffer> {
  if ((style === 'brief' || style === 'tactics' || style === 'ratings' || style === 'scoreboard' || style === 'standings' || style === 'bracket' || style === 'ft') && platform !== 'xhs') {
    throw new Error(`${style} cards only support xhs platform`);
  }
  const Template = TEMPLATES[style]?.[platform];
  if (!Template) throw new Error(`Unknown template: ${style}/${platform}`);
  // 缺 stats 时新版三平台 layout 各自逐字段守卫隐藏(homeXG!=null 等),不再需要 _statsHidden 整块旗标。
  const payload = data;
  // 对阵图是竖长图(新华社双向树),用专属高度而非 SIZES[platform]。
  const size = style === 'bracket' ? BRACKET_SIZE : SIZES[platform];
  // withQr:微信内分享卡右下角叠小程序码引流。⚠️ 硬护栏——站外(小红书/微博)严禁带微信码=限流封号红线,
  // 即便调用方传 withQr 也只在 wechat 生效;非 wechat 一律不叠,想带都带不上(双重防线,见 route.ts)。
  const overlayQr = options.withQr === true && qrOverlayAllowed(platform);
  const tree = overlayQr ? withQrOverlay(Template(payload || ({} as CardPayload)), size) : Template(payload || ({} as CardPayload));
  const svg = await satori(tree, {
    width: size.w,
    height: size.h,
    fonts: FONTS,
  });
  const resvg = new Resvg(svg, { background: 'white' });
  return Buffer.from(resvg.render().asPng());
}

/** 把模板根包进同尺寸相对定位容器,右下角绝对定位一张白底小程序码(白底确保深色卡也可扫)。 */
function withQrOverlay(template: any, size: { w: number; h: number }): any {
  const qr = Math.round(size.w * 0.15); // 卡宽 15%,1080→162
  const pad = Math.round(size.w * 0.012);
  const margin = Math.round(size.w * 0.028);
  return {
    type: 'div',
    props: {
      style: { display: 'flex', position: 'relative', width: `${size.w}px`, height: `${size.h}px` },
      children: [
        template,
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute', right: `${margin}px`, bottom: `${margin}px`,
              display: 'flex', padding: `${pad}px`, background: '#ffffff',
              borderRadius: `${pad + 6}px`, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            },
            children: [
              { type: 'img', props: { src: MP_QR_DATA_URI, width: qr, height: qr, style: { width: `${qr}px`, height: `${qr}px`, borderRadius: `${pad}px` } } },
            ],
          },
        },
      ],
    },
  };
}
