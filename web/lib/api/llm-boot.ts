import { ensureBootGuard } from './boot-guard';

export function assertLLMConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.DOUBAO_API_KEY) missing.push('DOUBAO_API_KEY');
  if (!env.DOUBAO_BASE_URL) missing.push('DOUBAO_BASE_URL');
  if (!env.DEEPSEEK_API_KEY) missing.push('DEEPSEEK_API_KEY');
  ensureBootGuard({
    guard: 'llm',
    consequence: '战报 LLM 调用全挂，决赛日体验降级到模板兜底 + P0 告警刷屏',
    missing,
    context: { NODE_ENV: env.NODE_ENV, LLM_PROVIDER: env.LLM_PROVIDER ?? 'doubao' },
  });
}
