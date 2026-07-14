import { ensureBootGuard } from './boot-guard';

export function assertAlertsConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.WECOM_BOT_WEBHOOK && !env.DINGTALK_BOT_WEBHOOK) {
    missing.push('WECOM_BOT_WEBHOOK 或 DINGTALK_BOT_WEBHOOK 任一');
  }
  ensureBootGuard({
    guard: 'alerts',
    consequence: '决赛日无告警通道',
    missing,
    context: { NODE_ENV: env.NODE_ENV },
  });
}
