import { ensureBootGuard } from './boot-guard';

/**
 * 微信支付 production 启动校验。
 *
 * 与小程序登录/safety 不同：微付费在内测期可不开（6/5 内测仅免费功能）。
 * 仅当 WXPAY_ENABLED=1（运营显式开启收款）时，才强制 v3 配置齐全；
 * 否则免费模式正常 boot，不阻塞上线。
 */
export function assertWechatPayConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.WXPAY_ENABLED !== '1') return;

  const missing: string[] = [];
  if (!env.WXPAY_MCHID) missing.push('WXPAY_MCHID');
  if (!env.WXPAY_MERCHANT_SERIAL) missing.push('WXPAY_MERCHANT_SERIAL');
  if (!env.WXPAY_PRIVATE_KEY) missing.push('WXPAY_PRIVATE_KEY');
  if (!env.WXPAY_API_V3_KEY) missing.push('WXPAY_API_V3_KEY');
  if (!env.WXPAY_PLATFORM_PUBLIC_KEY) missing.push('WXPAY_PLATFORM_PUBLIC_KEY');
  if (!env.WXPAY_NOTIFY_URL) missing.push('WXPAY_NOTIFY_URL');
  if (!env.WXPAY_SERVICE_APPID && !env.WXPAY_MINI_APPID) missing.push('WXPAY_SERVICE_APPID_OR_MINI_APPID');

  ensureBootGuard({
    guard: 'wechat-pay',
    consequence: 'production 微付费下单/回调全挂',
    missing,
    context: { NODE_ENV: env.NODE_ENV, WXPAY_ENABLED: env.WXPAY_ENABLED },
  });
}
