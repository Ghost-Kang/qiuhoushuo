import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyOps } from '@/lib/alerts';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.WECOM_BOT_WEBHOOK;
  delete process.env.DINGTALK_BOT_WEBHOOK;
  vi.restoreAllMocks();
});

describe('notifyOps', () => {
  it('falls back to console when no webhook configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await notifyOps({ severity: 'P1', title: '测试', body: '正文' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('P1');
    expect(warn.mock.calls[0]![0]).toContain('测试');
  });

  it('posts wecom markdown when WECOM_BOT_WEBHOOK is set', async () => {
    process.env.WECOM_BOT_WEBHOOK = 'https://qyapi.example/cgi-bin/webhook';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await notifyOps({ severity: 'P0', title: '紧急', body: '炸了', tags: ['llm-down'] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://qyapi.example/cgi-bin/webhook');
    expect(init!.method).toBe('POST');
    const body = JSON.parse(init!.body as string);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain('P0');
    expect(body.markdown.content).toContain('紧急');
    expect(body.markdown.content).toContain('llm-down');
  });

  it('posts dingtalk with title slice ≤ 60', async () => {
    process.env.DINGTALK_BOT_WEBHOOK = 'https://oapi.dingtalk.example/robot/send';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const longTitle = 'a'.repeat(80);
    await notifyOps({ severity: 'P2', title: longTitle, body: 'x' });
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.title.length).toBeLessThanOrEqual(60);
  });

  it('never throws when fetch rejects', async () => {
    process.env.WECOM_BOT_WEBHOOK = 'https://qyapi.example';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(notifyOps({ severity: 'P1', title: 't', body: 'b' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('fans out to both webhooks when both configured', async () => {
    process.env.WECOM_BOT_WEBHOOK = 'https://qyapi.example/a';
    process.env.DINGTALK_BOT_WEBHOOK = 'https://oapi.dingtalk.example/b';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await notifyOps({ severity: 'P1', title: '双发', body: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]).sort();
    expect(urls[0]!).toContain('dingtalk');
    expect(urls[1]!).toContain('qyapi');
  });
});
