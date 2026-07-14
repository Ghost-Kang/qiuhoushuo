import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xhsLayout } from './xhs-layout.js';

/** hardcore · 小红书 3:4 —— 统一攻略式信息图换 hardcore 皮肤。 */
export function hardcoreXhs(d: CardPayload) {
  return xhsLayout(d, TOKENS.hardcore);
}
