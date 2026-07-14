export const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

interface DedupEntry {
  firstSeenAt: number;
  expiresAt: number;
  hitCount: number;
}

export interface DedupSnapshotEntry {
  key: string;
  hitCount: number;
  firstSeenAt: number;
  expiresAt: number;
}

const cache = new Map<string, DedupEntry>();

export function shouldDedup(
  key: string,
  now: number = Date.now(),
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  const entry = cache.get(key);
  if (!entry) return false;
  if (entry.expiresAt < now) {
    cache.delete(key);
    return false;
  }
  entry.hitCount += 1;
  return true;
}

export function recordDedup(
  key: string,
  now: number = Date.now(),
  windowMs: number = DEFAULT_WINDOW_MS,
): void {
  cache.set(key, {
    firstSeenAt: now,
    expiresAt: now + windowMs,
    hitCount: 1,
  });
}

export function _clearDedupCacheForTest(): void {
  cache.clear();
}

export function snapshotDedup(now: number = Date.now()): DedupSnapshotEntry[] {
  const result: DedupSnapshotEntry[] = [];
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < now) continue;
    if (entry.hitCount > 1) {
      result.push({ key, hitCount: entry.hitCount, firstSeenAt: entry.firstSeenAt, expiresAt: entry.expiresAt });
    }
  }
  return result;
}
