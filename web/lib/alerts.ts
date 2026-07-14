/**
 * 运营报警通道
 *
 * 用途：
 * - 战报全风格兜底（report.ts）
 * - 内容审核重命中（safety.ts L4 / L5 / L6 升级）
 * - LLM 全 provider 失败（llm.ts）
 * - 后续接入更多 PROCESS.md §5 升级树场景
 *
 * 触达：企微机器人 webhook 或钉钉自定义机器人 webhook（二选一或同时）。
 * 没配 webhook 时退化为 console.warn —— production 启动 boot 时会校验至少一个存在。
 *
 * 调用准则：
 * - **必须** fire-and-forget：用 `void notifyOps(...)`，不要 await
 * - 5 秒超时，超时算失败但不抛
 * - 报警函数自身永不抛错，避免拖垮主链路
 * - dedupe 默认开启：5min 窗口内同 `${severity}:${tag}:${title}` 仅发 1 次
 * - 自定 dedup：`notifyOps(payload, { dedupKey, dedupWindowMs })`
 * - 关 dedup：`notifyOps(payload, { skipDedup: true })`（仅测试 / 人工触发用）
 */

import { recordDedup, shouldDedup } from './alerts/dedup-cache';

export type AlertSeverity = 'P0' | 'P1' | 'P2';

export interface AlertPayload {
  /** P0 = 立即响应（< 15min），P1 = 30min 内，P2 = 当日 */
  severity: AlertSeverity;
  /** 短标题（≤ 40 字），机器人推送的标题行 */
  title: string;
  /** 详细正文（markdown），含上下文、原因、建议动作 */
  body: string;
  /** 分类标签（report-fallback / safety-block / llm-down 等），用于运营分流 */
  tags?: string[];
}

const TIMEOUT_MS = 5_000;

export interface NotifyOpsOptions {
  dedupKey?: string;
  dedupWindowMs?: number;
  skipDedup?: boolean;
}

export function notifyOps(payload: AlertPayload, opts: NotifyOpsOptions = {}): Promise<void> {
  if (!opts.skipDedup) {
    const key = opts.dedupKey ?? defaultDedupKey(payload);
    const now = Date.now();
    if (shouldDedup(key, now, opts.dedupWindowMs)) {
      return Promise.resolve();
    }
    recordDedup(key, now, opts.dedupWindowMs);
  }
  return dispatch(payload).catch((err) => {
    // 兜底兜底：报警通道挂了，至少留一条本地日志
    console.warn('[alerts] dispatch failed:', (err as Error).message, payload.title);
  });
}

/**
 * fire-and-forget 语义化封装。
 *
 * 调用方在主链路里不想 await，又不想看 ESLint 报 floating promise，用这个：
 *   notifyOpsFireAndForget({ severity: 'P0', title: 'X', body: 'Y' });
 *
 * 等价于 `void notifyOps(...)`，但语义比 `void` 更明确。
 */
export function notifyOpsFireAndForget(payload: AlertPayload, opts: NotifyOpsOptions = {}): void {
  void notifyOps(payload, opts);
}

function defaultDedupKey(payload: AlertPayload): string {
  const tag = payload.tags?.[0] ?? 'untagged';
  return `${payload.severity}:${tag}:${payload.title.slice(0, 64)}`;
}

async function dispatch(payload: AlertPayload): Promise<void> {
  const wecomUrl = process.env.WECOM_BOT_WEBHOOK;
  const dingUrl = process.env.DINGTALK_BOT_WEBHOOK;

  if (!wecomUrl && !dingUrl) {
    console.warn(`[alerts] ${payload.severity} ${payload.title}\n${payload.body}`);
    return;
  }

  const tasks: Promise<unknown>[] = [];
  if (wecomUrl) tasks.push(postWecom(wecomUrl, payload));
  if (dingUrl) tasks.push(postDingtalk(dingUrl, payload));
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failed.length === tasks.length && tasks.length > 0) {
    // 所有通道全挂 = 兜底也兜不住，必须留本地日志（PROCESS.md §5 升级树最后一档）
    console.warn(
      `[alerts] all ${tasks.length} channel(s) failed:`,
      failed.map((f) => (f.reason as Error)?.message ?? String(f.reason)).join(' | '),
      payload.title,
    );
  }
}

function withTimeout(): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

function severityBadge(s: AlertSeverity): string {
  return s === 'P0' ? '🔥 P0' : s === 'P1' ? '⚠️ P1' : 'ℹ️ P2';
}

function tagsLine(tags?: string[]): string {
  return tags && tags.length ? `\n标签：${tags.map((t) => `\`${t}\``).join(' ')}` : '';
}

async function postWecom(url: string, p: AlertPayload): Promise<void> {
  const md =
    `**${severityBadge(p.severity)} ${p.title}**\n\n` +
    `${p.body}` +
    tagsLine(p.tags);
  const t = withTimeout();
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: md } }),
      signal: t.signal,
    });
  } finally {
    t.cancel();
  }
}

async function postDingtalk(url: string, p: AlertPayload): Promise<void> {
  const md =
    `### ${severityBadge(p.severity)} ${p.title}\n\n` +
    `${p.body}` +
    tagsLine(p.tags);
  const t = withTimeout();
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title: `${p.severity} ${p.title}`.slice(0, 60), text: md },
      }),
      signal: t.signal,
    });
  } finally {
    t.cancel();
  }
}
