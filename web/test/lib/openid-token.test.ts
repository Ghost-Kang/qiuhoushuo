import { describe, expect, it } from 'vitest';
import { signOpenidToken, verifyOpenidToken } from '@/lib/api/openid-token';

const ENV = { OPENID_SIGN_KEY: 'test-sign-key-32-bytes-aaaaaaaaaaaa' } as unknown as NodeJS.ProcessEnv;
const NOW = 1_750_000_000_000;

describe('openid token', () => {
  it('round-trips sign → verify', () => {
    const token = signOpenidToken('mock_openid_001', NOW, 1800, ENV);
    expect(verifyOpenidToken(token, NOW, ENV)).toBe('mock_openid_001');
    expect(token).not.toContain('mock_openid_001'); // 明文 openid 不在 token 里（base64url 编码）
  });

  it('rejects tampered token', () => {
    const token = signOpenidToken('user_a', NOW, 1800, ENV);
    expect(verifyOpenidToken(token + 'x', NOW, ENV)).toBeNull();
    const swapped = token.replace(/^[^.]+/, Buffer.from('user_b', 'utf8').toString('base64url'));
    expect(verifyOpenidToken(swapped, NOW, ENV)).toBeNull();
  });

  it('rejects wrong signing key', () => {
    const token = signOpenidToken('user_a', NOW, 1800, ENV);
    expect(verifyOpenidToken(token, NOW, { OPENID_SIGN_KEY: 'other-key' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it('rejects expired token', () => {
    const token = signOpenidToken('user_a', NOW, 60, ENV);
    expect(verifyOpenidToken(token, NOW + 61_000, ENV)).toBeNull();
    expect(verifyOpenidToken(token, NOW + 59_000, ENV)).toBe('user_a');
  });

  it('rejects malformed / empty', () => {
    expect(verifyOpenidToken(null, NOW, ENV)).toBeNull();
    expect(verifyOpenidToken('', NOW, ENV)).toBeNull();
    expect(verifyOpenidToken('a.b', NOW, ENV)).toBeNull();
    expect(verifyOpenidToken('a.b.c.d', NOW, ENV)).toBeNull();
  });
});
