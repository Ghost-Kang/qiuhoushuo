import type { CardPayload } from '../types.js';
import { TOKENS } from '../tokens.js';
import { xLayout } from './x-layout.js';

/** emotion · 微博/X 16:9 —— 统一双栏版面换 emotion 皮肤。 */
export function emotionX(d: CardPayload) {
  return xLayout(d, TOKENS.emotion);
}
