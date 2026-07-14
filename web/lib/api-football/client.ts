/**
 * API-Football v3 客户端（api-sports.io 直连版）
 *
 * 数据源：球员 / 比赛 / 赛程 / 实时比分 / 赔率 / 预测。Pro plan 7,500 req/day。
 * Header：`x-apisports-key`（注意不是 RapidAPI 的 `x-rapidapi-key`）。
 *
 * api-sports 的几条特殊约定（设计本 client 时必须处理）：
 *   1. 鉴权失败也会返 HTTP 200，错误信息在 `body.errors` 内（如 `{ token: "..." }`、
 *      `{ Authorization: "..." }`），不会走 401/403 这条路。
 *   2. 限流走 HTTP 429，`Retry-After` 头里给秒数；同时 body.errors 里会带
 *      `requests`/`rateLimit` 字段说明原因。
 *   3. 每分钟限流余量在 `x-ratelimit-requests-remaining` 头里；每日总额度只在 `/status`
 *      接口的 body 内给出（不在 header），调用方按需另行查询。
 *   4. 全部业务接口都是 GET，参数走 query string。本 client 故仅暴露 GET。
 *
 * 设计上不内置自动重试：限流恢复策略与下游业务语义强相关，留给 caller 决策。
 */

export class ApiFootballError extends Error {
  readonly status?: number;
  readonly bodyErrors?: Record<string, string>;
  constructor(message: string, status?: number, bodyErrors?: Record<string, string>) {
    super(message);
    this.name = 'ApiFootballError';
    this.status = status;
    this.bodyErrors = bodyErrors;
  }
}

export class ApiFootballAuthError extends ApiFootballError {
  constructor(message: string, status?: number, bodyErrors?: Record<string, string>) {
    super(message, status ?? 401, bodyErrors);
    this.name = 'ApiFootballAuthError';
  }
}

export class ApiFootballRateLimitError extends ApiFootballError {
  readonly retryAfterSec: number | null;
  constructor(message: string, retryAfterSec: number | null, bodyErrors?: Record<string, string>) {
    super(message, 429, bodyErrors);
    this.name = 'ApiFootballRateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class ApiFootballTimeoutError extends ApiFootballError {
  constructor(message: string) {
    super(message);
    this.name = 'ApiFootballTimeoutError';
  }
}

export interface ApiFootballEnvelope<T> {
  get?: string;
  parameters?: Record<string, string>;
  errors?: Record<string, string> | unknown[];
  results?: number;
  paging?: { current: number; total: number };
  response: T;
}

export interface ApiFootballGetOptions {
  /** 单次请求超时毫秒，默认 8000。 */
  timeoutMs?: number;
  /** 注入 fetch 实现（单测用）。 */
  fetchImpl?: typeof fetch;
  /** 覆写 API key（单测 / 多账号场景）。不传走 `process.env.API_FOOTBALL_KEY`。 */
  apiKey?: string;
  /** 覆写 base URL。不传走 `process.env.API_FOOTBALL_BASE_URL`，再不传走官方默认值。 */
  baseUrl?: string;
}

export interface ApiFootballGetResult<T> {
  response: T;
  results: number;
  /** `x-ratelimit-requests-remaining`（每分钟桶），头缺失为 null。 */
  rateLimitMinuteRemaining: number | null;
  /** 解析自 `x-request-id`，头缺失为 null。 */
  requestId: string | null;
  raw: ApiFootballEnvelope<T>;
}

const DEFAULT_BASE_URL = 'https://v3.football.api-sports.io';
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 通用 GET 入口。所有 API-Football endpoint（/fixtures、/odds、/predictions...）都走这条。
 *
 * @example
 *   const { response, rateLimitMinuteRemaining } = await apiFootballGet<Fixture[]>(
 *     '/fixtures',
 *     { date: '2026-06-11', league: 1, season: 2026 },
 *   );
 */
export async function apiFootballGet<T>(
  path: string,
  params?: Record<string, string | number | undefined | null>,
  opts: ApiFootballGetOptions = {},
): Promise<ApiFootballGetResult<T>> {
  const apiKey = opts.apiKey ?? process.env.API_FOOTBALL_KEY;
  const baseUrl = opts.baseUrl ?? process.env.API_FOOTBALL_BASE_URL ?? DEFAULT_BASE_URL;
  if (!apiKey) {
    throw new ApiFootballAuthError('[api-football] API_FOOTBALL_KEY 未配置');
  }

  const url = buildUrl(baseUrl, path, params);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-apisports-key': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiFootballTimeoutError(`[api-football] 请求超时 ${timeoutMs}ms: ${path}`);
    }
    throw new ApiFootballError(`[api-football] 网络错误: ${(err as Error)?.message ?? String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const rateLimitMinuteRemaining = parseIntHeader(res.headers.get('x-ratelimit-requests-remaining'));

  if (res.status === 429) {
    const retryAfter = parseIntHeader(res.headers.get('retry-after'));
    const errs = await safeBodyErrors(res);
    throw new ApiFootballRateLimitError(`[api-football] 限流 (429): ${path}`, retryAfter, errs);
  }
  if (res.status === 401 || res.status === 403) {
    const errs = await safeBodyErrors(res);
    throw new ApiFootballAuthError(`[api-football] 鉴权失败 (HTTP ${res.status})`, res.status, errs);
  }
  if (!res.ok) {
    const text = await safeText(res);
    throw new ApiFootballError(
      `[api-football] HTTP ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }

  const body = (await res.json()) as ApiFootballEnvelope<T>;
  const errs = normalizeErrors(body.errors);
  if (errs && Object.keys(errs).length > 0) {
    // api-sports 鉴权 / 参数 / 限流错误都可能走 HTTP 200 + body.errors。按字段分流。
    if ('token' in errs || 'Authorization' in errs) {
      throw new ApiFootballAuthError(
        `[api-football] body.errors: ${stringifyErrs(errs)}`,
        200,
        errs,
      );
    }
    if ('requests' in errs || 'rateLimit' in errs) {
      throw new ApiFootballRateLimitError(
        `[api-football] body.errors: ${stringifyErrs(errs)}`,
        null,
        errs,
      );
    }
    throw new ApiFootballError(
      `[api-football] body.errors: ${stringifyErrs(errs)}`,
      200,
      errs,
    );
  }

  return {
    response: body.response,
    results: body.results ?? 0,
    rateLimitMinuteRemaining,
    requestId: res.headers.get('x-request-id'),
    raw: body,
  };
}

function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined | null>,
): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${cleanBase}${cleanPath}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function parseIntHeader(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeErrors(raw: ApiFootballEnvelope<unknown>['errors']): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.length === 0 ? undefined : { _array: stringifyErrs(raw) };
  if (typeof raw === 'object') return raw as Record<string, string>;
  return undefined;
}

function stringifyErrs(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return String(v).slice(0, 300);
  }
}

async function safeBodyErrors(res: Response): Promise<Record<string, string> | undefined> {
  try {
    const body = (await res.json()) as ApiFootballEnvelope<unknown>;
    return normalizeErrors(body.errors);
  } catch {
    return undefined;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
