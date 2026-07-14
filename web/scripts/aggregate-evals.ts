#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');
const RUNS_DIR = join(WEB_ROOT, 'evals', 'runs');
const REVIEWERS = ['PM', '后端1', '后端2', '内容', '客服'];
const DIMS = ['fact_acc', 'tone_match', 'brand_voice', 'share_vibe'] as const;

type Dimension = (typeof DIMS)[number];
type CsvRow = Record<string, string>;
type EvalScore = {
  reviewer: string;
  fixtureId: string;
  style: string;
  notes: string;
  values: Partial<Record<Dimension, number>>;
};
type AggregateResult = {
  runId: string;
  rows: EvalScore[];
  reviewers: string[];
  dimensionMeans: Record<Dimension, number | null>;
  styleMeans: Record<string, Record<Dimension, number | null>>;
  fixtureMeans: Array<{ fixtureId: string; mean: number | null; notes: string[] }>;
  weightedMean: number | null;
};

export function parseCsv(input: string): CsvRow[] {
  if (!input.trim()) throw new Error('scoresheet.csv is empty');
  const rows = input.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0).map(parseCsvLine);
  const header = rows[0];
  if (!header || header.length < 8) throw new Error('scoresheet.csv header must contain at least 8 columns');
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(`scoresheet.csv row ${index + 2} has ${cells.length} columns, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function aggregateRun(runId: string, opts: { runsDir?: string } = {}): AggregateResult {
  const file = join(opts.runsDir ?? RUNS_DIR, runId, 'scoresheet.csv');
  if (!existsSync(file)) throw new Error(`scoresheet not found: ${file}`);
  const rows = parseCsv(readFileSync(file, 'utf8')).map(toScore);
  return aggregateRows(runId, rows);
}

export function aggregateRows(runId: string, rows: EvalScore[]): AggregateResult {
  const reviewers = [...new Set(rows.filter((r) => hasAnyScore(r)).map((r) => r.reviewer))].sort();
  const dimensionMeans = Object.fromEntries(DIMS.map((dim) => [dim, mean(rows.flatMap((r) => valueList(r.values[dim])))])) as Record<Dimension, number | null>;
  const styles = [...new Set(rows.map((r) => r.style))].sort();
  const styleMeans = Object.fromEntries(styles.map((style) => [
    style,
    Object.fromEntries(DIMS.map((dim) => [dim, mean(rows.filter((r) => r.style === style).flatMap((r) => valueList(r.values[dim])))])),
  ])) as Record<string, Record<Dimension, number | null>>;
  const fixtures = [...new Set(rows.map((r) => r.fixtureId))].sort();
  const fixtureMeans = fixtures.map((fixtureId) => {
    const fixtureRows = rows.filter((r) => r.fixtureId === fixtureId);
    return {
      fixtureId,
      mean: mean(fixtureRows.flatMap((r) => DIMS.flatMap((dim) => valueList(r.values[dim])))),
      notes: fixtureRows.map((r) => r.notes.trim()).filter(Boolean).slice(0, 3),
    };
  });
  return {
    runId,
    rows,
    reviewers,
    dimensionMeans,
    styleMeans,
    fixtureMeans,
    weightedMean: mean(DIMS.flatMap((dim) => valueList(dimensionMeans[dim]))),
  };
}

function toScore(row: CsvRow): EvalScore {
  const fixtureId = row.fixture_id || row.match_id || '';
  if (!fixtureId || !row.style || !row.reviewer) throw new Error('scoresheet.csv rows require reviewer, fixture_id/match_id, and style');
  return {
    reviewer: row.reviewer,
    fixtureId,
    style: row.style,
    notes: row.notes ?? '',
    values: Object.fromEntries(DIMS.map((dim) => [dim, parseScore(row[dim] || row[`${dim}_1to5`])])) as Partial<Record<Dimension, number>>,
  };
}

function parseScore(raw?: string): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function hasAnyScore(row: EvalScore): boolean {
  return DIMS.some((dim) => row.values[dim] != null);
}

function valueList(value: number | null | undefined): number[] {
  return value == null ? [] : [value];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
}

export function formatAggregate(result: AggregateResult): string {
  const out: string[] = [];
  out.push(`# EVALS 聚合结果 · ${result.runId}`);
  out.push('');
  out.push(`**评审完成数**：${result.reviewers.length}/${REVIEWERS.length} 评审员（${REVIEWERS.join(' / ')}）`);
  if (result.reviewers.length < REVIEWERS.length) out.push(`**Warning**：仅 ${result.reviewers.length}/${REVIEWERS.length} 评审员有有效评分，当前均值按已填数据计算。`);
  out.push(`**用例总数**：${new Set(result.rows.map((r) => `${r.fixtureId}:${r.style}`)).size}（fixtures × styles）`);
  out.push('**评分维度均值**：');
  out.push('');
  out.push('| 维度 | 均值 | 决策 |');
  out.push('|---|---:|---|');
  for (const dim of DIMS) out.push(`| ${dim} | ${fmt(result.dimensionMeans[dim])} | ${decision(result.dimensionMeans[dim])} |`);
  out.push(`| **加权平均** | **${fmt(result.weightedMean)}** | ${overallDecision(result.weightedMean)} |`);
  out.push('');
  out.push('## 风格细分（style × 维度）');
  out.push('');
  out.push('| Style | fact_acc | tone_match | brand_voice | share_vibe |');
  out.push('|---|---:|---:|---:|---:|');
  for (const [style, means] of Object.entries(result.styleMeans)) {
    out.push(`| ${style} | ${fmt(means.fact_acc)} | ${fmt(means.tone_match)} | ${fmt(means.brand_voice)} | ${fmt(means.share_vibe)} |`);
  }
  out.push('');
  out.push('## Fixture 细分（fixture × 加权均值）');
  out.push('');
  out.push('| Fixture | 加权均值 | 评审 notes 摘录 |');
  out.push('|---|---:|---|');
  for (const fixture of result.fixtureMeans) {
    out.push(`| ${fixture.fixtureId} | ${fmt(fixture.mean)} | ${fixture.notes.map((n) => `"${n}"`).join('<br>')} |`);
  }
  out.push('');
  out.push('## 决策门槛');
  out.push('');
  out.push('- ≥ 3.5 GREEN → v1 上线');
  out.push('- 3.0-3.5 YELLOW → v1 上线 + 标薄弱');
  out.push('- < 3.0 RED → 触发 TASK-25 prompts v1.1');
  return out.join('\n');
}

export function formatCompare(left: AggregateResult, right: AggregateResult): string {
  const out: string[] = [];
  out.push(`# EVALS 对比 · ${left.runId} vs ${right.runId}`);
  out.push('');
  out.push('| 维度 | ' + left.runId + ' | ' + right.runId + ' | Δ |');
  out.push('|---|---:|---:|---:|');
  for (const dim of DIMS) out.push(compareRow(dim, left.dimensionMeans[dim], right.dimensionMeans[dim]));
  out.push(compareRow('加权平均', left.weightedMean, right.weightedMean));
  return out.join('\n');
}

function compareRow(label: string, a: number | null, b: number | null): string {
  const delta = a == null || b == null ? null : a - b;
  return `| ${label} | ${fmt(a)} | ${fmt(b)} | ${delta == null ? 'n/a' : fmt(delta)} |`;
}

function fmt(value: number | null): string {
  return value == null ? 'n/a' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

function decision(value: number | null): string {
  if (value == null) return '⚪ n/a';
  if (value >= 3.5) return '✅ ≥ 3.5 GREEN';
  if (value >= 3.0) return '🟡 3.0-3.5 YELLOW';
  return '🔴 < 3.0 RED → 触发 v1.1';
}

function overallDecision(value: number | null): string {
  if (value == null) return '⚪ 等评分';
  if (value >= 3.5) return '✅ v1 上线';
  if (value >= 3.0) return '🟡 v1 上线 + 标薄弱';
  return '🔴 触发 TASK-25 prompts v1.1';
}

export function runAggregateCli(argv: string[], opts: { runsDir?: string; repoRoot?: string } = {}): { code: number; output: string } {
  const args = parseArgs(argv);
  if (!args.run) throw new Error('Usage: pnpm evals:aggregate --run <run-id> [--write-report] [--compare <run-id>]');
  const result = aggregateRun(args.run, { runsDir: opts.runsDir });
  const output = args.compare
    ? formatCompare(result, aggregateRun(args.compare, { runsDir: opts.runsDir }))
    : formatAggregate(result);
  if (args.writeReport) {
    const date = args.run.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const file = join(opts.repoRoot ?? REPO_ROOT, 'tasks', `EVALS-AGG-${date}.md`);
    writeFileSync(file, `${output}\n`);
  }
  return { code: 0, output };
}

function parseArgs(argv: string[]): { run?: string; compare?: string; writeReport: boolean } {
  const out: { run?: string; compare?: string; writeReport: boolean } = { writeReport: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') out.run = argv[++i];
    else if (arg === '--compare') out.compare = argv[++i];
    else if (arg === '--write-report') out.writeReport = true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runAggregateCli(process.argv.slice(2));
    console.log(result.output);
    process.exitCode = result.code;
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
