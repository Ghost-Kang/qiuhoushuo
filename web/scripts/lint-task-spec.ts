#!/usr/bin/env tsx

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');
const TASKS_ROOT = join(REPO_ROOT, 'tasks');

const EXEMPTED = new Set(Array.from({ length: 64 }, (_v, i) => `TASK-${String(i + 1).padStart(2, '0')}`));

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8';
export type CheckResult = { id: CheckId; label: string; ok: boolean; detail: string };
export type FileLintResult = { taskId: string; file: string; exempted: boolean; checks: CheckResult[] };

const LABELS: Record<CheckId, string> = {
  C1: '§1 严重度',
  C2: '§2 H 编号',
  C3: '§3 红线数量',
  C4: '§4.1 实测表',
  C5: '§4.1 反向验证',
  C6: '§4.2 grep',
  C7: '§5 沟通',
  C8: '§6 Trade-off',
};

export function lintTaskSpec(content: string, taskId = 'TASK-XX'): FileLintResult {
  const checks: CheckResult[] = [
    check('C1', /[🟢🟡🔴]/.test(section(content, 1)), 'severity emoji present'),
    check('C2', (content.match(/^###\s+H\d+\b/gm) ?? []).length >= 1, 'at least one H section'),
    check('C3', countRedlines(section(content, 3)) >= 5, `${countRedlines(section(content, 3))} redlines`),
    check('C4', hasSection41Table(content), '§4.1 table with at least 5 rows'),
    check('C5', reverseCount(content) >= 3, `${reverseCount(content)} reverse checks`),
    check('C6', /```bash[\s\S]*(?:rg|grep)[\s\S]*```/.test(section(content, 4)), 'bash grep/rg block in §4'),
    check('C7', /##\s+5\.\s*(沟通|Communication)/i.test(content), '§5 communication section'),
    check('C8', /##\s+6\.\s*(Trade-off|Tradeoff|折中)/i.test(content), '§6 trade-off section'),
  ];
  return { taskId, file: '', exempted: false, checks };
}

function check(id: CheckId, ok: boolean, detail: string): CheckResult {
  return { id, label: LABELS[id], ok, detail };
}

function section(content: string, n: number): string {
  const lines = content.split('\n');
  let inside = false;
  const out: string[] = [];
  const start = new RegExp(`^##\\s+${n}\\.\\s`);
  for (const line of lines) {
    if (start.test(line)) {
      inside = true;
      out.push(line);
      continue;
    }
    if (inside && /^##\s+\d+\.\s/.test(line)) break;
    if (inside) out.push(line);
  }
  return out.join('\n');
}

function countRedlines(s: string): number {
  return (s.match(/\*\*R\d+\*\*|(?:^|\s)R\d+\s*[：:]/gm) ?? []).length;
}

function hasSection41Table(content: string): boolean {
  const s = section(content, 4);
  if (!/###\s+4\.1\b/.test(s)) return false;
  const lines = s.split('\n');
  const headerIdx = lines.findIndex((line) => /\|\s*#\s*\|/.test(line));
  if (headerIdx < 0) return false;
  const tableRows = lines.slice(headerIdx + 2).filter((line) => /^\|/.test(line));
  return tableRows.length >= 5;
}

function reverseCount(content: string): number {
  const s = section(content, 4);
  let tableCount = 0;
  const tableHeader = s.match(/\|\s*#\s*\|[^\n]*反向验证[^\n]*\n\|[^\n]+\|\n([\s\S]*?)(?:\n\n|###|$)/);
  if (tableHeader) {
    tableCount = (tableHeader[1] ?? '').split('\n').filter((line) => /^\|/.test(line) && /反向|临时|删|回滚|未实现|改/.test(line)).length;
  }
  const s44 = s.match(/###\s+4\.4[\s\S]*?(?=\n##\s+5\.|\n###\s+4\.\d+|$)/)?.[0] ?? '';
  const section44Count = (s44.match(/反向|临时|删|回滚/g) ?? []).length;
  return Math.max(tableCount, section44Count);
}

export function lintFiles(opts: {
  tasksRoot?: string;
  file?: string;
  exclude?: string[];
  includeExempt?: boolean;
} = {}): FileLintResult[] {
  const tasksRoot = opts.tasksRoot ?? TASKS_ROOT;
  const exclude = new Set(opts.exclude ?? []);
  const files = opts.file ? [resolveTaskFile(tasksRoot, opts.file)] : readdirSync(tasksRoot).filter((f) => /^TASK-\d+.*\.md$/.test(f)).map((f) => join(tasksRoot, f));
  return files.flatMap((file) => {
    const taskId = taskIdFromFile(file);
    if (exclude.has(taskId)) return [];
    const exempted = EXEMPTED.has(taskId) && !opts.includeExempt && !opts.file;
    const result = lintTaskSpec(readFileSync(file, 'utf8'), taskId);
    return [{ ...result, file, exempted }];
  });
}

function resolveTaskFile(tasksRoot: string, fileOrId: string): string {
  if (existsSync(fileOrId)) return fileOrId;
  const id = fileOrId.startsWith('TASK-') ? fileOrId : `TASK-${fileOrId}`;
  const match = readdirSync(tasksRoot).find((f) => f.startsWith(id) && f.endsWith('.md'));
  if (!match) throw new Error(`no task spec found for ${fileOrId}`);
  return join(tasksRoot, match);
}

function taskIdFromFile(file: string): string {
  const match = file.match(/TASK-\d+/);
  return match?.[0] ?? 'TASK-XX';
}

export function formatLintReport(results: FileLintResult[], strict = false): string {
  const active = results.filter((r) => !r.exempted);
  const pass = active.filter((r) => r.checks.every((c) => c.ok)).length;
  const fail = active.length - pass;
  const out = ['=== Codex Spec Linter ===', strict ? 'mode: strict' : 'mode: normal', ''];
  for (const result of results) {
    if (result.exempted && !strict) continue;
    const ok = result.checks.every((c) => c.ok);
    out.push(`${ok ? '✅' : '❌'} ${result.taskId}${result.exempted ? ' (exempted)' : ''}`);
    for (const checkResult of result.checks) {
      out.push(`   ${checkResult.ok ? '✅' : '❌'} ${checkResult.id} ${checkResult.label}: ${checkResult.detail}`);
    }
  }
  out.push('');
  out.push(`合计 ${pass} ✅ / ${fail} ❌`);
  return out.join('\n');
}

function parseArgs(argv: string[]): { file?: string; strict: boolean; exclude: string[]; includeExempt: boolean } {
  const out = { file: undefined as string | undefined, strict: false, exclude: [] as string[], includeExempt: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--file') out.file = argv[++i] ?? '';
    else if (arg.startsWith('--file=')) out.file = arg.slice(7);
    else if (arg === '--strict') out.strict = true;
    else if (arg === '--include-exempt') out.includeExempt = true;
    else if (arg === '--exclude') out.exclude = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg.startsWith('--exclude=')) out.exclude = arg.slice(10).split(',').filter(Boolean);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const results = lintFiles({ file: args.file, exclude: args.exclude, includeExempt: args.includeExempt || args.strict });
    const active = results.filter((r) => !r.exempted || args.strict);
    const failed = active.some((r) => r.checks.some((c) => !c.ok));
    console.log(formatLintReport(results, args.strict));
    process.exitCode = failed ? 1 : 0;
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 2;
  }
}
