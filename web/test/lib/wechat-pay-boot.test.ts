import { describe, expect, it } from 'vitest';
import { assertWechatPayConfiguredForBoot } from '@/lib/api/wechat-pay-boot';

const FULL = {
  NODE_ENV: 'production',
  WXPAY_ENABLED: '1',
  WXPAY_MCHID: 'm',
  WXPAY_MERCHANT_SERIAL: 's',
  WXPAY_PRIVATE_KEY: 'k',
  WXPAY_API_V3_KEY: 'v',
  WXPAY_PLATFORM_PUBLIC_KEY: 'p',
  WXPAY_NOTIFY_URL: 'u',
  WXPAY_SERVICE_APPID: 'a',
} as unknown as NodeJS.ProcessEnv;

describe('assertWechatPayConfiguredForBoot', () => {
  it('no-ops outside production', () => {
    expect(() =>
      assertWechatPayConfiguredForBoot({ NODE_ENV: 'development', WXPAY_ENABLED: '1' } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('no-ops when WXPAY_ENABLED is not 1 (free mode)', () => {
    expect(() => assertWechatPayConfiguredForBoot({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('throws when enabled but config incomplete', () => {
    expect(() =>
      assertWechatPayConfiguredForBoot({ NODE_ENV: 'production', WXPAY_ENABLED: '1' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/wechat-pay/);
  });

  it('passes when fully configured', () => {
    expect(() => assertWechatPayConfiguredForBoot(FULL)).not.toThrow();
  });

  it('accepts mini appid as an alternative to service appid', () => {
    expect(() =>
      assertWechatPayConfiguredForBoot({
        NODE_ENV: 'production',
        WXPAY_ENABLED: '1',
        WXPAY_MCHID: 'm',
        WXPAY_MERCHANT_SERIAL: 's',
        WXPAY_PRIVATE_KEY: 'k',
        WXPAY_API_V3_KEY: 'v',
        WXPAY_PLATFORM_PUBLIC_KEY: 'p',
        WXPAY_NOTIFY_URL: 'u',
        WXPAY_MINI_APPID: 'mini',
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
