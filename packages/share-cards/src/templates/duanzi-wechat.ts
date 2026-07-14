import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { wechatLayout } from './wechat-layout.js';

/** duanzi · 微信朋友圈 1:1 —— 统一版面换 duanzi 皮肤。 */
export function duanziWechat(d: CardPayload) {
  return wechatLayout(d, TOKENS.duanzi);
}
