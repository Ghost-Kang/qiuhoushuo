/**
 * LLM Provider 抽象层
 *
 * Stage 1 合规决策（不可绕过）：
 * - production 必须使用境内备案大模型（豆包 / DeepSeek / 通义 / 文心）
 * - GPT-4o / Claude 仅可在本地 dev 用于 prompt 验证
 * - 任何输出都必须能附带 "AI 生成" 标识（由调用方处理）
 *
 * 三家 provider 共享 OpenAI Chat Completions 兼容协议：
 * - 豆包（火山引擎方舟）：完全兼容
 * - DeepSeek：完全兼容
 * - Claude / OpenAI：直接用各自 SDK
 *
 * 决赛日双 LLM 热切换由 `callLLM` 的 fallback 机制实现。
 */

import { z } from 'zod';
import { notifyOpsFireAndForget } from './alerts';
import { trackServerEventGlobal } from './api/tracker';
import { recordCost } from './api/cost-meter';

export type LLMProvider = 'doubao' | 'deepseek' | 'claude' | 'openai';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  messages: LLMMessage[];
  /** 0-1，战报建议 0.7，群聊主持建议 0.85 */
  temperature?: number;
  /** 期望的 max tokens（不严格） */
  maxTokens?: number;
  /** 强制要求返回 JSON（战报生成用） */
  responseFormat?: 'text' | 'json';
  /** 主 provider；不传走环境变量 LLM_PROVIDER */
  provider?: LLMProvider;
  /** 失败时尝试的备用 provider 列表 */
  fallback?: LLMProvider[];
  /** 调用方标识（埋点 + 计费） */
  caller: string;
  /** 单次调用 timeout 毫秒，默认 60s */
  timeoutMs?: number;
}

export interface LLMResult {
  content: string;
  provider: LLMProvider;
  /** Promptcache hit 与否（OpenAI / Claude 才有） */
  cacheHit?: boolean;
  /** 输入 + 输出 token */
  usage?: { input: number; output: number };
  /** 元数据：用于追溯 */
  meta: {
    model: string;
    latencyMs: number;
    requestId?: string;
  };
}

const PROD_ALLOWED: LLMProvider[] = ['doubao', 'deepseek'];

export function defaultProvider(): LLMProvider {
  const env = (process.env.LLM_PROVIDER as LLMProvider) || 'doubao';
  if (process.env.NODE_ENV === 'production' && !PROD_ALLOWED.includes(env)) {
    throw new Error(
      `[llm] 生产环境禁用境外 LLM (${env})。请使用 doubao / deepseek。这是 AIGC 合规硬指标。`,
    );
  }
  return env;
}

/**
 * 决赛日双供应商红线:fallback 必须跨供应商,否则主挂时切到同一个死 provider = 无兜底。
 *
 * 调用方不要写死 `fallback: ['deepseek']`——一旦 `LLM_PROVIDER=deepseek`，主备同源、failover 失效
 * （F61 复盘暴露的隐性洞:drill 写死 doubao 主，掩盖了 report 路径主 provider 随 env 漂移的真相）。
 * 永远用本函数从主 provider 推导互补的境内 provider。
 */
export function backupProvidersFor(primary: LLMProvider): LLMProvider[] {
  return PROD_ALLOWED.filter((p) => p !== primary);
}

/**
 * 主调用入口。失败自动切到 fallback。所有路径耗时进 meta。
 */
export async function callLLM(opts: LLMCallOptions): Promise<LLMResult> {
  const primary = opts.provider ?? defaultProvider();
  // 去重:防御调用方把主 provider 也塞进 fallback（或 fallback 内部重复）导致
  // order=['deepseek','deepseek'] 这种「主备同源、白白多打一次同一个死 provider」的退化链。
  const seen = new Set<LLMProvider>();
  const order: LLMProvider[] = [primary, ...(opts.fallback ?? [])].filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  let lastError: unknown;
  for (let i = 0; i < order.length; i += 1) {
    const provider = order[i]!;
    try {
      const t0 = Date.now();
      const result = await callOne(provider, opts);
      result.meta.latencyMs = Date.now() - t0;
      // E060 llm_call_succeeded
      trackServerEventGlobal({
        eventId: 'E060',
        properties: { provider, caller: opts.caller, latency_ms: result.meta.latencyMs, attempt: i + 1 },
      });
      // 更新 daily cost 桶（中间件 cost cap 检查依赖此桶）。
      // 当前 recordCost 只接单一 tokens（input+output 合算用主价）；W5 C4 让 cost-meter 接 input/output 分别计价。
      // fire-and-forget：cost-meter 失败不能阻断 LLM 响应。
      if (result.usage) {
        const totalTokens = (result.usage.input ?? 0) + (result.usage.output ?? 0);
        if (totalTokens > 0) {
          void recordCost(provider, totalTokens).catch((err) => {
            console.warn('[llm] recordCost failed:', (err as Error).message);
          });
        }
      }
      // E062 llm_failover_to_backup（成功但不是主 provider = 上一个挂了切到 backup）
      if (i > 0) {
        trackServerEventGlobal({
          eventId: 'E062',
          properties: { from: order[i - 1]!, to: provider, caller: opts.caller },
        });
      }
      return result;
    } catch (err) {
      lastError = err;
      const message = (err as Error).message;
      // E061 llm_call_failed（per-provider 单挂）
      trackServerEventGlobal({
        eventId: 'E061',
        properties: { provider, caller: opts.caller, error: message },
      });
      // 业务层只关心成功，failover 静默切换
      console.warn(`[llm] ${provider} failed:`, message);
    }
  }
  // PROCESS.md §5 升级树最上一档：所有 provider 全挂 = LLM 链路完全断 = 战报无法生成 = P0
  const reason = (lastError as Error)?.message ?? String(lastError);
  // E063 llm_all_providers_down
  trackServerEventGlobal({
    eventId: 'E063',
    properties: { providers: order, caller: opts.caller, last_error: reason },
  });
  notifyOpsFireAndForget(
    {
      severity: 'P0',
      title: `LLM 全挂 · ${order.join('→')}`,
      body:
        `**调用方**：${opts.caller}\n` +
        `**provider 链**：${order.join(' → ')}\n` +
        `**最后错误**：${reason}\n\n` +
        `所有 provider 都失败。路由层将回退到模板兜底（report.ts）或返 500。运营 15min 内介入。`,
      tags: ['llm-down', opts.caller],
    },
    {
      dedupKey: `llm-down:${opts.caller}`,
      dedupWindowMs: 5 * 60 * 1000,
    },
  );
  throw new Error(`[llm] 全部 provider 失败 (${order.join(', ')}): ${reason}`);
}

async function callOne(provider: LLMProvider, opts: LLMCallOptions): Promise<LLMResult> {
  switch (provider) {
    case 'doubao':
      return callOpenAICompatible({
        baseURL: process.env.DOUBAO_BASE_URL!,
        apiKey: process.env.DOUBAO_API_KEY!,
        model: process.env.DOUBAO_MODEL_REPORT || 'doubao-seed-1-6-250615',
        provider: 'doubao',
        opts,
      });
    case 'deepseek':
      return callDeepseekWithEmptyRetry(opts);
    case 'openai':
      assertDevOnly('openai');
      return callOpenAICompatible({
        baseURL: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-4o-mini',
        provider: 'openai',
        opts,
      });
    case 'claude':
      assertDevOnly('claude');
      return callClaude(opts);
    default:
      throw new Error(`[llm] unknown provider: ${provider}`);
  }
}

/**
 * deepseek-v4-pro 是推理模型:JSON 模式下 reasoning_tokens 占用 max_tokens 额度,
 * 预算过窄时 reasoning 会吃光全部额度 → content 为空(实测 max_tokens=200 时 reasoning=200/content="")。
 * 这种「token 饿死」型空 content,`callDeepseekWithEmptyRetry` 的重试救不了——重试只会再烧一遍 reasoning。
 * 故对 deepseek 的 JSON 调用保底把 max_tokens 抬到此 floor,给 reasoning + 实际内容都留余量。
 * 仅托底窄预算调用方;战报路径已用 4000(实测 reasoning 仅 155),不受影响。F67 防御。
 */
const DEEPSEEK_JSON_MIN_TOKENS = 1500;

/** deepseek + JSON 模式 + 预算低于 floor 时抬高,防推理吃光额度致 content 空。其余情形原样返回。 */
function ensureDeepseekReasoningHeadroom(opts: LLMCallOptions): LLMCallOptions {
  if (opts.responseFormat !== 'json') return opts;
  const requested = opts.maxTokens ?? 2000;
  if (requested >= DEEPSEEK_JSON_MIN_TOKENS) return opts;
  console.warn(
    `[llm] deepseek JSON maxTokens=${requested} 低于推理余量阈值 ${DEEPSEEK_JSON_MIN_TOKENS}，` +
      `已抬高以防 reasoning 吃光额度致 content 空（caller=${opts.caller}）`,
  );
  return { ...opts, maxTokens: DEEPSEEK_JSON_MIN_TOKENS };
}

/**
 * DeepSeek 空 content retry-1（F31 缓解）。
 *
 * 仅对固定的 "Empty content from LLM" 错误立即重试一次；HTTP/timeout/其他错误仍交给
 * callLLM 外层 failover，避免扩大决赛日 60s 窗口里的长尾。
 */
async function callDeepseekWithEmptyRetry(opts: LLMCallOptions): Promise<LLMResult> {
  const baseArgs = {
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    provider: 'deepseek' as const,
    opts: ensureDeepseekReasoningHeadroom(opts),
  };
  try {
    return await callOpenAICompatible(baseArgs);
  } catch (err) {
    if ((err as Error).message !== 'Empty content from LLM') {
      throw err;
    }
    trackServerEventGlobal({
      eventId: 'E064',
      properties: { caller: opts.caller, attempt: 2 },
    });
    return await callOpenAICompatible(baseArgs);
  }
}

function assertDevOnly(p: LLMProvider) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`[llm] ${p} 仅本地 dev 可用，production 禁用`);
  }
}

interface OpenAICompatibleArgs {
  baseURL: string;
  apiKey: string;
  model: string;
  provider: LLMProvider;
  opts: LLMCallOptions;
}

async function callOpenAICompatible(args: OpenAICompatibleArgs): Promise<LLMResult> {
  const { baseURL, apiKey, model, provider, opts } = args;
  if (!apiKey) {
    throw new Error(`[llm] ${provider} API_KEY 未配置`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2000,
    };
    if (opts.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty content from LLM');
    }
    return {
      content,
      provider,
      usage: data.usage
        ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens }
        : undefined,
      meta: {
        model,
        latencyMs: 0, // 由 callLLM 填
        requestId: data.id,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function callClaude(opts: LLMCallOptions): Promise<LLMResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[llm] ANTHROPIC_API_KEY 未配置（dev only）');
  const sys = opts.messages.find((m) => m.role === 'system')?.content;
  const others = opts.messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      system: sys,
      messages: others.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ text: string }>; usage: { input_tokens: number; output_tokens: number }; id: string };
  return {
    content: data.content[0]?.text ?? '',
    provider: 'claude',
    usage: { input: data.usage.input_tokens, output: data.usage.output_tokens },
    meta: { model: 'claude-haiku-4-5', latencyMs: 0, requestId: data.id },
  };
}

/**
 * 校验 LLM 返回的 JSON 战报。失败抛出，由调用方决定重试或降级。
 */
export const ReportSchema = z.object({
  title: z.string().min(8).max(40),
  subtitle: z.string().min(10).max(80),
  lead: z.string().min(40).max(300),
  body: z.array(z.string().min(60).max(500)).min(2).max(4),
  ending: z.string().min(40).max(200),
  share_quote: z.string().min(8).max(40),
  tags: z.array(z.string()).min(2).max(6),
});
export type Report = z.infer<typeof ReportSchema>;

export function parseReport(raw: string): Report {
  const cleaned = raw
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return ReportSchema.parse(parsed);
}
