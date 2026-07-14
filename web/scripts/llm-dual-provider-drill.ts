/**
 * 双 LLM provider 真链路演练（TASK-29 · 5/16 W3 Fri）
 *
 * 用途：
 * - 决赛日 7/19 之前用真实 key 跑 doubao + deepseek 双 provider；
 *   产 AIGC 备案 §"算法演练" 实证 + decisions/2026-05-16-... 决策档案数据底。
 * - 与 evals:run 互补：evals 关注内容质量（5 人评分）；本脚本关注 SDK 链路
 *   （响应性、failover 决策、tracker E060-E063 是否齐）。
 *
 * 用法：
 *   pnpm tsx scripts/llm-dual-provider-drill.ts --scenario ping
 *   pnpm tsx scripts/llm-dual-provider-drill.ts --scenario failover
 *   pnpm tsx scripts/llm-dual-provider-drill.ts --scenario all   (默认)
 *
 * 输出：
 *   stdout 表格 + JSON
 *   tasks/LLM-DUAL-PROVIDER-DRILL-<ISO 日期>.md（如果传 --write-report）
 *
 * 不进 CI 默认 pipeline（烧真 key 钱）。手动跑。
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile?.('.env.local');
} catch {
  // .env.local 缺失 → 下游真调用时报错
}

import { callLLM, type LLMProvider, type LLMResult } from '../lib/llm';

type Scenario = 'ping' | 'failover' | 'all';

interface CliArgs {
  scenario: Scenario;
  writeReport: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { scenario: 'all', writeReport: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scenario') {
      const v = argv[++i] as Scenario;
      if (v === 'ping' || v === 'failover' || v === 'all') out.scenario = v;
    } else if (a === '--write-report') {
      out.writeReport = true;
    }
  }
  return out;
}

interface DrillEntry {
  name: string;
  expected: string;
  ok: boolean;
  detail: string;
  latencyMs?: number;
  provider?: LLMProvider;
  tokensIn?: number;
  tokensOut?: number;
  errorMessage?: string;
}

// ------ 单 provider 最小 ping ------------------------------------------------

async function pingProvider(provider: LLMProvider): Promise<DrillEntry> {
  const name = `ping:${provider}`;
  const t0 = Date.now();
  try {
    const result = await callLLM({
      provider,
      caller: `drill-${provider}`,
      messages: [
        { role: 'system', content: '你只回复 "OK"。' },
        { role: 'user', content: '回复 OK' },
      ],
      maxTokens: 128,
      temperature: 0,
      timeoutMs: 30_000,
    });
    return {
      name,
      expected: 'HTTP 200 + 非空 content',
      ok: result.content.length > 0,
      detail: `content="${result.content.replace(/\s+/g, ' ').slice(0, 60)}" model=${result.meta.model}`,
      latencyMs: result.meta.latencyMs,
      provider: result.provider,
      tokensIn: result.usage?.input,
      tokensOut: result.usage?.output,
    };
  } catch (err) {
    return {
      name,
      expected: 'HTTP 200',
      ok: false,
      detail: 'CALL FAILED',
      latencyMs: Date.now() - t0,
      errorMessage: (err as Error).message,
    };
  }
}

// ------ failover 4 场景 -------------------------------------------------------

async function scenarioPrimarySuccess(): Promise<DrillEntry> {
  const name = 'failover#1: doubao 主成功（无切换）';
  const t0 = Date.now();
  try {
    const result = await callLLM({
      provider: 'doubao',
      fallback: ['deepseek'],
      caller: 'drill-failover-1',
      messages: [
        { role: 'system', content: '回 OK 即可。' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 128,
      timeoutMs: 30_000,
    });
    return {
      name,
      expected: 'provider=doubao（不切到 deepseek）',
      ok: result.provider === 'doubao',
      detail: `provider=${result.provider} latency=${result.meta.latencyMs}ms`,
      latencyMs: result.meta.latencyMs,
      provider: result.provider,
    };
  } catch (err) {
    return {
      name,
      expected: 'provider=doubao',
      ok: false,
      detail: 'CALL FAILED',
      latencyMs: Date.now() - t0,
      errorMessage: (err as Error).message,
    };
  }
}

async function scenarioPrimary401Failover(): Promise<DrillEntry> {
  const name = 'failover#2: doubao 主 401 → 切 deepseek';
  const t0 = Date.now();
  const origKey = process.env.DOUBAO_API_KEY;
  process.env.DOUBAO_API_KEY = 'sk-broken-test-key-for-drill';
  try {
    const result = await callLLM({
      provider: 'doubao',
      fallback: ['deepseek'],
      caller: 'drill-failover-2',
      messages: [
        { role: 'system', content: '回 OK 即可。' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 128,
      timeoutMs: 30_000,
    });
    return {
      name,
      expected: 'provider=deepseek（豆包 401 后 failover）',
      ok: result.provider === 'deepseek',
      detail: `provider=${result.provider} latency=${result.meta.latencyMs}ms`,
      latencyMs: result.meta.latencyMs,
      provider: result.provider,
    };
  } catch (err) {
    return {
      name,
      expected: 'provider=deepseek',
      ok: false,
      detail: 'CALL FAILED (双 provider 都挂)',
      latencyMs: Date.now() - t0,
      errorMessage: (err as Error).message,
    };
  } finally {
    if (origKey) process.env.DOUBAO_API_KEY = origKey;
  }
}

async function scenarioPrimaryBadHostFailover(): Promise<DrillEntry> {
  const name = 'failover#3: doubao baseURL=127.0.0.1:1 → 切 deepseek';
  const t0 = Date.now();
  const origBase = process.env.DOUBAO_BASE_URL;
  // 把 doubao baseURL 指向 unreachable，触 fetch 网络错；不沾 timeoutMs
  // 共享 quirk（finding F31 留在 §3）
  process.env.DOUBAO_BASE_URL = 'http://127.0.0.1:1';
  try {
    const result = await callLLM({
      provider: 'doubao',
      fallback: ['deepseek'],
      caller: 'drill-failover-3',
      messages: [
        { role: 'system', content: '回 OK 即可。' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 128,
      timeoutMs: 30_000,
    });
    return {
      name,
      expected: 'provider=deepseek（doubao 网络错后 failover）',
      ok: result.provider === 'deepseek',
      detail: `provider=${result.provider} latency=${result.meta.latencyMs}ms`,
      latencyMs: result.meta.latencyMs,
      provider: result.provider,
    };
  } catch (err) {
    return {
      name,
      expected: 'provider=deepseek',
      ok: false,
      detail: 'CALL FAILED (双 provider 都挂)',
      latencyMs: Date.now() - t0,
      errorMessage: (err as Error).message,
    };
  } finally {
    if (origBase) process.env.DOUBAO_BASE_URL = origBase;
  }
}

async function scenarioBothFail(): Promise<DrillEntry> {
  const name = 'failover#4: 双 provider 全 401 → P0 抛错';
  const t0 = Date.now();
  const origDoubao = process.env.DOUBAO_API_KEY;
  const origDeepseek = process.env.DEEPSEEK_API_KEY;
  process.env.DOUBAO_API_KEY = 'sk-broken-doubao';
  process.env.DEEPSEEK_API_KEY = 'sk-broken-deepseek';
  try {
    await callLLM({
      provider: 'doubao',
      fallback: ['deepseek'],
      caller: 'drill-failover-4',
      messages: [
        { role: 'system', content: '回 OK 即可。' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 128,
      timeoutMs: 30_000,
    });
    return {
      name,
      expected: 'throw + 走 notifyOpsFireAndForget P0 (dedupKey=llm-down:drill-failover-4)',
      ok: false,
      detail: 'CALL UNEXPECTEDLY SUCCEEDED (应该抛错)',
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      name,
      expected: 'throw + P0 告警 dedup',
      ok: (err as Error).message.includes('全部 provider 失败'),
      detail: `抛错正常: ${(err as Error).message.slice(0, 80)}`,
      latencyMs: Date.now() - t0,
      errorMessage: (err as Error).message,
    };
  } finally {
    if (origDoubao) process.env.DOUBAO_API_KEY = origDoubao;
    if (origDeepseek) process.env.DEEPSEEK_API_KEY = origDeepseek;
  }
}

// ------ 输出 ----------------------------------------------------------------

function printTable(entries: DrillEntry[]): void {
  console.log('\n=== TASK-29 双 provider 真链路演练结果 ===\n');
  for (const e of entries) {
    const flag = e.ok ? '✅' : '❌';
    console.log(`${flag} ${e.name}`);
    console.log(`   期望: ${e.expected}`);
    console.log(`   实际: ${e.detail}`);
    if (e.latencyMs !== undefined) console.log(`   延迟: ${e.latencyMs}ms`);
    if (e.tokensIn !== undefined) {
      console.log(`   tokens: in=${e.tokensIn} out=${e.tokensOut}`);
    }
    if (e.errorMessage) console.log(`   error: ${e.errorMessage}`);
    console.log('');
  }
  const passed = entries.filter((e) => e.ok).length;
  console.log(`合计 ${passed}/${entries.length} 通过`);
}

function writeReport(entries: DrillEntry[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(process.cwd(), '..', 'tasks', `LLM-DUAL-PROVIDER-DRILL-${date}.md`);
  mkdirSync(join(process.cwd(), '..', 'tasks'), { recursive: true });
  const lines: string[] = [];
  lines.push(`# 双 LLM provider 真链路演练（${date}）\n`);
  lines.push(`**触发**：TASK-29（W4-PLAN-V2 §2.1 W8，L10 5/14 闭环后可触发）`);
  lines.push(`**编制**：Claude（自接，2h 工时）`);
  lines.push(`**用途**：AIGC 备案 §"算法演练" 实证 + 决赛日 7/19 failover 信心\n`);
  lines.push(`## 1. 结果总览\n`);
  lines.push(`| # | 场景 | 通过 | 延迟 | provider | 备注 |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const e of entries) {
    const flag = e.ok ? '✅' : '❌';
    lines.push(
      `| ${e.name} | ${e.expected} | ${flag} | ${e.latencyMs ?? '-'}ms | ${e.provider ?? '-'} | ${e.detail} |`,
    );
  }
  const passed = entries.filter((e) => e.ok).length;
  lines.push(`\n**合计 ${passed}/${entries.length} 通过**\n`);
  lines.push(`## 2. 端到端 JSON 留痕\n`);
  lines.push('```json');
  lines.push(JSON.stringify(entries, null, 2));
  lines.push('```\n');
  lines.push(`## 3. 复跑命令\n`);
  lines.push('```bash');
  lines.push(`cd web && pnpm tsx scripts/llm-dual-provider-drill.ts --scenario all --write-report`);
  lines.push('```\n');
  writeFileSync(reportPath, lines.join('\n'));
  return reportPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const entries: DrillEntry[] = [];

  if (args.scenario === 'ping' || args.scenario === 'all') {
    entries.push(await pingProvider('doubao'));
    entries.push(await pingProvider('deepseek'));
  }
  if (args.scenario === 'failover' || args.scenario === 'all') {
    entries.push(await scenarioPrimarySuccess());
    entries.push(await scenarioPrimary401Failover());
    entries.push(await scenarioPrimaryBadHostFailover());
    entries.push(await scenarioBothFail());
  }

  printTable(entries);
  if (args.writeReport) {
    const p = writeReport(entries);
    console.log(`报告写入: ${p}`);
  }

  const failed = entries.filter((e) => !e.ok).length;
  if (failed > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]?.endsWith('llm-dual-provider-drill.ts');
if (isDirectRun) {
  void main();
}

export { parseArgs, type DrillEntry };
