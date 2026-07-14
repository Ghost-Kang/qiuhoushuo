import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xLayout } from './x-layout.js';

/** hardcore · 微博/X 16:9 —— 统一双栏版面换 hardcore 皮肤。 */
export function hardcoreX(d: CardPayload) {
  return xLayout(d, TOKENS.hardcore);
}
