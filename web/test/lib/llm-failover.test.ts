/**
 * 双 LLM 切换演练 (STATUS §2 W2: E10)
 *
 * 用 mock fetch 模拟真实失败模式，验证 callLLM 的 fallback chain：
 * - 主 provider 成功：不走 fallback
 * - 主返 HTTP 429（豆包限流）：切到 deepseek 兜底
 * - 主超时（AbortController abort）：切到 deepseek
 * - 全部 provider 都挂：抛错（路由层兜 500 + P0 告警）
 *
 * 这套测试不需要任何外部 key，靠 mock 完整跑通。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callLLM, parseReport, defaultProvider, backupProvidersFor } from '@/lib/llm';
import * as alerts from '@/lib/alerts';
import * as tracker from '@/lib/api/tracker';
import * as costMeter from '@/lib/api/cost-meter';

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.DOUBAO_BASE_URL = 'https://ark.example/api/v3';
  process.env.DOUBAO_API_KEY = 'test-doubao';
  process.env.DOUBAO_MODEL_REPORT = 'doubao-pro-32k-mock';
  process.env.DEEPSEEK_BASE_URL = 'https://deepseek.example/v1';
  process.env.DEEPSEEK_API_KEY = 'test-deepseek';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function chatResponse(content: string, model = 'doubao-pro-32k-mock') {
  return new Response(
    JSON.stringify({
      id: 'req-' + Math.random().toString(36).slice(2),
      model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function emptyChatResponse(model = 'deepseek-chat') {
  return new Response(
    JSON.stringify({
      id: 'empty-' + Math.random().toString(36).slice(2),
      model,
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 36, completion_tokens: 0 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('callLLM failover chain', () => {
  it('1. 主成功：直接返主 provider，不走 fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('doubao-output'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLLM({
      caller: 'test',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('doubao');
    expect(result.content).toBe('doubao-output');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('ark.example');
  });

  it('2. 主 429 → 切 deepseek 成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response('{"error":"rate limit"}', { status: 429, statusText: 'Too Many Requests' }),
      )
      .mockResolvedValueOnce(chatResponse('deepseek-output', 'deepseek-chat'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLLM({
      caller: 'test',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('deepseek');
    expect(result.content).toBe('deepseek-output');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toContain('ark.example');
    expect(fetchMock.mock.calls[1]![0]).toContain('deepseek.example');
  });

  it('3. 主超时（AbortError）→ 切 deepseek 成功', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const sig = init?.signal as AbortSignal | undefined;
          if (sig) {
            sig.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }
        });
      })
      .mockResolvedValueOnce(chatResponse('deepseek-output-after-timeout', 'deepseek-chat'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLLM({
      caller: 'test',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 30, // 30ms — 立即超时
    });

    expect(result.provider).toBe('deepseek');
    expect(result.content).toBe('deepseek-output-after-timeout');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4. 全部 provider 都挂 → 抛错 + P0 告警 fire-and-forget（PROCESS §5 最上一档）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('also boom', { status: 502 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);

    await expect(
      callLLM({
        caller: 'report:hardcore',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/全部 provider 失败 \(doubao, deepseek\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(notifySpy).toHaveBeenCalledOnce();
    const payload = notifySpy.mock.calls[0]![0];
    expect(payload.severity).toBe('P0');
    expect(payload.title).toContain('LLM 全挂');
    expect(payload.title).toContain('doubao→deepseek');
    expect(payload.tags).toContain('llm-down');
    expect(payload.tags).toContain('report:hardcore');
    expect(payload.body).toContain('report:hardcore');
    expect(notifySpy.mock.calls[0]![1]).toEqual({
      dedupKey: 'llm-down:report:hardcore',
      dedupWindowMs: 5 * 60 * 1000,
    });
  });

  it('4c. 全部 provider 都挂时同 caller 使用稳定 dedup key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom-1', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom-2', { status: 502 }))
      .mockResolvedValueOnce(new Response('boom-3', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom-4', { status: 502 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);

    for (let i = 0; i < 2; i += 1) {
      await expect(callLLM({
        caller: 'report:duanzi',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow(/全部 provider 失败/);
    }

    expect(notifySpy).toHaveBeenCalledTimes(2);
    expect(notifySpy.mock.calls.map((call) => call[1])).toEqual([
      { dedupKey: 'llm-down:report:duanzi', dedupWindowMs: 5 * 60 * 1000 },
      { dedupKey: 'llm-down:report:duanzi', dedupWindowMs: 5 * 60 * 1000 },
    ]);
  });

  it('4d. 全部 provider 都挂时不同 caller 独立 dedup', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom-1', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom-2', { status: 502 }))
      .mockResolvedValueOnce(new Response('boom-3', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom-4', { status: 502 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);

    await expect(callLLM({
      caller: 'report:hardcore',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/全部 provider 失败/);
    await expect(callLLM({
      caller: 'safety',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/全部 provider 失败/);

    expect(notifySpy.mock.calls.map((call) => call[1])).toEqual([
      { dedupKey: 'llm-down:report:hardcore', dedupWindowMs: 5 * 60 * 1000 },
      { dedupKey: 'llm-down:safety', dedupWindowMs: 5 * 60 * 1000 },
    ]);
  });

  it('4b. 主成功时不发 P0 告警', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);

    await callLLM({
      caller: 'test',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('5. 主返空 content → 切 deepseek（防止 LLM 返了 200 但 content 为空的边缘）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'x', choices: [{ message: { content: '' } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(chatResponse('deepseek-rescue', 'deepseek-chat'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLLM({
      caller: 'test',
      provider: 'doubao',
      fallback: ['deepseek'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('deepseek');
    expect(result.content).toBe('deepseek-rescue');
  });

  it('6. 没配 fallback 时主挂直接抛（不会无声转向）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('boom', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      callLLM({
        caller: 'test',
        provider: 'doubao',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/全部 provider 失败 \(doubao\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('DeepSeek empty content retry-1 (E064)', () => {
    it('deepseek 第 1 次 empty + 第 2 次 success → 返回成功结果', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(emptyChatResponse())
        .mockResolvedValueOnce(chatResponse('deepseek-retry-ok', 'deepseek-chat'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('deepseek');
      expect(result.content).toBe('deepseek-retry-ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('deepseek 两次都 empty → 进入 failover', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(emptyChatResponse())
        .mockResolvedValueOnce(emptyChatResponse())
        .mockResolvedValueOnce(chatResponse('doubao-after-deepseek-empty', 'doubao-pro-32k-mock'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await callLLM({
        caller: 'report:emotion',
        provider: 'deepseek',
        fallback: ['doubao'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('doubao');
      expect(result.content).toBe('doubao-after-deepseek-empty');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('deepseek HTTP 500 → 不 retry', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('deepseek boom', { status: 500 }))
        .mockResolvedValueOnce(chatResponse('doubao-rescue', 'doubao-pro-32k-mock'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await callLLM({
        caller: 'report:duanzi',
        provider: 'deepseek',
        fallback: ['doubao'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('doubao');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('deepseek timeout / abort → 不 retry', async () => {
      const fetchMock = vi.fn()
        .mockImplementationOnce((_url, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            const sig = init?.signal as AbortSignal | undefined;
            sig?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        })
        .mockResolvedValueOnce(chatResponse('doubao-rescue-after-abort', 'doubao-pro-32k-mock'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        fallback: ['doubao'],
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 10,
      });

      expect(result.provider).toBe('doubao');
      expect(result.content).toBe('doubao-rescue-after-abort');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('doubao empty content → 不 retry', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(emptyChatResponse('doubao-pro-32k-mock'))
        .mockResolvedValueOnce(chatResponse('deepseek-rescue', 'deepseek-chat'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await callLLM({
        caller: 'report:emotion',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('deepseek');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('deepseek empty + retry success → emit E064 once', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(emptyChatResponse())
        .mockResolvedValueOnce(chatResponse('deepseek-after-e064', 'deepseek-chat'));
      vi.stubGlobal('fetch', fetchMock);
      const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);

      await callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const e064 = trackSpy.mock.calls.filter((c) => (c[0] as tracker.ServerEvent).eventId === 'E064');
      expect(e064).toHaveLength(1);
      expect((e064[0]![0] as tracker.ServerEvent).properties).toEqual({
        caller: 'report:hardcore',
        attempt: 2,
      });
    });
  });

  describe('events tracking (E060/E061/E062/E063)', () => {
    it('7. E060 fires on success', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);

      await callLLM({
        caller: 'evals',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      const e060 = trackSpy.mock.calls.find((c) => (c[0] as tracker.ServerEvent).eventId === 'E060');
      expect(e060).toBeDefined();
      const props = (e060![0] as tracker.ServerEvent).properties!;
      expect(props.provider).toBe('doubao');
      expect(props.caller).toBe('evals');
      expect(props.attempt).toBe(1);
    });

    it('8. E061 + E060 + E062 fire on failover', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(chatResponse('rescue', 'deepseek-chat'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);

      await callLLM({
        caller: 'report:hardcore',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      const ids = trackSpy.mock.calls.map((c) => (c[0] as tracker.ServerEvent).eventId);
      expect(ids).toContain('E061'); // doubao 单挂
      expect(ids).toContain('E060'); // deepseek 成功
      expect(ids).toContain('E062'); // failover doubao→deepseek

      const e062 = trackSpy.mock.calls.find((c) => (c[0] as tracker.ServerEvent).eventId === 'E062');
      const e062Props = (e062![0] as tracker.ServerEvent).properties!;
      expect(e062Props.from).toBe('doubao');
      expect(e062Props.to).toBe('deepseek');
    });

    it('9. E063 fires when all providers down', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(new Response('also boom', { status: 502 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const trackSpy = vi.spyOn(tracker, 'trackServerEventGlobal').mockImplementation(() => undefined);

      await expect(
        callLLM({
          caller: 'report:duanzi',
          provider: 'doubao',
          fallback: ['deepseek'],
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow();

      const e063 = trackSpy.mock.calls.find((c) => (c[0] as tracker.ServerEvent).eventId === 'E063');
      expect(e063).toBeDefined();
      const props = (e063![0] as tracker.ServerEvent).properties!;
      expect(props.providers).toEqual(['doubao', 'deepseek']);
      expect(props.caller).toBe('report:duanzi');
    });
  });

  describe('cost recording (fixes silent bucket bug)', () => {
    it('10. recordCost is called with provider + total tokens on success', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const recordSpy = vi.spyOn(costMeter, 'recordCost').mockResolvedValue(undefined);

      await callLLM({
        caller: 'test',
        provider: 'doubao',
        messages: [{ role: 'user', content: 'hi' }],
      });

      // chatResponse() fixture 含 usage: { prompt_tokens: 100, completion_tokens: 200 } → 300 总
      expect(recordSpy).toHaveBeenCalledWith('doubao', 300);
    });

    it('11. recordCost NOT called when usage missing (some providers omit it)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'x', choices: [{ message: { content: 'no usage' } }] }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const recordSpy = vi.spyOn(costMeter, 'recordCost').mockResolvedValue(undefined);

      await callLLM({
        caller: 'test',
        provider: 'doubao',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(recordSpy).not.toHaveBeenCalled();
    });

    it('12. recordCost failure is swallowed (fire-and-forget)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(costMeter, 'recordCost').mockRejectedValue(new Error('redis down'));

      // 不抛
      await expect(
        callLLM({
          caller: 'test',
          provider: 'doubao',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).resolves.toBeDefined();

      // 给微任务一帧让 .catch 跑完
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('recordCost failed'),
        expect.stringContaining('redis down'),
      );
    });

    it('13. recordCost charged to actual winning provider on failover', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(chatResponse('rescue', 'deepseek-chat'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const recordSpy = vi.spyOn(costMeter, 'recordCost').mockResolvedValue(undefined);

      await callLLM({
        caller: 'test',
        provider: 'doubao',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      });

      // 第一次 doubao 挂没 usage → 不计；第二次 deepseek 成功 → 计 deepseek
      expect(recordSpy).toHaveBeenCalledOnce();
      expect(recordSpy).toHaveBeenCalledWith('deepseek', 300);
    });
  });

  describe('dev-only providers and parser coverage', () => {
    it('adds JSON response_format for OpenAI-compatible JSON calls', async () => {
      process.env.OPENAI_API_KEY = 'openai-key';
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('openai-output', 'gpt-4o-mini'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      await callLLM({
        caller: 'test',
        provider: 'openai',
        messages: [{ role: 'user', content: 'json please' }],
        responseFormat: 'json',
      });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' });
    });

    it('rejects OpenAI provider in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      await expect(callLLM({
        caller: 'test',
        provider: 'openai',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('production 禁用');
    });

    it('calls Claude dev provider successfully', async () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'claude-req',
        content: [{ text: 'claude-output' }],
        usage: { input_tokens: 7, output_tokens: 9 },
      }), { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const result = await callLLM({
        caller: 'test',
        provider: 'claude',
        messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      });
      expect(result.content).toBe('claude-output');
      expect(result.usage).toEqual({ input: 7, output: 9 });
    });

    it('parseReport accepts fenced JSON and validates schema', () => {
      const report = parseReport('```json\n' + JSON.stringify({
        title: '这是一条足够长的标题',
        subtitle: '这是一条足够长的副标题',
        lead: '这是一段足够长的导语，用来满足战报结构校验的最小长度要求，同时保留清晰的比赛背景和叙事入口。',
        body: [
          '这是一段足够长的正文第一段，用来满足战报结构校验的最小长度要求，确保内容完整可读，并包含足够多的比赛过程信息和关键节点说明。',
          '这是一段足够长的正文第二段，用来满足战报结构校验的最小长度要求，确保内容完整可读，并包含足够多的战术复盘信息和情绪收束说明。',
        ],
        ending: '这是一段足够长的结尾，用来满足战报结构校验的最小长度要求，也给读者一个明确的收束。',
        share_quote: '这是一句测试金句',
        tags: ['战报', '测试'],
      }) + '\n```');
      expect(report.tags).toEqual(['战报', '测试']);
    });
  });

  describe('跨供应商 fallback 推导 (F61 隐性洞修复)', () => {
    it('backupProvidersFor(doubao) → [deepseek]', () => {
      expect(backupProvidersFor('doubao')).toEqual(['deepseek']);
    });

    it('backupProvidersFor(deepseek) → [doubao]（反向断言:绝不回退到自己）', () => {
      // 这是修复的核心:LLM_PROVIDER=deepseek 时,fallback 必须是 doubao 而非 deepseek，
      // 否则决赛日豆包没法兜底、主备同源 = 无 failover。
      expect(backupProvidersFor('deepseek')).toEqual(['doubao']);
      expect(backupProvidersFor('deepseek')).not.toContain('deepseek');
    });

    it('backupProvidersFor(dev provider) → 全部境内 provider', () => {
      expect(backupProvidersFor('claude')).toEqual(['doubao', 'deepseek']);
      expect(backupProvidersFor('openai')).toEqual(['doubao', 'deepseek']);
    });

    it('defaultProvider 读 LLM_PROVIDER；缺省回 doubao', () => {
      vi.stubEnv('LLM_PROVIDER', 'deepseek');
      expect(defaultProvider()).toBe('deepseek');
      vi.stubEnv('LLM_PROVIDER', '');
      expect(defaultProvider()).toBe('doubao');
    });

    it('主=deepseek + backupProvidersFor → deepseek 挂时真切到 doubao（跨供应商 failover 实链）', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('deepseek boom', { status: 500 }))
        .mockResolvedValueOnce(chatResponse('doubao-rescue', 'doubao-pro-32k-mock'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        fallback: backupProvidersFor('deepseek'),
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('doubao');
      expect(result.content).toBe('doubao-rescue');
      expect(fetchMock.mock.calls[0]![0]).toContain('deepseek.example');
      expect(fetchMock.mock.calls[1]![0]).toContain('ark.example');
    });
  });

  describe('provider 链去重 (主备同源退化防御)', () => {
    it('fallback 含主 provider → 去重后只打一次（成功路径）', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('deepseek-ok', 'deepseek-chat'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await callLLM({
        caller: 'test',
        provider: 'deepseek',
        fallback: ['deepseek'], // 退化输入:主备同源
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.provider).toBe('deepseek');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fallback 含主 provider + 主挂 → 不白打第二次同一个死 provider，错误链只列一次', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response('boom', { status: 500 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const notifySpy = vi.spyOn(alerts, 'notifyOpsFireAndForget').mockImplementation(() => undefined);

      await expect(callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        fallback: ['deepseek'],
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow(/全部 provider 失败 \(deepseek\)/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(notifySpy.mock.calls[0]![0].title).toContain('deepseek');
      expect(notifySpy.mock.calls[0]![0].title).not.toContain('deepseek→deepseek');
    });
  });

  describe('deepseek 推理模型 JSON 窄预算抬升 (F67 防御)', () => {
    function sentMaxTokens(fetchMock: ReturnType<typeof vi.fn>, callIdx = 0): number {
      const init = fetchMock.mock.calls[callIdx]![1] as RequestInit;
      return JSON.parse(init.body as string).max_tokens as number;
    }

    it('deepseek + JSON + maxTokens 低于 floor → 抬到 1500', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok', 'deepseek-v4-pro'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await callLLM({
        caller: 'test',
        provider: 'deepseek',
        responseFormat: 'json',
        maxTokens: 200, // 实测会被 reasoning 吃光致 content 空
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(sentMaxTokens(fetchMock)).toBe(1500);
    });

    it('deepseek + JSON + 缺省 maxTokens(2000) ≥ floor → 不动', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok', 'deepseek-v4-pro'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await callLLM({
        caller: 'test',
        provider: 'deepseek',
        responseFormat: 'json',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(sentMaxTokens(fetchMock)).toBe(2000);
    });

    it('deepseek + JSON + 战报 4000 ≥ floor → 原样透传(战报路径不受影响)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('ok', 'deepseek-v4-pro'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await callLLM({
        caller: 'report:hardcore',
        provider: 'deepseek',
        responseFormat: 'json',
        maxTokens: 4000,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(sentMaxTokens(fetchMock)).toBe(4000);
    });

    it('反向:deepseek + 非 JSON + 窄预算 → 不抬(只兜 JSON 模式)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('OK', 'deepseek-v4-pro'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await callLLM({
        caller: 'test',
        provider: 'deepseek',
        maxTokens: 128, // 非 JSON,reasoning 开销小,无需抬
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(sentMaxTokens(fetchMock)).toBe(128);
    });

    it('反向:doubao + JSON + 窄预算 → 不抬(只兜 deepseek 推理模型)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('{}', 'doubao-pro-32k-mock'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await callLLM({
        caller: 'test',
        provider: 'doubao',
        responseFormat: 'json',
        maxTokens: 200,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(sentMaxTokens(fetchMock)).toBe(200);
    });

    it('抬升后 empty-retry 仍生效:第一次空 + 第二次成功(两次都带抬升后的 1500)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(emptyChatResponse('deepseek-v4-pro'))
        .mockResolvedValueOnce(chatResponse('rescued', 'deepseek-v4-pro'));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await callLLM({
        caller: 'test',
        provider: 'deepseek',
        responseFormat: 'json',
        maxTokens: 200,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.content).toBe('rescued');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentMaxTokens(fetchMock, 0)).toBe(1500);
      expect(sentMaxTokens(fetchMock, 1)).toBe(1500);
    });
  });
});
