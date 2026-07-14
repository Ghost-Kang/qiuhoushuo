export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertAlertsConfiguredForBoot } = await import('./lib/api/alerts-boot');
    assertAlertsConfiguredForBoot();
    const { assertSafetyConfiguredForBoot } = await import('./lib/safety');
    assertSafetyConfiguredForBoot();
    const { assertWechatConfiguredForBoot } = await import('./lib/api/wechat-boot');
    assertWechatConfiguredForBoot();
    const { assertWechatPayConfiguredForBoot } = await import('./lib/api/wechat-pay-boot');
    assertWechatPayConfiguredForBoot();
    const { assertSupabaseConfiguredForBoot } = await import('./lib/api/supabase-boot');
    assertSupabaseConfiguredForBoot();
    const { assertLLMConfiguredForBoot } = await import('./lib/api/llm-boot');
    assertLLMConfiguredForBoot();
    const { assertQuotaStoreConfiguredForBoot } = await import('./lib/api/quota-boot');
    assertQuotaStoreConfiguredForBoot();
  }
}
