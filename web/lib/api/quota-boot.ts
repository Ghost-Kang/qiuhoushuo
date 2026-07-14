import { ensureBootGuard } from './boot-guard';

/**
 * 限流 / in-flight / 成本封顶「共享存储」启动校验（架构审视 R2）。
 *
 * middleware 跑 Edge runtime，共享态走 Upstash REST（Edge 兼容，Vercel/腾讯云通用；
 * 腾讯云 Redis 走 TCP，Edge 不可用，故此处校验的是 Upstash，不是 ioredis）。
 *
 * production + RATELIMIT_STRICT=1（运营为公测 / 决赛日开启）时，缺 Upstash 即 fail-fast：
 * 防止多实例下限流/封顶退化为单实例内存、全局封顶失效（决赛日刷穿 + 成本失控）。
 * 默认（RATELIMIT_STRICT≠1）不挡：内测 / 免费单实例阶段 memory 可接受。
 */
export function assertQuotaStoreConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.RATELIMIT_STRICT !== '1') return;

  const missing: string[] = [];
  if (!env.UPSTASH_REDIS_REST_URL) missing.push('UPSTASH_REDIS_REST_URL');
  if (!env.UPSTASH_REDIS_REST_TOKEN) missing.push('UPSTASH_REDIS_REST_TOKEN');

  ensureBootGuard({
    guard: 'quota-store',
    consequence: 'production 限流 / in-flight / 成本封顶退化为单实例内存，多实例下全局封顶失效',
    missing,
    context: { NODE_ENV: env.NODE_ENV, RATELIMIT_STRICT: env.RATELIMIT_STRICT },
  });
}
