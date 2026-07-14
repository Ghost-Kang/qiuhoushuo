import { describe, expect, it } from 'vitest';
import { requireInternalToken, requireOpenidSignKey } from '@/lib/api/internal-token';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv =>
  vars as unknown as NodeJS.ProcessEnv;

describe('requireInternalToken', () => {
  it('有配置时返回真值', () => {
    expect(requireInternalToken(env({ INTERNAL_TOKEN: 'real' }))).toBe('real');
  });
  it('生产缺配 → 抛错(fail-closed,不回退 dev 字面量)', () => {
    expect(() => requireInternalToken(env({ NODE_ENV: 'production' }))).toThrow(
      'INTERNAL_TOKEN 未配置',
    );
  });
  it('非生产缺配 → dev 回退(本地/单测可用)', () => {
    expect(requireInternalToken(env({ NODE_ENV: 'test' }))).toBe('dev-internal-token');
  });
});

describe('requireOpenidSignKey', () => {
  it('OPENID_SIGN_KEY 优先,其次 INTERNAL_TOKEN', () => {
    expect(requireOpenidSignKey(env({ OPENID_SIGN_KEY: 'a', INTERNAL_TOKEN: 'b' }))).toBe('a');
    expect(requireOpenidSignKey(env({ INTERNAL_TOKEN: 'b' }))).toBe('b');
  });
  it('生产缺配 → 抛错;非生产回退 dev key', () => {
    expect(() => requireOpenidSignKey(env({ NODE_ENV: 'production' }))).toThrow('未配置');
    expect(requireOpenidSignKey(env({}))).toBe('dev-openid-sign-key');
  });
});
