import { afterEach, describe, expect, it } from 'vitest';
import { checkAdminRateLimit } from '@/lib/api/admin-rate-limit';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';

afterEach(() => {
  __resetQuotaMemoryForTests();
});

describe('checkAdminRateLimit', () => {
  it('allows up to 10 req/min per IP', async () => {
    let res: Response | null = null;
    for (let i = 0; i < 10; i += 1) {
      res = await checkAdminRateLimit(req('1.2.3.4'));
    }
    expect(res).toBeNull();
  });

  it('rejects 11th req with 429', async () => {
    for (let i = 0; i < 10; i += 1) await checkAdminRateLimit(req('1.2.3.4'));
    const res = await checkAdminRateLimit(req('1.2.3.4'));
    expect(res?.status).toBe(429);
    expect(await res?.json()).toMatchObject({ error: 'RATE_LIMIT_ADMIN' });
  });
});

function req(ip: string) {
  return new Request('http://localhost/api/admin/quotas', { headers: { 'x-forwarded-for': ip } });
}
