import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyOps } from '@/lib/alerts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.WECOM_BOT_WEBHOOK;
  delete process.env.DINGTALK_BOT_WEBHOOK;
});

describe('notifyOps dedup integration', () => {
  it('dispatches only once for the same explicit dedupKey in the default window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = { severity: 'P1' as const, title: 'quota down', body: 'same' };
    await notifyOps(payload, { dedupKey: 'quota:P1:timeout' });
    await notifyOps(payload, { dedupKey: 'quota:P1:timeout' });
    await notifyOps(payload, { dedupKey: 'quota:P1:timeout' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('dispatches every call when skipDedup is true', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = { severity: 'P1' as const, title: 'manual test', body: 'same' };
    await notifyOps(payload, { dedupKey: 'manual:test', skipDedup: true });
    await notifyOps(payload, { dedupKey: 'manual:test', skipDedup: true });
    await notifyOps(payload, { dedupKey: 'manual:test', skipDedup: true });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('dispatches again after the default dedup window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = { severity: 'P0' as const, title: 'auth failed', body: 'same' };
    await notifyOps(payload, { dedupKey: 'auth:P0' });
    vi.setSystemTime(new Date('2026-07-19T00:05:01Z'));
    await notifyOps(payload, { dedupKey: 'auth:P0' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('respects a custom dedup window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T00:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = { severity: 'P1' as const, title: 'rate limited', body: 'same' };
    await notifyOps(payload, { dedupKey: 'rate:P1', dedupWindowMs: 10_000 });
    vi.setSystemTime(new Date('2026-07-19T00:00:11Z'));
    await notifyOps(payload, { dedupKey: 'rate:P1', dedupWindowMs: 10_000 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('keeps default and custom dedup keys isolated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = { severity: 'P2' as const, title: 'ops note', body: 'same', tags: ['ops'] };
    await notifyOps(payload);
    await notifyOps(payload, { dedupKey: 'override:ops-note' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('uses only the first 64 title characters in the default dedup key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = 'x'.repeat(64);
    await notifyOps({ severity: 'P1', title: `${prefix}a`, body: 'first', tags: ['long-title'] });
    await notifyOps({ severity: 'P1', title: `${prefix}b`, body: 'second', tags: ['long-title'] });
    expect(warn).toHaveBeenCalledOnce();
  });
});
