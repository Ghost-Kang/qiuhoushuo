import { z } from 'zod';
import { notifyOpsFireAndForget } from '@/lib/alerts';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { apiFootballGet, type ApiFootballGetOptions } from './client';
import { resolveQuotaThresholds, type QuotaThresholds } from './quota-policy';

export type QuotaSeverity = 'healthy' | 'P1' | 'P0';

export interface QuotaSnapshot {
  used: number;
  limit: number;
  percent: number;
  severity: QuotaSeverity;
  plan: string;
  planEnd: string;
  subscriptionActive: boolean;
  policyName: 'normal' | 'finals-strict';
}

export interface CheckQuotaOptions {
  client?: ApiFootballGetOptions;
  alertOnExceed?: boolean;
  now?: Date;
}

const StatusResponse = z.object({
  account: z.object({}).passthrough(),
  subscription: z.object({
    plan: z.string(),
    end: z.string(),
    active: z.boolean(),
  }).passthrough(),
  requests: z.object({
    current: z.number(),
    limit_day: z.number(),
  }).passthrough(),
}).passthrough();

export async function checkApiFootballQuota(
  opts: CheckQuotaOptions = {},
): Promise<QuotaSnapshot> {
  const result = await apiFootballGet<unknown>('/status', undefined, opts.client);
  const parsed = StatusResponse.safeParse(result.response);
  if (!parsed.success) {
    throw new Error(`[api-football/quota] zod parse failed: ${parsed.error.message}`);
  }

  const used = parsed.data.requests.current;
  const limit = parsed.data.requests.limit_day;
  const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 100;
  const thresholds = resolveQuotaThresholds(opts.now ?? new Date());
  const severity = parsed.data.subscription.active ? severityForPercent(percent, thresholds) : 'P0';
  const snapshot: QuotaSnapshot = {
    used,
    limit,
    percent,
    severity,
    plan: parsed.data.subscription.plan,
    planEnd: parsed.data.subscription.end,
    subscriptionActive: parsed.data.subscription.active,
    policyName: thresholds.policyName,
  };

  trackServerEventGlobal({
    eventId: 'E073',
    properties: {
      used: snapshot.used,
      limit: snapshot.limit,
      percent: snapshot.percent,
      severity: snapshot.severity,
      plan: snapshot.plan,
      planEnd: snapshot.planEnd,
      policyName: snapshot.policyName,
    },
  });

  if (severity !== 'healthy') {
    trackServerEventGlobal({
      eventId: 'E074',
      properties: {
        severity: snapshot.severity,
        used: snapshot.used,
        limit: snapshot.limit,
        percent: snapshot.percent,
        policyName: snapshot.policyName,
      },
    });
    if (opts.alertOnExceed ?? true) notifyQuota(snapshot, thresholds);
  }

  return snapshot;
}

function severityForPercent(percent: number, thresholds: QuotaThresholds): QuotaSeverity {
  if (percent >= thresholds.p0Percent) return 'P0';
  if (percent >= thresholds.p1Percent) return 'P1';
  return 'healthy';
}

function notifyQuota(snapshot: QuotaSnapshot, thresholds: QuotaThresholds): void {
  notifyOpsFireAndForget(
    {
      severity: snapshot.severity === 'P0' ? 'P0' : 'P1',
      title: `API-Football 额度 ${snapshot.percent}% (${snapshot.severity})`,
      body: [
        `used/limit: ${snapshot.used}/${snapshot.limit}`,
        `percent: ${snapshot.percent}%`,
        `policy: ${snapshot.policyName} (P1@${thresholds.p1Percent}% / P0@${thresholds.p0Percent}%)`,
        `plan: ${snapshot.plan}`,
        `planEnd: ${snapshot.planEnd}`,
        `subscriptionActive: ${snapshot.subscriptionActive}`,
        `now: ${new Date().toISOString()}`,
      ].join('\n'),
      tags: ['api-football-quota', snapshot.policyName],
    },
    {
      dedupKey: `quota:${snapshot.severity}:${snapshot.policyName}`,
      dedupWindowMs: 30 * 60 * 1000,
    },
  );
}
