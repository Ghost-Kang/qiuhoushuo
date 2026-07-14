import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xhsLayout } from './xhs-layout.js';

/** duanzi · 小红书 3:4 —— 统一攻略式信息图换 duanzi 皮肤。 */
export function duanziXhs(d: CardPayload) {
  return xhsLayout(d, TOKENS.duanzi);
}
