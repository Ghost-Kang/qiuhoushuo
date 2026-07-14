import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { wechatLayout } from './wechat-layout.js';

/** hardcore · 微信朋友圈 1:1 —— 统一版面换 hardcore 皮肤。 */
export function hardcoreWechat(d: CardPayload) {
  return wechatLayout(d, TOKENS.hardcore);
}
