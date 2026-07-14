import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureBootGuard } from '@/lib/api/boot-guard';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureBootGuard', () => {
  it('does nothing when missing is empty', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({ guard: 'x', consequence: 'ok', missing: [] })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws and logs message plus structured lines when missing is present', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({ guard: 'alerts', consequence: '决赛日无告警通道', missing: ['X'] }))
      .toThrow('alerts 配置不全（决赛日无告警通道）：缺 X');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![0]).toBe('[alerts-boot] P0 alerts 配置不全（决赛日无告警通道）：缺 X');
  });

  it('keeps the thrown message exact', () => {
    expect(() => ensureBootGuard({ guard: 'wechat', consequence: 'production 小程序登录将全挂', missing: ['WX_APPID'] }))
      .toThrow('wechat 配置不全（production 小程序登录将全挂）：缺 WX_APPID');
  });

  it('logs structured JSON with stable fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({ guard: 'safety', consequence: '不可上线', missing: ['Y'] })).toThrow();
    const line = String(spy.mock.calls[1]![0]);
    expect(line.startsWith('[safety-boot] structured ')).toBe(true);
    const jsonText = line.replace('[safety-boot] structured ', '');
    expect(jsonText.startsWith('{"level":"P0","guard":"safety-boot","consequence":"不可上线","missing":["Y"],"context":{},"timestamp":')).toBe(true);
    expect(JSON.parse(jsonText)).toMatchObject({ level: 'P0', guard: 'safety-boot', missing: ['Y'] });
  });

  it('emits an ISO timestamp in structured JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({ guard: 'x', consequence: 'bad', missing: ['Z'] })).toThrow();
    const parsed = JSON.parse(String(spy.mock.calls[1]![0]).replace('[x-boot] structured ', '')) as { timestamp: string };
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('passes context through structured JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({
      guard: 'x',
      consequence: 'bad',
      missing: ['Z'],
      context: { NODE_ENV: 'production' },
    })).toThrow();
    const parsed = JSON.parse(String(spy.mock.calls[1]![0]).replace('[x-boot] structured ', '')) as { context: Record<string, string> };
    expect(parsed.context).toEqual({ NODE_ENV: 'production' });
  });

  it('joins multiple missing values in message and preserves them in structured JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => ensureBootGuard({ guard: 'x', consequence: 'bad', missing: ['A', 'B'] }))
      .toThrow('x 配置不全（bad）：缺 A, B');
    const parsed = JSON.parse(String(spy.mock.calls[1]![0]).replace('[x-boot] structured ', '')) as { missing: string[] };
    expect(parsed.missing).toEqual(['A', 'B']);
  });
});
