import { afterEach, describe, expect, it } from 'vitest';
import { __resetFlagsForTests } from '@/lib/api/feature-flags';
import { json, req } from './_utils';

afterEach(() => {
  __resetFlagsForTests();
  delete process.env.FEATURE_FLAG_FAN_AVATAR_COSTAR_ENTRY;
  delete process.env.FEATURE_FLAG_FAN_AVATAR_COSTAR;
});

describe('/api/avatar/config', () => {
  it('入口 flag 未设 → costar_entry=false（默认隐藏，fail-closed）', async () => {
    __resetFlagsForTests();
    const { GET } = await import('@/app/api/avatar/config/route');
    const res = await GET(req('/api/avatar/config', { headers: { 'x-openid': 'o1' } }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ costar_entry: false });
  });

  it('入口 flag =100 → costar_entry=true（过审后翻开即对小程序可见）', async () => {
    process.env.FEATURE_FLAG_FAN_AVATAR_COSTAR_ENTRY = '100';
    __resetFlagsForTests();
    const { GET } = await import('@/app/api/avatar/config/route');
    const res = await GET(req('/api/avatar/config', { headers: { 'x-openid': 'o1' } }));
    expect(await json(res)).toEqual({ costar_entry: true });
  });

  it('生成门 fan_avatar_costar 开、入口门未设 → 仍 false（两门分离，H5 开不等于小程序入口露出）', async () => {
    process.env.FEATURE_FLAG_FAN_AVATAR_COSTAR = '100';
    __resetFlagsForTests();
    const { GET } = await import('@/app/api/avatar/config/route');
    const res = await GET(req('/api/avatar/config', { headers: { 'x-openid': 'o1' } }));
    expect(await json(res)).toEqual({ costar_entry: false });
  });
});
