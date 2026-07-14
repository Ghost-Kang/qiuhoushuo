#!/usr/bin/env tsx
/**
 * CI guard for loose explicit annotations.
 *
 * Pure Node implementation: CI runners do not need ripgrep or any other
 * system binary for this gate to work.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOTS = ['lib', 'app', 'evals', 'scripts', 'test'];
const ALLOWED: string[] = [];
const PATTERN = /:\s*any\b(?!\w)|:\s*any\[\]/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export interface ScanNoAnyOptions {
  cwd: string;
  roots: string[];
  allowed?: string[];
}

export function scanForAnyAnnotations(opts: ScanNoAnyOptions): string[] {
  const allowed = opts.allowed ?? [];
  const hits: string[] = [];

  for (const root of opts.roots) {
    const abs = resolve(opts.cwd, root);
    let files: string[];
    try {
      files = walk(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }

    for (const file of files) {
      if (resolve(file) === resolve(SCRIPT_PATH)) continue;
      const rel = relative(opts.cwd, file).replaceAll('\\', '/');
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!PATTERN.test(stripStringsAndComments(line))) return;
        const formatted = `${rel}:${idx + 1}:${line.trim()}`;
        if (!allowed.some((entry) => formatted.startsWith(entry))) hits.push(formatted);
      });
    }
  }

  return hits;
}

function stripStringsAndComments(line: string): string {
  return line.replace(
    /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\*.*?\*\/|\/\/.*$/g,
    '',
  );
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

function defaultCwd() {
  return resolve(dirname(SCRIPT_PATH), '..');
}

function runCli() {
  const hits = scanForAnyAnnotations({ cwd: defaultCwd(), roots: ROOTS, allowed: ALLOWED });
  if (hits.length > 0) {
    console.error('[check:no-any] found loose explicit annotations:');
    hits.forEach((line) => console.error(`  ${line}`));
    console.error(`\n${hits.length} hit(s). Replace each with a concrete local type.`);
    process.exit(1);
  }

  console.log(`[check:no-any] 0 hits (scanned ${ROOTS.join(', ')})`);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
