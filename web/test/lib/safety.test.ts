import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotDedup } from '@/lib/alerts/dedup-cache';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';
import { addAIGCWatermark, assertSafetyConfiguredForBoot, contentSafetyCheck, yidunLabelToCategory } from '@/lib/safety';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  __resetQuotaMemoryForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function structuredSafetyBootPayload(error: ReturnType<typeof vi.spyOn>) {
  const structuredLine = String(error.mock.calls[1]?.[0] ?? '');
  const json = structuredLine.replace('[safety-boot] structured ', '');
  return JSON.parse(json) as {
    consequence: string;
    missing: string[];
    context: Record<string, string | undefined>;
  };
}

async function flushEscalationJobs() {
  await Promise.resolve();
  await Promise.resolve();
}

function alertLogs(warn: ReturnType<typeof vi.spyOn>, titlePart: string) {
  return warn.mock.calls.filter(([line]: unknown[]) => String(line).includes('[alerts]') && String(line).includes(titlePart));
}

describe('contentSafetyCheck (local blocklist 三道关卡第一道)', () => {
  it('passes clean text', async () => {
    const r = await contentSafetyCheck({ text: '这是一场精彩的比赛', scenario: 'report' });
    expect(r.pass).toBe(true);
  });

  it.each([
    // event_trademark
    ['FIFA 决赛', 'event_trademark'], // trademark-allowed (反向断言：safety 应拦截)
    ['世界杯之战', 'event_trademark'], // trademark-allowed (反向断言：safety 应拦截)
    ['World Cup final', 'event_trademark'], // trademark-allowed (反向断言：safety 应拦截)
    // gambling（含 W2 扩词）
    ['今晚谁让球？', 'gambling'],
    ['看赔率买大', 'gambling'],
    ['这场亚盘开半球', 'gambling'],
    ['推荐扫码看 AH 走势', 'gambling'],
    ['大小球过关稳胆', 'gambling'],
    // politics（含 W2 扩词）
    ['台独言论', 'politics'],
    ['港独活动', 'politics'],
    ['一中一台说法', 'politics'],
    ['中华民国国旗', 'politics'],
    // discrimination（W2 新增类别）
    ['滚回去棒子', 'discrimination'],
    ['这帮阿三裁判', 'discrimination'],
    ['小日本快滚', 'discrimination'],
  ])('blocks "%s" as %s', async (text, expectedCategory) => {
    const r = await contentSafetyCheck({ text, scenario: 'report' });
    expect(r.pass).toBe(false);
    expect(r.category).toBe(expectedCategory);
    expect(r.hit).toBeDefined();
  });

  it('returns the hit word for debug visibility', async () => {
    const r = await contentSafetyCheck({ text: '让球预测', scenario: 'user_chat' });
    expect(r.pass).toBe(false);
    expect(r.hit).toBe('让球');
  });

  it('does not call remote checker in dev (NODE_ENV !== production)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('remote should not be called in dev');
    });
    vi.stubEnv('NODE_ENV', 'test');
    try {
      const r = await contentSafetyCheck({ text: '正常文本', scenario: 'host' });
      expect(r.pass).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      fetchMock.mockRestore();
    }
  });
});

describe('addAIGCWatermark', () => {
  it('appends footer by default', () => {
    expect(addAIGCWatermark('hello')).toBe('hello\n\n【AI 生成内容】');
  });

  it('inline prepends tag', () => {
    expect(addAIGCWatermark('hello', 'inline')).toBe('【AI 生成内容】 hello');
  });
});

describe('assertSafetyConfiguredForBoot', () => {
  it('throws in production when remote moderation provider is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSafetyConfiguredForBoot({ NODE_ENV: 'production' })).toThrow('safety 配置不全');
    const payload = structuredSafetyBootPayload(error);
    expect(payload.missing).toEqual([
      'SHUMEI_ACCESS_KEY',
      'YIDUN_SECRET_ID',
      'YIDUN_SECRET_KEY',
      'YIDUN_BUSINESS_ID',
    ]);
    expect(payload.consequence).toContain('任一路径');
    expect(payload.consequence).toContain('provider');
  });

  it('passes in production with shumei configured', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSafetyConfiguredForBoot({
      NODE_ENV: 'production',
      SHUMEI_ACCESS_KEY: 'shumei-key',
    })).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('passes in production with complete yidun config', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSafetyConfiguredForBoot({
      NODE_ENV: 'production',
      YIDUN_SECRET_ID: 'secret-id',
      YIDUN_SECRET_KEY: 'secret-key',
      YIDUN_BUSINESS_ID: 'business-id',
    })).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('enumerates only the missing shumei and incomplete yidun fields', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSafetyConfiguredForBoot({
      NODE_ENV: 'production',
      YIDUN_SECRET_ID: 'secret-id',
      YIDUN_BUSINESS_ID: 'business-id',
    })).toThrow('safety 配置不全');
    expect(structuredSafetyBootPayload(error).missing).toEqual(['SHUMEI_ACCESS_KEY', 'YIDUN_SECRET_KEY']);
  });

  it('does not list already-configured yidun fields in partial yidun failures', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertSafetyConfiguredForBoot({
      NODE_ENV: 'production',
      YIDUN_SECRET_KEY: 'secret-key',
    })).toThrow('safety 配置不全');
    expect(structuredSafetyBootPayload(error).missing).toEqual([
      'SHUMEI_ACCESS_KEY',
      'YIDUN_SECRET_ID',
      'YIDUN_BUSINESS_ID',
    ]);
  });

  it('does not throw outside production', () => {
    expect(() => assertSafetyConfiguredForBoot({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSafetyConfiguredForBoot({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('contentSafetyCheck escalation dedup', () => {
  it('dedups same high-risk category and scenario for 5min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 命中 · politics')).toHaveLength(1);
    expect(snapshotDedup()).toEqual([
      expect.objectContaining({ key: 'safety-hit:politics:report', hitCount: 3 }),
    ]);
  });

  it('dispatches again after the 5min P1 dedup window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    vi.setSystemTime(new Date('2026-05-15T00:05:01Z'));
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 命中 · politics')).toHaveLength(2);
  });

  it('keeps scenario as a P1 dedup dimension', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'host' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'host' });
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 命中 · politics')).toHaveLength(2);
    expect(snapshotDedup()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'safety-hit:politics:report', hitCount: 2 }),
      expect.objectContaining({ key: 'safety-hit:politics:host', hitCount: 2 }),
    ]));
  });

  it('keeps category as a P1 dedup dimension', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    await contentSafetyCheck({ text: '滚回去棒子', scenario: 'report' });
    await contentSafetyCheck({ text: '滚回去棒子', scenario: 'report' });
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 命中 · politics')).toHaveLength(1);
    expect(alertLogs(warn, 'safety 命中 · discrimination')).toHaveLength(1);
    expect(snapshotDedup()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'safety-hit:politics:report', hitCount: 2 }),
      expect.objectContaining({ key: 'safety-hit:discrimination:report', hitCount: 2 }),
    ]));
  });

  it('dedups repeated same-category flood escalations for 30min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (let i = 0; i < 10; i += 1) {
      await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    }
    await flushEscalationJobs();

    vi.setSystemTime(new Date('2026-05-15T00:05:01Z'));
    for (let i = 0; i < 10; i += 1) {
      await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    }
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 同类命中 5min')).toHaveLength(1);
    expect(snapshotDedup()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'safety-flood:politics', hitCount: 2 }),
    ]));
  });

  it('does not dedup flood escalations across different categories', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (let i = 0; i < 10; i += 1) {
      await contentSafetyCheck({ text: '台独言论', scenario: 'report' });
    }
    for (let i = 0; i < 10; i += 1) {
      await contentSafetyCheck({ text: '滚回去棒子', scenario: 'report' });
    }
    await flushEscalationJobs();

    expect(alertLogs(warn, 'safety 同类命中 5min')).toHaveLength(2);
  });
});

describe('contentSafetyCheck remote providers', () => {
  it('allows production text when remote provider is not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const r = await contentSafetyCheck({ text: '正常文本', scenario: 'host' });
    expect(r.pass).toBe(true);
    expect(warn).toHaveBeenCalledWith('[safety] 远程审核 provider 未配置，放行（不可上线生产）');
  });

  it('passes shumei PASS response', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SHUMEI_ACCESS_KEY', 'key');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1100, riskLevel: 'PASS' }))) as unknown as typeof fetch;
    await expect(contentSafetyCheck({ text: '正常文本', scenario: 'host', userId: 'u1' })).resolves.toEqual({ pass: true });
  });

  it('blocks shumei risk response', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SHUMEI_ACCESS_KEY', 'key');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1100, riskLevel: 'REJECT', riskType: 100 }))) as unknown as typeof fetch;
    const r = await contentSafetyCheck({ text: '正常文本', scenario: 'host' });
    expect(r).toMatchObject({ pass: false, category: 'other' });
    expect(r.reason).toContain('shumei riskLevel=REJECT');
  });

  it('does not block when shumei returns provider error or throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SHUMEI_ACCESS_KEY', 'key');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 1900 })))
      .mockRejectedValueOnce(new Error('timeout')) as unknown as typeof fetch;
    await expect(contentSafetyCheck({ text: '正常文本', scenario: 'host' })).resolves.toEqual({ pass: true });
    await expect(contentSafetyCheck({ text: '正常文本', scenario: 'host' })).resolves.toEqual({ pass: true });
    expect(warn).toHaveBeenCalledWith('[safety] shumei error:', { code: 1900 });
    expect(warn).toHaveBeenCalledWith('[safety] shumei timeout:', 'timeout');
  });

  it('passes and blocks yidun responses', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('YIDUN_SECRET_ID', 'sid');
    vi.stubEnv('YIDUN_SECRET_KEY', 'skey');
    vi.stubEnv('YIDUN_BUSINESS_ID', 'bid');
    // v5.2 真实判定字段是 suggestion(非 action);label 100=色情 → category porn
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, result: { antispam: { suggestion: 0 } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, result: { antispam: { suggestion: 2, label: 100, riskDescription: '色情｜色情其他' } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, result: { antispam: { suggestion: 1, label: 200 } } }))) as unknown as typeof fetch;
    await expect(contentSafetyCheck({ text: '正常文本', scenario: 'host' })).resolves.toEqual({ pass: true });
    const r = await contentSafetyCheck({ text: '正常文本', scenario: 'host' });
    expect(r).toMatchObject({ pass: false, category: 'porn' });
    expect(r.reason).toContain('yidun suggestion=2');
    // suggestion=1(嫌疑)亦拦截,label 200 → other
    const s = await contentSafetyCheck({ text: '正常文本', scenario: 'host' });
    expect(s).toMatchObject({ pass: false, category: 'other' });
  });

  it('maps yidun label to business category (esp. 500→politics / 600→discrimination 触发升级)', () => {
    expect(yidunLabelToCategory(100)).toBe('porn');
    expect(yidunLabelToCategory(500)).toBe('politics');
    expect(yidunLabelToCategory(600)).toBe('discrimination');
    expect(yidunLabelToCategory(200)).toBe('other');
    expect(yidunLabelToCategory(400)).toBe('other');
    expect(yidunLabelToCategory(undefined)).toBe('other');
  });
});
