import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { json, req } from './_utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetFlagsForTests();
  delete process.env.ADMIN_TOKEN;
  delete process.env.FEATURE_FLAG_FINALS_MODE;
  delete process.env.FEATURE_FLAG_CHAT;
});

describe('/api/admin/flags', () => {
  it('rejects without admin token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { GET } = await import('@/app/api/admin/flags/route');
    const res = await GET(req('/api/admin/flags'));
    expect(res.status).toBe(401);
  });

  it('returns current flag snapshot', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.FEATURE_FLAG_FINALS_MODE = '100';
    process.env.FEATURE_FLAG_CHAT = '20';
    __resetFlagsForTests();
    const { GET } = await import('@/app/api/admin/flags/route');
    const res = await GET(req('/api/admin/flags', { headers: { 'x-admin-token': 'secret' } }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      flags: {
        'feature.finals_mode': 100,
        'feature.chat': 20,
      },
    });
  });
});
