import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { renderCard } from '../dist/index.js';
import hardcore from '../test/fixtures/hardcore.json' with { type: 'json' };
import duanzi from '../test/fixtures/duanzi.json' with { type: 'json' };
import emotion from '../test/fixtures/emotion.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const variants = { hardcore, duanzi, emotion };
const platforms = ['wechat', 'xhs', 'x'];
const outDir = join(__dirname, '..', 'output');
mkdirSync(outDir, { recursive: true });

for (const [style, data] of Object.entries(variants)) {
  for (const platform of platforms) {
    const png = await renderCard(style, platform, data);
    const filename = `${style}-${platform}.png`;
    writeFileSync(join(outDir, filename), png);
    console.log(`✓ ${filename} (${png.length} bytes)`);
  }
}
