#!/usr/bin/env tsx
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');

const DEFAULT_ROOTS = ['app', 'lib', 'evals', 'scripts'];
const DEFAULT_FILES = ['middleware.ts', 'instrumentation.ts'];
const SCAN_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'test']);
const SYSTEM_ENV_KEYS = new Set(['NODE_ENV', 'NEXT_RUNTIME']);
const ALLOWED_UNUSED_PREFIXES = [
  'API_FOOTBALL_',
  'DEEPSEEK_',
  'YIDUN_',
  'WX_MERCHANT_',
  'WX_OFFICIAL_',
  'DOUBAO_MODEL_HOST',
  'DOUBAO_MODEL_PREMIUM',
  'SHORT_LINK_DOMAIN',
];

export type EnvDriftResult = {
  exampleKeys: string[];
  usedKeys: string[];
  missingInExample: string[];
  unusedInCode: string[];
};

export type EnvDriftOptions = {
  cwd?: string;
  roots?: string[];
  files?: string[];
};

export function checkEnvDrift(opts: EnvDriftOptions = {}): EnvDriftResult {
  const cwd = opts.cwd ?? WEB_ROOT;
  const envPath = join(cwd, '.env.example');
  const exampleKeys = [...parseEnvKeys(readFileSync(envPath, 'utf8'))].sort();
  const usedKeys = [...scanUsedEnvKeys(cwd, opts.roots ?? DEFAULT_ROOTS, opts.files ?? DEFAULT_FILES)].sort();
  const exampleSet = new Set(exampleKeys);
  const usedSet = new Set(usedKeys);
  const missingInExample = usedKeys.filter((key) => !exampleSet.has(key) && !SYSTEM_ENV_KEYS.has(key));
  const unusedInCode = exampleKeys.filter((key) => !usedSet.has(key) && !isAllowedUnused(key));
  return { exampleKeys, usedKeys, missingInExample, unusedInCode };
}

export function formatEnvDriftReport(result: EnvDriftResult): string {
  const lines = [
    '== env drift check ==',
    `used=${result.usedKeys.length} example=${result.exampleKeys.length}`,
    `missing_in_example=${result.missingInExample.length}`,
    `unused_in_code=${result.unusedInCode.length}`,
    '',
  ];
  if (result.missingInExample.length) {
    lines.push('[FAIL] code reads env keys missing from web/.env.example');
    result.missingInExample.forEach((key) => lines.push(`  - ${key}`));
    lines.push('');
  }
  if (result.unusedInCode.length) {
    lines.push('[WARN] web/.env.example keys not read by scanned runtime code');
    result.unusedInCode.forEach((key) => lines.push(`  - ${key}`));
    lines.push('');
  }
  if (!result.missingInExample.length && !result.unusedInCode.length) {
    lines.push('[PASS] env example and scanned runtime code are aligned');
  }
  return lines.join('\n');
}

function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^([A-Z0-9_]+)=/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function scanUsedEnvKeys(cwd: string, roots: string[], files: string[]): Set<string> {
  const keys = new Set<string>();
  for (const root of roots) walk(join(cwd, root), cwd, keys);
  for (const file of files) scanFile(join(cwd, file), keys);
  return keys;
}

function walk(dir: string, cwd: string, keys: Set<string>): void {
  if (SKIP_DIRS.has(basename(dir))) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, cwd, keys);
    } else if (SCAN_EXTS.has(extname(name))) {
      scanFile(full, keys);
    }
  }
}

function scanFile(file: string, keys: Set<string>): void {
  let content: string;
  try {
    content = stripCommentsAndStrings(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  for (const key of scanEnvKeysFromSource(content)) keys.add(key);
}

/**
 * 从已去注释/字符串的源码里提取被读取的 env key。识别三种形态：
 *   1. 直接：`process.env.X` / `process.env['X']`
 *   2. 解构：`const { A, B } = process.env`
 *   3. 别名：`env: NodeJS.ProcessEnv = process.env` 等绑定后 `env.X` / `env['X']`
 *      —— boot guard / wechat-pay / cos / openid-token 走 `env` 参数别名读取，旧版只认
 *      `process.env.X` 字面会漏看（F48：preflight/CI env.drift 误报 11 个已接 key unused）。
 * 刻意收窄：别名必须在**同一源文件**里实际绑定到 `process.env` 才认；某 key 若全仓任何文件都
 * 不引用，仍会落到 unusedInCode（drift 信号不被掩盖）。`(?<!\.)` 排除 `config.env.X` 误判。
 */
export function scanEnvKeysFromSource(content: string): Set<string> {
  const keys = new Set<string>();

  for (const match of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (match[1]) keys.add(match[1]);
  }
  for (const match of content.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
    if (match[1]) keys.add(match[1]);
  }

  for (const match of content.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    if (!match[1]) continue;
    for (const part of match[1].split(',')) {
      const name = part.split(/[:=]/)[0]?.trim();
      if (name && /^[A-Z0-9_]+$/.test(name)) keys.add(name);
    }
  }

  const aliases = new Set<string>();
  for (const match of content.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*[^=;\n]+?)?=\s*process\.env\b(?![.[])/g)) {
    if (match[1] && match[1] !== 'process') aliases.add(match[1]);
  }
  for (const alias of aliases) {
    const esc = alias.replace(/[$]/g, '\\$&');
    for (const match of content.matchAll(new RegExp(`(?<!\\.)\\b${esc}\\.([A-Z0-9_]+)`, 'g'))) {
      if (match[1]) keys.add(match[1]);
    }
    for (const match of content.matchAll(new RegExp(`(?<!\\.)\\b${esc}\\[['"]([A-Z0-9_]+)['"]\\]`, 'g'))) {
      if (match[1]) keys.add(match[1]);
    }
  }

  return keys;
}

function stripCommentsAndStrings(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/\/\/.*$/gm, '');
}

function isAllowedUnused(key: string): boolean {
  return key.startsWith('FEATURE_FLAG_') || ALLOWED_UNUSED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function runCli(): void {
  const result = checkEnvDrift();
  console.log(formatEnvDriftReport(result));
  process.exit(result.missingInExample.length ? 1 : 0);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
