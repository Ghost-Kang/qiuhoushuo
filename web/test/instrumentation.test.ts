import { afterEach, describe, expect, it, vi } from 'vitest';

const alertsBootSpy = vi.fn();
const safetyBootSpy = vi.fn();
const wechatBootSpy = vi.fn();
const supabaseBootSpy = vi.fn();
const llmBootSpy = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  alertsBootSpy.mockReset();
  safetyBootSpy.mockReset();
  wechatBootSpy.mockReset();
  supabaseBootSpy.mockReset();
  llmBootSpy.mockReset();
  delete process.env.NEXT_RUNTIME;
});

describe('instrumentation register', () => {
  it('register() calls all five boot guards in node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    vi.doMock('@/lib/api/alerts-boot', () => ({
      assertAlertsConfiguredForBoot: alertsBootSpy,
    }));
    vi.doMock('@/lib/safety', () => ({
      assertSafetyConfiguredForBoot: safetyBootSpy,
    }));
    vi.doMock('@/lib/api/wechat-boot', () => ({
      assertWechatConfiguredForBoot: wechatBootSpy,
    }));
    vi.doMock('@/lib/api/supabase-boot', () => ({
      assertSupabaseConfiguredForBoot: supabaseBootSpy,
    }));
    vi.doMock('@/lib/api/llm-boot', () => ({
      assertLLMConfiguredForBoot: llmBootSpy,
    }));
    const { register } = await import('@/instrumentation');
    await register();
    expect(alertsBootSpy).toHaveBeenCalledOnce();
    expect(safetyBootSpy).toHaveBeenCalledOnce();
    expect(wechatBootSpy).toHaveBeenCalledOnce();
    expect(supabaseBootSpy).toHaveBeenCalledOnce();
    expect(llmBootSpy).toHaveBeenCalledOnce();
  });

  it('register() skips all boot guards in edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    vi.doMock('@/lib/api/alerts-boot', () => ({
      assertAlertsConfiguredForBoot: alertsBootSpy,
    }));
    vi.doMock('@/lib/safety', () => ({
      assertSafetyConfiguredForBoot: safetyBootSpy,
    }));
    vi.doMock('@/lib/api/wechat-boot', () => ({
      assertWechatConfiguredForBoot: wechatBootSpy,
    }));
    vi.doMock('@/lib/api/supabase-boot', () => ({
      assertSupabaseConfiguredForBoot: supabaseBootSpy,
    }));
    vi.doMock('@/lib/api/llm-boot', () => ({
      assertLLMConfiguredForBoot: llmBootSpy,
    }));
    const { register } = await import('@/instrumentation');
    await register();
    expect(alertsBootSpy).not.toHaveBeenCalled();
    expect(safetyBootSpy).not.toHaveBeenCalled();
    expect(wechatBootSpy).not.toHaveBeenCalled();
    expect(supabaseBootSpy).not.toHaveBeenCalled();
    expect(llmBootSpy).not.toHaveBeenCalled();
  });
});
