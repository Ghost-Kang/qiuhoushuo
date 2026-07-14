/**
 * safety.ts PROCESS §5 升级告警测试（B4 W3）
 *
 * 验证：
 * 1. politics / discrimination 单次命中 → P1 fire-and-forget
 * 2. event_trademark / gambling 不触发告警（避免噪音）
 * 3. 5min 内同类 10 次 → P0 升级一次（第 11 次不重发）
 * 4. 主链路不被计数器故障阻断
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentSafetyCheck } from '@/lib/safety';
import * as alerts from '@/lib/alerts';
import * as tracker from '@/lib/api/tracker';
import { __resetQuotaMemoryForTests } from '@/lib/api/quota-store';

let notifySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetQuotaMemoryForTests();
  notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);
});

afterEach(() => {
  __resetQuotaMemoryForTests();
  vi.restoreAllMocks();
});

function safetyHitsByTag(tag: string): alerts.AlertPayload[] {
  return notifySpy.mock.calls
    .map((c: unknown[]) => c[0] as alerts.AlertPayload)
    .filter((p: alerts.AlertPayload) => p.tags?.includes(tag));
}

// 等待 escalateIfFlooding 内的 void Promise 完成（incrWindow 是 async）
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('safety 升级 · 高危类别', () => {
  it('politics 单次命中 → P1 fire-and-forget', async () => {
    const r = await contentSafetyCheck({ text: '台独言论真嚣张', scenario: 'user_chat', userId: 'u-1' });
    expect(r.pass).toBe(false);
    expect(r.category).toBe('politics');
    await flush();

    const hits = safetyHitsByTag('safety-hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('P1');
    expect(hits[0]!.title).toContain('politics');
    expect(hits[0]!.body).toContain('u-1');
    expect(hits[0]!.body).toContain('user_chat');
    expect(hits[0]!.tags).toContain('politics');
  });

  it('discrimination 单次命中 → P1', async () => {
    const r = await contentSafetyCheck({ text: '这帮阿三裁判滚回去', scenario: 'host' });
    expect(r.pass).toBe(false);
    expect(r.category).toBe('discrimination');
    await flush();

    const hits = safetyHitsByTag('safety-hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('P1');
    expect(hits[0]!.title).toContain('discrimination');
    expect(hits[0]!.body).toContain('anonymous'); // userId 缺省时
  });
});

describe('safety 升级 · 低优先类别不告警', () => {
  it('event_trademark 命中不告警（prompt 修复信号，不是运营告警）', async () => {
    const r = await contentSafetyCheck({ text: 'FIFA 决赛精彩', scenario: 'report' }); // trademark-allowed (反向断言)
    expect(r.pass).toBe(false);
    expect(r.category).toBe('event_trademark');
    await flush();
    expect(safetyHitsByTag('safety-hit')).toHaveLength(0);
  });

  it('gambling 命中不告警（日常运营噪音）', async () => {
    const r = await contentSafetyCheck({ text: '今晚谁让球？', scenario: 'user_chat' });
    expect(r.pass).toBe(false);
    expect(r.category).toBe('gambling');
    await flush();
    expect(safetyHitsByTag('safety-hit')).toHaveLength(0);
  });

  it('clean 文本不告警', async () => {
    const r = await contentSafetyCheck({ text: '这是一场精彩的比赛', scenario: 'report' });
    expect(r.pass).toBe(true);
    await flush();
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('safety 升级 · 5min 阈值', () => {
  it('5min 内 politics 命中 10 次 → P0 升级一次（第 11 次不重发）', async () => {
    for (let i = 0; i < 11; i += 1) {
      await contentSafetyCheck({ text: '港独活动', scenario: 'user_chat', userId: `u-${i}` });
    }
    await flush();

    const floodAlerts = safetyHitsByTag('safety-flood');
    expect(floodAlerts).toHaveLength(1);
    expect(floodAlerts[0]!.severity).toBe('P0');
    expect(floodAlerts[0]!.title).toContain('politics');
    expect(floodAlerts[0]!.body).toContain('10 次');

    // 11 次 P1 已发（每次命中都发）
    const hitAlerts = safetyHitsByTag('safety-hit');
    expect(hitAlerts).toHaveLength(11);
  });

  it('politics 5 次 + discrimination 5 次：分别计数，都不到阈值，不发 P0', async () => {
    for (let i = 0; i < 5; i += 1) {
      await contentSafetyCheck({ text: '一中一台说法', scenario: 'host' });
    }
    for (let i = 0; i < 5; i += 1) {
      await contentSafetyCheck({ text: '滚回去棒子', scenario: 'host' });
    }
    await flush();

    expect(safetyHitsByTag('safety-flood')).toHaveLength(0);
    expect(safetyHitsByTag('safety-hit')).toHaveLength(10);
  });
});

describe('safety event tracking (E043)', () => {
  it('fires E043 on safety block with redacted hit', async () => {
    const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);

    await contentSafetyCheck({ text: '台独言论真嚣张', scenario: 'user_chat', userId: 'u-99' });

    const e043 = trackSpy.mock.calls.find((c) => (c[0] as tracker.ServerEvent).eventId === 'E043');
    expect(e043).toBeDefined();
    const event = e043![0] as tracker.ServerEvent;
    expect(event.userId).toBe('u-99');
    const props = event.properties!;
    expect(props.scenario).toBe('user_chat');
    expect(props.category).toBe('politics');
    // 命中词原文不应外泄到事件 properties
    expect(props.hit_redacted).toBe('台独**');
    expect(props.hit_redacted).not.toContain('言论');
  });

  it('does not fire E043 on clean text', async () => {
    const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);
    await contentSafetyCheck({ text: '这是一场精彩的比赛', scenario: 'report' });
    const e043 = trackSpy.mock.calls.find((c) => (c[0] as tracker.ServerEvent).eventId === 'E043');
    expect(e043).toBeUndefined();
  });
});
