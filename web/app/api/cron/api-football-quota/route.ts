import { notifyOpsFireAndForget } from '@/lib/alerts';
import {
  ApiFootballAuthError,
  ApiFootballRateLimitError,
  ApiFootballTimeoutError,
} from '@/lib/api-football/client';
import { checkApiFootballQuota } from '@/lib/api-football/quota';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

type CronErrorType =
  | 'api_football_auth'
  | 'api_football_rate_limit'
  | 'api_football_timeout'
  | 'unknown';

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const snapshot = await checkApiFootballQuota({ alertOnExceed: true });
    return Response.json({ ...snapshot, alerted: snapshot.severity !== 'healthy' });
  } catch (err) {
    if (err instanceof ApiFootballAuthError) {
      notifyCronFailure('P0', 'api_football_auth', 'API-Football key 失效', err.message);
      return Response.json({ error: 'api_football_auth' }, { status: 503 });
    }
    if (err instanceof ApiFootballRateLimitError) {
      notifyCronFailure('P1', 'api_football_rate_limit', 'API-Football quota poller hit rate limit', err.message);
      return Response.json(
        { error: 'api_football_rate_limit', retryAfterSec: err.retryAfterSec },
        { status: 503 },
      );
    }
    if (err instanceof ApiFootballTimeoutError) {
      notifyCronFailure('P1', 'api_football_timeout', 'API-Football quota poller timeout', err.message);
      return Response.json({ error: 'api_football_timeout' }, { status: 504 });
    }
    notifyCronFailure('P0', 'unknown', 'API-Football quota poller crashed', (err as Error).message);
    return Response.json({ error: 'api_football_quota_failed' }, { status: 500 });
  }
}

function notifyCronFailure(
  severity: 'P0' | 'P1',
  errorType: CronErrorType,
  title: string,
  message: string,
): void {
  notifyOpsFireAndForget(
    {
      severity,
      title,
      body: [`message: ${message}`, `now: ${new Date().toISOString()}`].join('\n'),
      tags: ['cron-failure', errorType],
    },
    {
      dedupKey: `cron-quota:${severity}:${errorType}`,
      dedupWindowMs: 5 * 60 * 1000,
    },
  );
  trackServerEventGlobal({
    eventId: 'E074',
    properties: {
      severity,
      error_type: errorType,
      used: null,
      limit: null,
      percent: null,
    },
  });
}
