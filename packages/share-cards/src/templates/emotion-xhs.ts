import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xhsLayout } from './xhs-layout.js';

/** emotion · 小红书 3:4 —— 统一攻略式信息图换 emotion 皮肤。 */
export function emotionXhs(d: CardPayload) {
  return xhsLayout(d, TOKENS.emotion);
}
