#!/usr/bin/env tsx
/**
 * PROCESS §3.7 派单分派状态护栏 — 自动巡检脚本
 *
 * 用法：
 *   pnpm audit:dispatch TASK-45              # 默认看最近 720 min（12h）修改
 *   pnpm audit:dispatch TASK-45 --mins=120   # 看最近 2h 修改
 *
 * 输出 3 项实测信号（对应 PROCESS §3.7 §"手动核 checklist"）：
 *   1. §4.1 Codex 执行记录是否仍 placeholder（5 项中第 1 项）
 *   2. 最近 N 分钟 .ts/.tsx 修改清单（5 项中第 5 项）
 *   3. 提示手动核剩余 3 项（测试数 / 关键 diff / mtime）
 *
 * exit code：
 *   - 0：§4.1 至少 1 项已填 + 至少 1 个最近修改文件
 *   - 1：§4.1 全空 placeholder 或 0 个最近修改 → "可能未实施"信号
 *   - 2：参数错误 / TASK 文件未找到
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.pnpm-store',
  'coverage',
  '.git',
  '.codex-tmp',
]);

export interface AuditResult {
  taskId: string;
  taskFile: string;
  section41: { filled: number; total: number };
  recentFiles: string[];
  verdict: 'likely_implemented' | 'possibly_unimplemented' | 'no_section_41';
}

export interface AuditOptions {
  /** 派单号，如 'TASK-45' */
  taskId: string;
  /** 最近修改窗口（分钟），默认 720（12h） */
  ageMins?: number;
  /** 仓库根目录（测试用） */
  repoRoot?: string;
}

export function auditTaskDispatch(opts: AuditOptions): AuditResult {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const ageMins = opts.ageMins ?? 720;
  const taskFile = findTaskFile(repoRoot, opts.taskId);
  const section41 = analyzeSection41(taskFile);
  const recentFiles = findRecentTsFiles(repoRoot, ageMins);

  let verdict: AuditResult['verdict'];
  if (section41.total === 0) {
    verdict = 'no_section_41';
  } else if (section41.filled < section41.total) {
    // partial 填写也算 possibly_unimplemented（进行中或漏填）
    verdict = 'possibly_unimplemented';
  } else if (recentFiles.length === 0) {
    verdict = 'possibly_unimplemented';
  } else {
    verdict = 'likely_implemented';
  }

  return {
    taskId: opts.taskId,
    taskFile: relative(repoRoot, taskFile),
    section41,
    recentFiles,
    verdict,
  };
}

function findTaskFile(repoRoot: string, taskId: string): string {
  const dir = join(repoRoot, 'tasks');
  const files = readdirSync(dir);
  const prefix = `${taskId}-`;
  const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.md'));
  if (!match) {
    throw new Error(`[audit] no task file matching ${prefix}*.md in ${relative(repoRoot, dir)}`);
  }
  return join(dir, match);
}

/**
 * 提取 §4.1 段 + 计数 placeholder vs 已填项。
 *
 * placeholder 判定：行匹配 `- **HXX**:` / `- HXX：` / `- xxx：` 且冒号后内容长度 ≤ 5（仅空白 / 短词）。
 */
function analyzeSection41(taskFile: string): { filled: number; total: number } {
  const content = readFileSync(taskFile, 'utf8');
  const lines = content.split('\n');
  let in41 = false;
  let total = 0;
  let filled = 0;
  for (const line of lines) {
    if (/^###\s+4\.1\b/.test(line)) {
      in41 = true;
      continue;
    }
    if (in41 && /^(###\s|##\s|---\s*$)/.test(line)) {
      // 段结束
      break;
    }
    if (!in41) continue;
    // 宽松 ToDo 行匹配：`- 任意标签[:：] 任意 rest`；lazy `.+?` 抓最短到第一个冒号
    const match = line.match(/^-\s+(.+?)\s*[:：]\s*(.*)$/);
    if (!match) continue;
    total += 1;
    const rest = (match[2] ?? '').trim();
    // 判定：冒号后非空白即认为已填；纯空白 = placeholder
    if (rest.length > 0) filled += 1;
  }
  return { filled, total };
}

function findRecentTsFiles(repoRoot: string, ageMins: number): string[] {
  const cutoff = Date.now() - ageMins * 60_000;
  const results: string[] = [];
  walk(repoRoot, repoRoot, cutoff, results);
  results.sort();
  return results;
}

function walk(rootDir: string, dir: string, cutoff: number, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(rootDir, full, cutoff, acc);
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && st.mtimeMs > cutoff) {
      acc.push(relative(rootDir, full));
    }
  }
}

export function formatReport(r: AuditResult, ageMins: number): string {
  const out: string[] = [];
  out.push(`== ${r.taskId} 派单分派状态实测（PROCESS §3.7）==`);
  out.push(`派单文件: ${r.taskFile}`);
  out.push('');
  out.push(`1. §4.1 执行记录: ${r.section41.filled}/${r.section41.total} 项已填`);
  if (r.section41.total === 0) {
    out.push('   ℹ️  未找到结构化 §4.1 ToDo（可能不是标准派单模板）');
  } else if (r.section41.filled === 0) {
    out.push('   ❌ 全部为 placeholder — 大概率未实施');
  } else if (r.section41.filled < r.section41.total) {
    out.push('   ⚠️ 部分填写 — 可能进行中');
  } else {
    out.push('   ✅ 全部填写');
  }
  out.push('');
  out.push(`2. 最近 ${ageMins} 分钟内 .ts/.tsx 修改清单: ${r.recentFiles.length} 文件`);
  if (r.recentFiles.length === 0) {
    out.push('   ❌ 0 修改 — 可能未实施');
  } else {
    r.recentFiles.slice(0, 20).forEach((f) => out.push(`   - ${f}`));
    if (r.recentFiles.length > 20) out.push(`   ... (+${r.recentFiles.length - 20} more)`);
  }
  out.push('');
  out.push('3. 剩余 3 项需 manual 核（PROCESS §3.7 §"手动核 checklist"）:');
  out.push('   - grep "<派单 §2 关键字符串>" web/ --include="*.ts"   # 关键 diff');
  out.push('   - pnpm vitest run | tail -5                        # 测试数对照 spec');
  out.push('   - stat -f "%Sm %N" <派单 §2 文件清单>                # mtime 验证');
  out.push('');
  out.push(`verdict: ${r.verdict}`);
  return out.join('\n');
}

function parseArgs(argv: string[]): { taskId: string; ageMins: number } | null {
  const args = argv.slice(2);
  let taskId: string | null = null;
  let ageMins = 720;
  for (const a of args) {
    if (/^TASK-\d+$/.test(a)) taskId = a;
    else if (a.startsWith('--mins=')) {
      const n = Number(a.slice(7));
      if (Number.isFinite(n) && n > 0) ageMins = n;
    }
  }
  if (!taskId) return null;
  return { taskId, ageMins };
}

function runCli(): void {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error('Usage: pnpm audit:dispatch TASK-NN [--mins=N]');
    process.exit(2);
  }
  let result: AuditResult;
  try {
    result = auditTaskDispatch({ taskId: parsed.taskId, ageMins: parsed.ageMins });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
  console.log(formatReport(result, parsed.ageMins));
  process.exit(result.verdict === 'likely_implemented' ? 0 : 1);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
