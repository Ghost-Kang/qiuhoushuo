/**
 * F25 闭环：quota-store.ts Upstash 真路径覆盖（branches 63.5 → ≥ 90）
 *
 * 既有测试只覆盖 memory fallback（hasRedis=false）。本文件用 vi.stubEnv + vi.mock + dynamic import
 * 模拟 production 配 Upstash 环境，验证 getValue/setValue/delValue/incrWindow/incrBy/scanPrefix
 * 6 个函数的 redis 客户端调用路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RedisCalls = Array<{ method: string; args: unknown[] }>;

type RedisStub = {
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<string>;
  del: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, ttl: number) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  incrby: (key: string, by: number) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
};

const calls: RedisCalls = [];
const incrCounters = new Map<string, number>();
const redisStub: RedisStub = {
  get: async (key) => {
    calls.push({ method: 'get', args: [key] });
    return key === 'present' ? 'v1' : null;
  },
  set: async (...args) => {
    calls.push({ method: 'set', args });
    return 'OK';
  },
  del: async (key) => {
    calls.push({ method: 'del', args: [key] });
    return 1;
  },
  incr: async (key) => {
    calls.push({ method: 'incr', args: [key] });
    const next = (incrCounters.get(key) ?? 0) + 1;
    incrCounters.set(key, next);
    return next;
  },
  expire: async (key, ttl) => {
    calls.push({ method: 'expire', args: [key, ttl] });
    return 1;
  },
  ttl: async (key) => {
    calls.push({ method: 'ttl', args: [key] });
    return 42;
  },
  incrby: async (key, by) => {
    calls.push({ method: 'incrby', args: [key, by] });
    return by;
  },
  keys: async (pattern) => {
    calls.push({ method: 'keys', args: [pattern] });
    return ['rl:ip:1.2.3.4', 'rl:ip:5.6.7.8'];
  },
};

vi.mock('@upstash/redis/cloudflare', () => ({
  Redis: {
    fromEnv: () => redisStub,
  },
}));

beforeEach(() => {
  calls.length = 0;
  incrCounters.clear();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-x');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadStore() {
  return import('@/lib/api/quota-store');
}

describe('quota-store Upstash path', () => {
  it('getValue calls redis.get and returns value', async () => {
    const { getValue } = await loadStore();
    const present = await getValue('present');
    const absent = await getValue('absent');
    expect(present).toBe('v1');
    expect(absent).toBe(null);
    expect(calls.filter((c) => c.method === 'get').map((c) => c.args[0])).toEqual(['present', 'absent']);
  });

  it('setValue without ttl calls redis.set with no options', async () => {
    const { setValue } = await loadStore();
    await setValue('k', 'v');
    const setCall = calls.find((c) => c.method === 'set');
    expect(setCall?.args).toEqual(['k', 'v']);
  });

  it('setValue with ttl passes { ex: N } to redis.set', async () => {
    const { setValue } = await loadStore();
    await setValue('k', 'v', 300);
    const setCall = calls.find((c) => c.method === 'set');
    expect(setCall?.args).toEqual(['k', 'v', { ex: 300 }]);
  });

  it('delValue calls redis.del', async () => {
    const { delValue } = await loadStore();
    await delValue('k');
    expect(calls.some((c) => c.method === 'del' && c.args[0] === 'k')).toBe(true);
  });

  it('incrWindow first call sets expire then returns count + retryAfter', async () => {
    const { incrWindow } = await loadStore();
    const r = await incrWindow('w1', 300);
    expect(r.count).toBe(1);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.method === 'incr' && c.args[0] === 'w1')).toBe(true);
    expect(calls.some((c) => c.method === 'expire' && c.args[0] === 'w1' && c.args[1] === 300)).toBe(true);
  });

  it('incrWindow second call skips expire (count > 1)', async () => {
    const { incrWindow } = await loadStore();
    await incrWindow('w2', 300);
    calls.length = 0;
    const r = await incrWindow('w2', 300);
    expect(r.count).toBe(2);
    expect(calls.some((c) => c.method === 'expire')).toBe(false);
  });

  it('incrWindow retryAfter min clamped to 1 when redis.ttl returns 0 or negative', async () => {
    const original = redisStub.ttl;
    redisStub.ttl = async () => 0;
    try {
      const { incrWindow } = await loadStore();
      const r = await incrWindow('w3', 300);
      expect(r.retryAfter).toBe(1);
    } finally {
      redisStub.ttl = original;
    }
  });

  it('incrBy with ttl on first add sets expire', async () => {
    const { incrBy } = await loadStore();
    const count = await incrBy('c1', 7, 300);
    expect(count).toBe(7);
    expect(calls.some((c) => c.method === 'incrby' && c.args[0] === 'c1' && c.args[1] === 7)).toBe(true);
    expect(calls.some((c) => c.method === 'expire' && c.args[0] === 'c1' && c.args[1] === 300)).toBe(true);
  });

  it('incrBy without ttl skips expire', async () => {
    const { incrBy } = await loadStore();
    await incrBy('c2', 3);
    expect(calls.some((c) => c.method === 'expire' && c.args[0] === 'c2')).toBe(false);
  });

  it('incrBy with ttl but count !== by skips expire', async () => {
    const original = redisStub.incrby;
    redisStub.incrby = async (key: string, by: number) => {
      calls.push({ method: 'incrby', args: [key, by] });
      return by + 100;
    };
    try {
      const { incrBy } = await loadStore();
      await incrBy('c3', 7, 300);
      expect(calls.some((c) => c.method === 'expire' && c.args[0] === 'c3')).toBe(false);
    } finally {
      redisStub.incrby = original;
    }
  });

  it('scanPrefix calls redis.keys with prefix wildcard and stringifies values', async () => {
    const { scanPrefix } = await loadStore();
    const items = await scanPrefix('rl:ip:');
    expect(calls.some((c) => c.method === 'keys' && c.args[0] === 'rl:ip:*')).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0]?.key).toBe('rl:ip:1.2.3.4');
    // value 是 JSON.stringify(await r.get(...)) → 'v1' 时为 '"v1"' / null 时为 'null'
    expect(typeof items[0]?.value).toBe('string');
  });
});

describe('quota-store production memory fallback warn', () => {
  it('warns once in production when Upstash env not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getValue } = await import('@/lib/api/quota-store');
    await getValue('any');
    await getValue('any');
    const fallbackWarns = warn.mock.calls.filter((args) => String(args[0]).includes('FALLBACK to memory rate limit'));
    expect(fallbackWarns).toHaveLength(1);
    warn.mockRestore();
  });
});
