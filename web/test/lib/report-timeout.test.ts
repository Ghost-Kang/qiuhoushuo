import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMCallOptions, LLMResult, Report } from '@/lib/llm';
import type { MatchData } from '@/lib/prompts';

const MATCH: MatchData = {
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛',
  date: '2026-06-22',
  final_score: '2:1',
  events: [],
  stats: {},
};

const llmCalls: LLMCallOptions[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  llmCalls.length = 0;
});

describe('reportLlmTimeoutMs', () => {
  it('defaults to 50s and honors REPORT_LLM_TIMEOUT_MS within 10s-300s bounds', async () => {
    const { reportLlmTimeoutMs } = await import('@/lib/report');
    const env = (overrides: Record<string, string>): NodeJS.ProcessEnv =>
      ({ NODE_ENV: 'test', ...overrides }) as NodeJS.ProcessEnv;
    expect(reportLlmTimeoutMs(env({}))).toBe(50_000);
    expect(reportLlmTimeoutMs(env({ REPORT_LLM_TIMEOUT_MS: '120000' }))).toBe(120_000);
    // 越界/非法回落默认,不放大不缩小
    expect(reportLlmTimeoutMs(env({ REPORT_LLM_TIMEOUT_MS: '5000' }))).toBe(50_000);
    expect(reportLlmTimeoutMs(env({ REPORT_LLM_TIMEOUT_MS: '999999999' }))).toBe(50_000);
    expect(reportLlmTimeoutMs(env({ REPORT_LLM_TIMEOUT_MS: 'abc' }))).toBe(50_000);
  });
});

describe('generateAllStyles LLM timeout', () => {
  it('passes timeoutMs=50_000 to each report LLM call', async () => {
    vi.doMock('@/lib/llm', () => ({
      callLLM: vi.fn(async (opts: LLMCallOptions): Promise<LLMResult> => {
        llmCalls.push(opts);
        return {
          content: '{}',
          provider: 'doubao',
          usage: { input: 10, output: 20 },
          meta: { model: 'mock-model', latencyMs: 12 },
        };
      }),
      parseReport: vi.fn((): Report => reportPayload()),
      defaultProvider: vi.fn(() => 'doubao'),
      backupProvidersFor: vi.fn(() => ['deepseek']),
    }));
    vi.doMock('@/lib/safety', () => ({
      addAIGCWatermark: (text: string) => `${text}【AI 生成内容】`,
      contentSafetyCheck: vi.fn(async () => ({ pass: true })),
    }));

    const { generateAllStyles } = await import('@/lib/report');
    await generateAllStyles(MATCH);

    expect(llmCalls).toHaveLength(3);
    expect(llmCalls.map((call) => call.caller).sort()).toEqual([
      'report:duanzi',
      'report:emotion',
      'report:hardcore',
    ]);
    expect(llmCalls.every((call) => call.timeoutMs === 50_000)).toBe(true);
    expect(llmCalls.every((call) => call.fallback?.includes('deepseek'))).toBe(true);
  });
});

function reportPayload(): Report {
  return {
    title: '巴西绝杀西班牙',
    subtitle: '国际大赛小组赛速递',
    lead: '巴西与西班牙在小组赛打出高质量对抗，关键时刻的进球改变了整场比赛的节奏，也留下了复盘空间。',
    body: [
      '上半场双方互有攻守，巴西依靠边路推进制造机会，西班牙则用控球和连续转移寻找空当，比赛节奏始终保持在高位。',
      '下半场最后阶段，巴西抓住一次转换机会完成制胜球，西班牙虽然持续压上，但未能把控球优势重新转化为比分。',
    ],
    ending: '这场胜利让巴西拿到关键积分，也让西班牙需要重新审视防线转换速度和最后一传质量。',
    share_quote: '巴西赢在最后一击',
    tags: ['巴西', '西班牙', '战报'],
  };
}
