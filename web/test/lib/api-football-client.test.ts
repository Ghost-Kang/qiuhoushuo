/**
 * API-Football client 单测（mock fetch，不烧真实额度）
 *
 * 覆盖：
 *  - happy path：header 注入 / query 拼接 / 解析响应 / 限流 header 解析
 *  - env / 显式 apiKey 双路径 + 缺 key 报错
 *  - HTTP 错误码分流：401/403/429/5xx
 *  - api-sports 特殊场景：HTTP 200 + body.errors.token / .requests / 任意其它键
 *  - 超时（AbortError）/ 一般网络错误
 *  - default base URL fallback / 显式 baseUrl 覆写
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiFootballGet,
  ApiFootballAuthError,
  ApiFootballError,
  ApiFootballRateLimitError,
  ApiFootballTimeoutError,
} from '@/lib/api-football';

interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
  jsonBody?: unknown;
  /** 如果给了 jsonThrow，调 .json() 会抛 */
  jsonThrow?: boolean;
  textBody?: string;
}

function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  const body: BodyInit | null =
    init.jsonBody !== undefined
      ? JSON.stringify(init.jsonBody)
      : init.textBody !== undefined
        ? init.textBody
        : null;
  const res = new Response(body, { status, headers });
  if (init.jsonThrow) {
    Object.defineProperty(res, 'json', {
      value: () => Promise.reject(new Error('bad json')),
    });
  }
  return res;
}

beforeEach(() => {
  vi.stubEnv('API_FOOTBALL_KEY', 'env-key-abc');
  vi.stubEnv('API_FOOTBALL_BASE_URL', 'https://v3.football.api-sports.io');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('apiFootballGet · happy path', () => {
  it('注入 x-apisports-key header + 拼接 query string + 返完整解析结果', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        headers: {
          'x-ratelimit-requests-remaining': '447',
          'x-request-id': 'req-xyz',
          'content-type': 'application/json',
        },
        jsonBody: {
          get: 'fixtures',
          parameters: { date: '2026-06-11' },
          errors: [],
          results: 2,
          paging: { current: 1, total: 1 },
          response: [{ fixture: { id: 1 } }, { fixture: { id: 2 } }],
        },
      }),
    );

    const result = await apiFootballGet<Array<{ fixture: { id: number } }>>(
      '/fixtures',
      { date: '2026-06-11', league: 1, season: 2026 },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe(
      'https://v3.football.api-sports.io/fixtures?date=2026-06-11&league=1&season=2026',
    );
    expect((calledInit as RequestInit).method).toBe('GET');
    const hdrs = (calledInit as RequestInit).headers as Record<string, string>;
    expect(hdrs['x-apisports-key']).toBe('env-key-abc');

    expect(result.results).toBe(2);
    expect(result.response).toHaveLength(2);
    expect(result.rateLimitMinuteRemaining).toBe(447);
    expect(result.requestId).toBe('req-xyz');
    expect(result.raw.paging?.total).toBe(1);
  });

  it('显式 apiKey / baseUrl 覆盖 env', async () => {
    vi.stubEnv('API_FOOTBALL_KEY', 'env-key-abc');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ jsonBody: { errors: [], response: { ok: true }, results: 1 } }),
    );
    await apiFootballGet(
      '/status',
      undefined,
      {
        apiKey: 'override-key',
        baseUrl: 'https://proxy.example.com/api',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://proxy.example.com/api/status');
    expect(((calledInit as RequestInit).headers as Record<string, string>)['x-apisports-key']).toBe(
      'override-key',
    );
  });

  it('skips undefined / null query params + 自动加前导斜杠 + 去 baseUrl 尾斜杠', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ jsonBody: { errors: [], response: [], results: 0 } }),
    );
    await apiFootballGet(
      'fixtures',
      { date: '2026-06-11', league: undefined, season: null, status: 'NS' },
      {
        baseUrl: 'https://v3.football.api-sports.io/',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe(
      'https://v3.football.api-sports.io/fixtures?date=2026-06-11&status=NS',
    );
  });

  it('rate-limit header 缺失时返回 null', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ jsonBody: { errors: [], response: [], results: 0 } }),
    );
    const result = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.rateLimitMinuteRemaining).toBeNull();
    expect(result.requestId).toBeNull();
  });

  it('env 没设 base URL 时走官方默认值', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('API_FOOTBALL_KEY', 'env-key-abc');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ jsonBody: { errors: [], response: [], results: 0 } }),
    );
    await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://v3.football.api-sports.io/status',
    );
  });
});

describe('apiFootballGet · 鉴权错误', () => {
  it('缺 API_FOOTBALL_KEY 直接抛 ApiFootballAuthError，不发起请求', async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    await expect(
      apiFootballGet('/status', undefined, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ApiFootballAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 401 → ApiFootballAuthError 且带 status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 401,
        jsonBody: { errors: { token: 'invalid' } },
      }),
    );
    const err = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballAuthError);
    expect((err as ApiFootballAuthError).status).toBe(401);
    expect((err as ApiFootballAuthError).bodyErrors?.token).toBe('invalid');
  });

  it('HTTP 403 也走 ApiFootballAuthError 分支', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ status: 403, jsonBody: { errors: { Authorization: 'forbidden' } } }),
    );
    const err = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballAuthError);
    expect((err as ApiFootballAuthError).status).toBe(403);
  });

  it('HTTP 200 + body.errors.token → ApiFootballAuthError (api-sports 经典坑)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        jsonBody: {
          get: 'status',
          errors: { token: 'Error/Missing application key.' },
          results: 0,
          response: [],
        },
      }),
    );
    const err = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballAuthError);
    expect((err as ApiFootballAuthError).status).toBe(200);
    expect((err as ApiFootballAuthError).bodyErrors?.token).toMatch(/Missing application key/);
  });
});

describe('apiFootballGet · 限流', () => {
  it('HTTP 429 + Retry-After → ApiFootballRateLimitError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 429,
        headers: { 'retry-after': '30' },
        jsonBody: { errors: { rateLimit: 'Too many requests' } },
      }),
    );
    const err = await apiFootballGet('/fixtures', { date: '2026-06-11' }, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballRateLimitError);
    expect((err as ApiFootballRateLimitError).retryAfterSec).toBe(30);
    expect((err as ApiFootballRateLimitError).bodyErrors?.rateLimit).toMatch(/Too many/);
  });

  it('HTTP 200 + body.errors.requests → ApiFootballRateLimitError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        jsonBody: { errors: { requests: 'You have reached your daily limit' }, response: [], results: 0 },
      }),
    );
    const err = await apiFootballGet('/fixtures', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballRateLimitError);
    expect((err as ApiFootballRateLimitError).retryAfterSec).toBeNull();
  });
});

describe('apiFootballGet · 其它错误', () => {
  it('HTTP 500 → ApiFootballError 带状态码 + 截断 body', async () => {
    const longBody = 'x'.repeat(500);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ status: 500, textBody: longBody }),
    );
    const err = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballError);
    expect((err as ApiFootballError).status).toBe(500);
    expect((err as ApiFootballError).message.length).toBeLessThan(400);
  });

  it('HTTP 200 + body.errors.parameter（任意其它键）→ 通用 ApiFootballError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        jsonBody: { errors: { date: 'Invalid date format' }, response: [], results: 0 },
      }),
    );
    const err = await apiFootballGet('/fixtures', { date: 'oops' }, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballError);
    expect(err).not.toBeInstanceOf(ApiFootballAuthError);
    expect(err).not.toBeInstanceOf(ApiFootballRateLimitError);
    expect((err as ApiFootballError).bodyErrors?.date).toMatch(/Invalid date/);
  });

  it('body.errors 为非空数组 → 通用 ApiFootballError（_array 兜底）', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        jsonBody: { errors: ['hint-a', 'hint-b'], response: [], results: 0 },
      }),
    );
    const err = await apiFootballGet('/fixtures', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballError);
    expect((err as ApiFootballError).bodyErrors?._array).toMatch(/hint-a/);
  });

  it('网络异常（非 AbortError）→ ApiFootballError 包装', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('socket hang up'));
    const err = await apiFootballGet('/status', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballError);
    expect((err as ApiFootballError).message).toMatch(/网络错误.*socket hang up/);
  });

  it('AbortError → ApiFootballTimeoutError 携带超时值', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchMock = vi.fn().mockRejectedValueOnce(abortErr);
    const err = await apiFootballGet('/status', undefined, {
      timeoutMs: 100,
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballTimeoutError);
    expect((err as ApiFootballTimeoutError).message).toMatch(/100ms/);
  });

  it('429 时 body 解析失败也能正常抛 ApiFootballRateLimitError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({ status: 429, jsonThrow: true }),
    );
    const err = await apiFootballGet('/fixtures', undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballRateLimitError);
    expect((err as ApiFootballRateLimitError).bodyErrors).toBeUndefined();
  });
});
