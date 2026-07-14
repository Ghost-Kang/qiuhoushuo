import { ensureBootGuard } from './boot-guard';

export function assertWechatConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.WX_APPID) missing.push('WX_APPID');
  if (!env.WX_SECRET) missing.push('WX_SECRET');
  ensureBootGuard({
    guard: 'wechat',
    consequence: 'production 小程序登录将全挂',
    missing,
    context: { NODE_ENV: env.NODE_ENV },
  });
}
