import { describe, expect, it } from 'vitest';
import { assertWechatConfiguredForBoot } from '@/lib/api/wechat-boot';

describe('assertWechatConfiguredForBoot', () => {
  it('throws in production when both WX_APPID and WX_SECRET missing', () => {
    expect(() => assertWechatConfiguredForBoot({ NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toThrow(/WX_APPID.*WX_SECRET/);
  });

  it('throws in production when only WX_APPID missing', () => {
    expect(() => assertWechatConfiguredForBoot({
      NODE_ENV: 'production',
      WX_SECRET: 'shh',
    } as NodeJS.ProcessEnv)).toThrow(/WX_APPID/);
  });

  it('throws in production when only WX_SECRET missing', () => {
    expect(() => assertWechatConfiguredForBoot({
      NODE_ENV: 'production',
      WX_APPID: 'wxabc',
    } as NodeJS.ProcessEnv)).toThrow(/WX_SECRET/);
  });

  it('passes when both configured in production', () => {
    expect(() => assertWechatConfiguredForBoot({
      NODE_ENV: 'production',
      WX_APPID: 'wxabc',
      WX_SECRET: 'shh',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('does not throw in dev/test even when both missing', () => {
    expect(() => assertWechatConfiguredForBoot({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertWechatConfiguredForBoot({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
