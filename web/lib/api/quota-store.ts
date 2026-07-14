import { Redis } from '@upstash/redis/cloudflare';

type Entry = { value: string; expiresAt?: number };
type ScanItem = { key: string; value: string };

const memory = new Map<string, Entry>();
let warned = false;
let redis: Redis | null | undefined;

export const hasRedis = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

function getRedis() {
  if (!hasRedis) {
    if (!warned && process.env.NODE_ENV === 'production') {
      console.warn('[middleware] FALLBACK to memory rate limit, NOT for production');
      warned = true;
    }
    return null;
  }
  redis ??= Redis.fromEnv({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL!,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redis;
}

function alive(key: string) {
  const item = memory.get(key);
  if (!item) return null;
  if (item.expiresAt && item.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return item;
}

export async function getValue(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) return r.get<string>(key);
  return alive(key)?.value ?? null;
}

export async function setValue(key: string, value: string, ttlSeconds?: number) {
  const r = getRedis();
  if (r) {
    if (ttlSeconds) await r.set(key, value, { ex: ttlSeconds });
    else await r.set(key, value);
    return;
  }
  memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
}

export async function delValue(key: string) {
  const r = getRedis();
  if (r) await r.del(key);
  else memory.delete(key);
}

export async function incrWindow(key: string, ttlSeconds: number): Promise<{ count: number; retryAfter: number }> {
  const r = getRedis();
  if (r) {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, ttlSeconds);
    const ttl = await r.ttl(key);
    return { count, retryAfter: Math.max(1, ttl) };
  }
  const existing = alive(key);
  const count = existing ? Number(existing.value) + 1 : 1;
  const expiresAt = existing?.expiresAt ?? Date.now() + ttlSeconds * 1000;
  memory.set(key, { value: String(count), expiresAt });
  return { count, retryAfter: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) };
}

export async function incrBy(key: string, by: number, ttlSeconds?: number): Promise<number> {
  const r = getRedis();
  if (r) {
    const count = await r.incrby(key, by);
    if (ttlSeconds && count === by) await r.expire(key, ttlSeconds);
    return count;
  }
  const existing = alive(key);
  const count = (existing ? Number(existing.value) : 0) + by;
  memory.set(key, { value: String(count), expiresAt: existing?.expiresAt ?? (ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined) });
  return count;
}

export async function scanPrefix(prefix: string): Promise<ScanItem[]> {
  const r = getRedis();
  if (r) {
    const keys = await r.keys(`${prefix}*`);
    const values = await Promise.all(keys.map(async (key) => ({ key, value: JSON.stringify(await r.get(key)) })));
    return values;
  }
  const out: ScanItem[] = [];
  for (const key of memory.keys()) {
    const item = alive(key);
    if (item && key.startsWith(prefix)) out.push({ key, value: item.value });
  }
  return out;
}

export function __resetQuotaMemoryForTests() {
  memory.clear();
  warned = false;
}
