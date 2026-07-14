/**
 * Prompt evals 运行器 (PROCESS.md §3.4 / STAGE_05 N01)
 *
 * 用途：
 * - W1 末 5 人评分 ≥ 3.0/5 才能合并 prompts.ts 的改动
 * - W3 末同一套 fixture 重跑，目标 ≥ 3.5/5
 *
 * 用法：
 *   pnpm evals:run                  # 只 dump prompts，不调 LLM（默认）
 *   pnpm evals:run -- --run-llm     # 真调 LLM（需 DOUBAO_API_KEY 等）
 *   pnpm evals:run -- --run-llm --provider deepseek
 *
 * 输出：
 *   web/evals/runs/<YYYY-MM-DD>-<promptVersion>/
 *     manifest.json
 *     inputs/<m##>-<style>.system.txt
 *     inputs/<m##>-<style>.user.txt
 *     responses/<m##>-<style>.json   (仅 --run-llm)
 *     scoresheet.csv                 (5 评审 × 5 场 × 3 风格 = 75 行)
 *
 * 本脚本不查 fixture 合规（那是 validate-fixtures.ts 的事），不上游清洗输入；
 * 是 prompt 的责任输出干净结果，是 evals 的责任如实记录。
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

// 本地 dev 加载 .env.local（Node 20.6+ 原生 API）。production 走部署平台注入。
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile?.('.env.local');
} catch {
  // 文件不存在或不可读：evals 在 dry mode 不需 env，--run-llm 时报错
}

import {
  PROMPT_VERSION,
  buildReportUserPrompt,
  getReportSystemPrompt,
  type MatchData,
  type ReportStyle,
} from '../lib/prompts';
import { callLLM, parseReport, type LLMProvider } from '../lib/llm';
import { FIXTURES, type MatchFixture } from './fixtures';

const STYLES: ReportStyle[] = ['hardcore', 'duanzi', 'emotion'];
const REVIEWERS = ['PM', '后端1', '后端2', '内容', '客服']; // PROCESS §3.4
const TRADEMARK_REGEX = /FIFA|世界杯|World\s*Cup/i; // trademark-allowed

// ---- CLI 解析 ---------------------------------------------------------------

export interface Args {
  runLLM: boolean;
  provider?: LLMProvider;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { runLLM: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run-llm') out.runLLM = true;
    else if (a === '--provider') out.provider = argv[++i] as LLMProvider;
  }
  return out;
}

// ---- fixture → MatchData ----------------------------------------------------

const VALID_EVENT_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'penalty', 'substitution', 'key_save']);

export function fixtureToMatchData(f: MatchFixture): MatchData {
  const teamOf = (side: 'home' | 'away') => f[side].team;
  const events = f.key_events
    .filter((e) => VALID_EVENT_TYPES.has(e.type))
    .map((e) => ({
      minute: e.minute,
      type: e.type as MatchData['events'][number]['type'],
      team: teamOf(e.team as 'home' | 'away'),
      player: e.player,
      description: e.detail,
    }));

  const stats: MatchData['stats'] = {
    possession: { home: f.stats.home_possession, away: f.stats.away_possession },
    shots: { home: f.stats.home_shots, away: f.stats.away_shots },
    shots_on_target: { home: f.stats.home_shots_on, away: f.stats.away_shots_on },
    xg: { home: f.stats.home_xg, away: f.stats.away_xg },
    pass_accuracy: { home: f.stats.home_pass_acc, away: f.stats.away_pass_acc },
    corners: { home: f.stats.home_corners, away: f.stats.away_corners },
  };

  return {
    match: `${f.home.team} vs ${f.away.team}`,
    competition: f.competition,
    venue: f.venue_city,
    date: f.kickoff_iso.slice(0, 10),
    final_score: `${f.home.score}:${f.away.score}`,
    events,
    stats,
    key_players: [...f.home.key_players, ...f.away.key_players].map((name) => ({
      name,
      team: f.home.key_players.includes(name) ? f.home.team : f.away.team,
    })),
  };
}

// ---- LLM 单次调用 -----------------------------------------------------------

interface ResponseRecord {
  ok: boolean;
  /** 解析后的 Report，pass schema 时存在 */
  report?: unknown;
  /** 原始返回（schema 失败时排查用） */
  raw?: string;
  /** 自动检查项 */
  auto: {
    schema_pass: boolean;
    trademark_clean: boolean;
  };
  meta?: { provider: LLMProvider; latencyMs: number; usage?: { input: number; output: number } };
  error?: string;
}

async function runOne(
  data: MatchData,
  style: ReportStyle,
  provider?: LLMProvider,
): Promise<ResponseRecord> {
  const system = getReportSystemPrompt(style);
  const user = buildReportUserPrompt(data);
  try {
    const result = await callLLM({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      provider,
      fallback: provider === 'doubao' ? ['deepseek'] : undefined,
      temperature: 0.7,
      // 与 lib/report.ts 保持一致：中文 token 密度高，2000 默认上限会截断 hardcore/emotion 风格
      maxTokens: 4000,
      responseFormat: 'json',
      caller: 'evals:run',
      // deepseek-v4-pro 是 reasoner，思考阶段就要 30-90s，给到 3min 兜底
      timeoutMs: 180_000,
    });
    const raw = result.content;
    const trademarkClean = !TRADEMARK_REGEX.test(raw);
    let report: unknown;
    let schemaPass = false;
    try {
      report = parseReport(raw);
      schemaPass = true;
    } catch {
      schemaPass = false;
    }
    return {
      ok: schemaPass && trademarkClean,
      report,
      raw: schemaPass ? undefined : raw,
      auto: { schema_pass: schemaPass, trademark_clean: trademarkClean },
      meta: {
        provider: result.provider,
        latencyMs: result.meta.latencyMs,
        usage: result.usage,
      },
    };
  } catch (err) {
    return {
      ok: false,
      auto: { schema_pass: false, trademark_clean: true },
      error: (err as Error).message,
    };
  }
}

// ---- 输出 -------------------------------------------------------------------

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildScoresheetCsv(autoFlags: Map<string, ResponseRecord['auto']>): string {
  const headers = [
    'match_id', 'style', 'reviewer',
    'fact_acc_1to5', 'tone_match_1to5', 'brand_voice_1to5', 'share_vibe_1to5',
    'avg', 'auto_schema_pass', 'auto_trademark_clean', 'notes',
  ];
  const rows: string[][] = [headers];
  for (const f of FIXTURES) {
    for (const style of STYLES) {
      const key = `${f.id}-${style}`;
      const auto = autoFlags.get(key) ?? { schema_pass: false, trademark_clean: false };
      for (const reviewer of REVIEWERS) {
        rows.push([
          f.id, style, reviewer,
          '', '', '', '', '',
          String(auto.schema_pass), String(auto.trademark_clean),
          '',
        ]);
      }
    }
  }
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().slice(0, 10);
  const runDir = join(process.cwd(), 'evals/runs', `${stamp}-${PROMPT_VERSION}`);
  const inputsDir = join(runDir, 'inputs');
  const responsesDir = join(runDir, 'responses');
  mkdirSync(inputsDir, { recursive: true });
  if (args.runLLM) mkdirSync(responsesDir, { recursive: true });

  const autoFlags = new Map<string, ResponseRecord['auto']>();
  const summary: Array<{ id: string; style: ReportStyle; ok: boolean; error?: string }> = [];

  for (const fixture of FIXTURES) {
    const data = fixtureToMatchData(fixture);
    for (const style of STYLES) {
      const key = `${fixture.id}-${style}`;
      const system = getReportSystemPrompt(style);
      const user = buildReportUserPrompt(data);
      writeFileSync(join(inputsDir, `${key}.system.txt`), system);
      writeFileSync(join(inputsDir, `${key}.user.txt`), user);

      if (args.runLLM) {
        process.stderr.write(`[evals] running ${key} ...\n`);
        const rec = await runOne(data, style, args.provider);
        autoFlags.set(key, rec.auto);
        writeFileSync(join(responsesDir, `${key}.json`), JSON.stringify(rec, null, 2));
        summary.push({ id: fixture.id, style, ok: rec.ok, error: rec.error });
      } else {
        autoFlags.set(key, { schema_pass: false, trademark_clean: false });
        summary.push({ id: fixture.id, style, ok: false, error: 'llm_skipped' });
      }
    }
  }

  writeFileSync(join(runDir, 'scoresheet.csv'), buildScoresheetCsv(autoFlags));
  writeFileSync(
    join(runDir, 'manifest.json'),
    JSON.stringify(
      {
        prompt_version: PROMPT_VERSION,
        run_at: new Date().toISOString(),
        run_llm: args.runLLM,
        provider: args.provider ?? null,
        fixtures: FIXTURES.map((f) => f.id),
        styles: STYLES,
        reviewers: REVIEWERS,
        summary,
      },
      null,
      2,
    ),
  );

  const okCount = summary.filter((s) => s.ok).length;
  process.stderr.write(
    `[evals] done. dir=${runDir} llm=${args.runLLM} auto_ok=${okCount}/${summary.length}\n`,
  );
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error('[evals] fatal:', err);
    process.exit(1);
  });
}
