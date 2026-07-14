/**
 * 赛事商标禁词扫描
 *
 * Stage 4 Reality Checker 发现旧 templates.js 在三处硬编码官方赛事名称，
 * 触发 R-4 合规红线。本脚本应当在 CI 中跑：
 *
 *   pnpm tsx scripts/check-trademark.ts
 *
 * 任一文件命中禁词即 exit 1，阻断部署。
 *
 * 豁免机制（按粒度由小到大）：
 * 1. 行级豁免：行尾包含 "trademark-allowed" 注释的代码行跳过
 *    用途：safety.ts 黑名单常量、share-cards.ts 正则清洗器
 * 2. 文件级豁免：SKIP_FILES 列表中的文件整体跳过
 *    用途：本脚本自身、文档类文件
 *
 * 行级豁免必须明确,reviewer 必须能在 PR diff 中一眼看到。
 * 不允许用任何形式的字符串拼接 / charCode 混淆来绕过扫描。
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { TRADEMARK_FORBIDDEN_TERMS } from '../lib/trademark-policy';

const REPO_ROOT = process.cwd().endsWith('/web')
  ? join(process.cwd(), '..')
  : process.cwd();

const SCAN_DIRS = ['web', 'miniprogram', 'share-cards', 'packages'];
const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.wxml', '.wxss', '.json'];

const SKIP_FILES = [
  'check-trademark.ts',
  '_产品方案_v2.3.txt',
  'STAGE_01_DISCOVERY.md',
  'STAGE_02_STRATEGY.md',
  'STAGE_04_REALITY_CHECK.md',
  'STAGE_05_DELIVERY.md',
  'AI_Prompt设计文档_v1.md',
  'README.md',
];

// 行级豁免标记。代码行尾出现此 marker 即跳过该行扫描。
// 用于 safety.ts 黑名单常量、share-cards.ts 正则清洗器等"物理上必须包含禁词"的位置。
const LINE_ALLOW_MARKER = 'trademark-allowed';

interface Hit {
  file: string;
  line: number;
  word: string;
  preview: string;
}

// 目录级豁免：路径含以下片段的整个子树跳过扫描
// 用途：evals/runs/ 是 LLM 真实输出快照，含禁词是 evals 自检的预期数据，
//      由 run-evals.ts 内 TRADEMARK_REGEX 已经标 trademark_clean=false 捕获。
const SKIP_DIR_FRAGMENTS = ['evals/runs'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'output' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (SKIP_DIR_FRAGMENTS.some((frag) => full.includes(frag))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXTS.includes(extname(name)) && !SKIP_FILES.includes(name)) out.push(full);
  }
  return out;
}

const hits: Hit[] = [];
for (const sub of SCAN_DIRS) {
  const dir = join(REPO_ROOT, sub);
  try {
    const files = walk(dir);
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // 行级豁免：含 trademark-allowed 标记的行整行跳过
        if (line.includes(LINE_ALLOW_MARKER)) return;
        for (const w of TRADEMARK_FORBIDDEN_TERMS) {
          if (line.includes(w)) {
            hits.push({ file: f.replace(REPO_ROOT + '/', ''), line: i + 1, word: w, preview: line.trim().slice(0, 120) });
          }
        }
      });
    }
  } catch (err) {
    console.warn(`[check-trademark] skip ${sub}: ${(err as Error).message}`);
  }
}

if (hits.length === 0) {
  console.log('✓ 商标禁词扫描通过（0 命中）');
  process.exit(0);
}

console.error('✗ 商标禁词命中：');
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  [${h.word}]  ${h.preview}`);
}
console.error(`\n${hits.length} 处违规。这些会触发微信平台投诉模型 → 小程序冻结。请彻底替换。`);
process.exit(1);
