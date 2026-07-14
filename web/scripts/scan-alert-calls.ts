#!/usr/bin/env tsx
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const SCAN_ROOTS = ['app', 'lib'];
const SCAN_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'test']);

export type AlertCallSite = {
  file: string;
  line: number;
  kind: 'notifyOpsFireAndForget' | 'voidNotifyOps';
  preview: string;
};

export function scanAlertCallSites(cwd = WEB_ROOT): AlertCallSite[] {
  const sites: AlertCallSite[] = [];
  for (const root of SCAN_ROOTS) walk(join(cwd, root), cwd, sites);
  return sites.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
}

export function formatAlertCallScan(sites: AlertCallSite[]): string {
  const raw = sites.filter((site) => site.kind === 'voidNotifyOps');
  const lines = [
    '== alert call scan ==',
    `total=${sites.length}`,
    `notifyOpsFireAndForget=${sites.length - raw.length}`,
    `void_notifyOps=${raw.length}`,
    '',
  ];
  for (const site of sites) {
    lines.push(`${site.kind === 'voidNotifyOps' ? '[RAW]' : '[OK] '} ${site.file}:${site.line} ${site.preview}`);
  }
  return lines.join('\n');
}

function walk(dir: string, cwd: string, sites: AlertCallSite[]): void {
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
      walk(full, cwd, sites);
    } else if (SCAN_EXTS.has(extname(name)) && !full.endsWith('/lib/alerts.ts')) {
      scanFile(full, cwd, sites);
    }
  }
}

function scanFile(file: string, cwd: string, sites: AlertCallSite[]): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes('notifyOpsFireAndForget(')) {
      sites.push({
        file: relative(cwd, file),
        line: index + 1,
        kind: 'notifyOpsFireAndForget',
        preview: line.trim(),
      });
    }
    if (/void\s+notifyOps\(/.test(line)) {
      sites.push({
        file: relative(cwd, file),
        line: index + 1,
        kind: 'voidNotifyOps',
        preview: line.trim(),
      });
    }
  });
}

function runCli(): void {
  const sites = scanAlertCallSites();
  console.log(formatAlertCallScan(sites));
  process.exit(sites.some((site) => site.kind === 'voidNotifyOps') ? 1 : 0);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
