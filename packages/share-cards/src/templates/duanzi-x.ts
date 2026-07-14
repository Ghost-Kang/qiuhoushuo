import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xLayout } from './x-layout.js';

/** duanzi · 微博/X 16:9 —— 统一双栏版面换 duanzi 皮肤。 */
export function duanziX(d: CardPayload) {
  return xLayout(d, TOKENS.duanzi);
}
