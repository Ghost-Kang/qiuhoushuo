import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { wechatLayout } from './wechat-layout.js';

/** emotion · 微信朋友圈 1:1 —— 统一版面换 emotion 皮肤。 */
export function emotionWechat(d: CardPayload) {
  return wechatLayout(d, TOKENS.emotion);
}
