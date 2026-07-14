import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@/lib/api/tracker';

type AlertCall =
  | { severity?: string; title?: string; body?: string }
  | { op: 'track'; eventId: ServerEvent['eventId']; properties?: Record<string, unknown> };

const calls: AlertCall[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  calls.length = 0;
});

describe('maybeAlertCostCap', () => {
  it('fires P1 at 80% threshold once per day', async () => {
    const { maybeAlertCostCap } = await loadSubject();
    await maybeAlertCostCap(80, 100);
    await maybeAlertCostCap(90, 100);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ severity: 'P1', title: 'LLM 成本达到 80% 预警线' });
  });

  it('fires P0 at 100% threshold once per day', async () => {
    const { maybeAlertCostCap } = await loadSubject();
    await maybeAlertCostCap(100, 100);
    await maybeAlertCostCap(150, 100);
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual(expect.objectContaining({ severity: 'P0', title: 'LLM 成本已触顶' }));
    expect(calls).toContainEqual(expect.objectContaining({ op: 'track', eventId: 'E092' }));
  });

  it('does not re-fire after threshold flag set', async () => {
    const { maybeAlertCostCap } = await loadSubject();
    await maybeAlertCostCap(81, 100);
    await maybeAlertCostCap(82, 100);
    await maybeAlertCostCap(101, 100);
    await maybeAlertCostCap(102, 100);
    expect(calls.filter((c) => 'severity' in c && c.severity).map((c) => ('severity' in c ? c.severity : undefined))).toEqual(['P1', 'P0']);
  });

  it('survives notifyOps throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { maybeAlertCostCap } = await loadSubject(true);
    await expect(maybeAlertCostCap(100, 100)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[cost-alert] notify failed:', 'boom');
  });
});

async function loadSubject(throwNotify = false) {
  vi.doMock('@/lib/alerts', () => ({
    notifyOpsFireAndForget: (payload: unknown) => {
      if (throwNotify) throw new Error('boom');
      calls.push(payload as AlertCall);
    },
  }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => calls.push({ op: 'track', eventId: event.eventId, properties: event.properties }),
  }));
  return import('@/lib/api/cost-alert');
}
