import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

// 字体路径用「字面量」require.resolve，确保 Next standalone 的依赖追踪(@vercel/nft)能静态
// 识别并打进产物。原先用模板字符串 `...${weight}...` 时 nft 无法静态求值 → standalone 漏打
// 这些 .woff → 服务器卡片渲染 500「Cannot find module ...woff」(本地有 node_modules 故单测照不到)。
const FONT_400 = require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff');
const FONT_700 = require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff');
const FONT_900 = require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-900-normal.woff');

export const FONTS = [
  { name: 'NotoSansSC', data: readFileSync(FONT_400), weight: 400 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(FONT_700), weight: 700 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(FONT_900), weight: 900 as const, style: 'normal' as const },
];
