import { timingSafeEqual } from 'node:crypto';

/**
 * Timing-safe string equality for auth tokens (Node runtime).
 *
 * Uses `node:crypto.timingSafeEqual` with Buffer-backed comparison.
 * Use this in Node runtime route handlers, server modules, and cron jobs.
 * Edge runtime code cannot import `node:crypto`; see `web/middleware.ts`
 * for the hand-rolled Edge runtime equivalent.
 *
 * @see web/middleware.ts
 */
export function timingSafeTokenEqual(actual: string | null | undefined, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
