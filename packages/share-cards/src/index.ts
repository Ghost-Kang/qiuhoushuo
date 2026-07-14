export { renderCard, TEMPLATES, qrOverlayAllowed } from './render.js';
export { FONTS } from './fonts.js'; // 老李 reel 字幕/水印 PNG 复用同字体(satori→resvg·绕系统 fontconfig)
export { TOKENS } from './tokens.js';
export { SIZES, BRACKET_SIZE } from './sizes.js';
export { translateTeam, teamFlagCode } from './teams.js';
export { parseFormation, formationDots } from './formation.js';
export type { FormationDot } from './formation.js';
export type { CardPayload, Platform, RenderOptions, Style, BracketMatch } from './types.js';
