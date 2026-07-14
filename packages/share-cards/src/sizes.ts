export const SIZES = {
  wechat:    { w: 1080, h: 1080 },  // 微信朋友圈 1:1
  xhs:       { w: 1080, h: 1440 },  // 小红书 3:4
  x:         { w: 1200, h: 675 },   // X / 微博 16:9
} as const;

/** 淘汰赛对阵图:竖长图(新华社双向树),高度固定(结构固定);renderCard 对 bracket style 用此尺寸而非 SIZES[platform]。
 *  ⚠️ h 必须与 templates/bracket.ts 的 BH 常量一致。 */
export const BRACKET_SIZE = { w: 1080, h: 2560 } as const;
