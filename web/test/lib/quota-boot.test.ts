import { describe, expect, it } from 'vitest';
import { assertQuotaStoreConfiguredForBoot } from '@/lib/api/quota-boot';

function env(over: Record<string, string>): NodeJS.ProcessEnv {
  return over as unknown as NodeJS.ProcessEnv;
}

describe('assertQuotaStoreConfiguredForBoot', () => {
  it('no-ops outside production', () => {
    expect(() => assertQuotaStoreConfiguredForBoot(env({ NODE_ENV: 'development', RATELIMIT_STRICT: '1' }))).not.toThrow();
  });

  it('no-ops when RATELIMIT_STRICT is not 1 (内测/免费阶段)', () => {
    expect(() => assertQuotaStoreConfiguredForBoot(env({ NODE_ENV: 'production' }))).not.toThrow();
  });

  it('throws in production + strict when Upstash missing', () => {
    expect(() => assertQuotaStoreConfiguredForBoot(env({ NODE_ENV: 'production', RATELIMIT_STRICT: '1' }))).toThrow(/quota-store/);
  });

  it('throws when only URL set (token missing)', () => {
    expect(() =>
      assertQuotaStoreConfiguredForBoot(env({ NODE_ENV: 'production', RATELIMIT_STRICT: '1', UPSTASH_REDIS_REST_URL: 'https://x' })),
    ).toThrow(/quota-store/);
  });

  it('passes when production + strict + Upstash fully set', () => {
    expect(() =>
      assertQuotaStoreConfiguredForBoot(
        env({ NODE_ENV: 'production', RATELIMIT_STRICT: '1', UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' }),
      ),
    ).not.toThrow();
  });
});
