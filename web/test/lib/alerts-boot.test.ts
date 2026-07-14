import { describe, expect, it } from 'vitest';
import { assertAlertsConfiguredForBoot } from '@/lib/api/alerts-boot';

describe('assertAlertsConfiguredForBoot', () => {
  it('throws when production lacks both webhooks', () => {
    expect(() => assertAlertsConfiguredForBoot({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('alerts 配置不全');
  });

  it('passes when at least one webhook configured', () => {
    expect(() => assertAlertsConfiguredForBoot({
      NODE_ENV: 'production',
      WECOM_BOT_WEBHOOK: 'https://qyapi.example/webhook',
    } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertAlertsConfiguredForBoot({
      NODE_ENV: 'production',
      DINGTALK_BOT_WEBHOOK: 'https://oapi.dingtalk.example/robot/send',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('does not throw in dev/test', () => {
    expect(() => assertAlertsConfiguredForBoot({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertAlertsConfiguredForBoot({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
