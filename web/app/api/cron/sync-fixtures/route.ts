import { notifyOpsFireAndForget } from '@/lib/alerts';
import { getSupabaseService } from '@/lib/api/mode';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import {
  ApiFootballAuthError,
  ApiFootballRateLimitError,
  ApiFootballTimeoutError,
} from '@/lib/api-football/client';
import { getFixturesByDateWithMeta } from '@/lib/api-football/fixtures';
import { syncFixturesToDb, type SyncFixturesClient } from '@/lib/api-football/sync';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

type CronSyncError =
  | 'db_unavailable'
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

  const parsed = parseRequest(req);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { date, league, season } = parsed;
  trackServerEventGlobal({
    eventId: 'E071',
    properties: { date, league: league ?? null, season: season ?? null, trigger: 'cron' },
  });

  const db = getSupabaseService() as SyncFixturesClient | null;
  if (!db) {
    notifyCronSyncFailure('P1', 'db_unavailable', 'API-Football fixtures cron sync db unavailable', 'service db unavailable');
    trackCronSyncFailure(date, 'db_unavailable');
    return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  }

  try {
    const fetched = await getFixturesByDateWithMeta(date, { league, season });
    const synced = await syncFixturesToDb(db, fetched.fixtures);
    trackServerEventGlobal({
      eventId: 'E072',
      properties: {
        date,
        fetched: fetched.fixtures.length,
        inserted: synced.inserted,
        updated: synced.updated,
        errors_count: synced.errors.length,
        trigger: 'cron',
      },
    });
    return Response.json({
      date,
      fetched: fetched.fixtures.length,
      inserted: synced.inserted,
      updated: synced.updated,
      errors: synced.errors,
      rateLimitMinuteRemaining: fetched.rateLimitMinuteRemaining,
    });
  } catch (err) {
    if (err instanceof ApiFootballAuthError) {
      notifyCronSyncFailure('P0', 'api_football_auth', 'API-Football fixtures sync auth failed', err.message);
      trackCronSyncFailure(date, 'api_football_auth');
      return Response.json({ error: 'api_football_auth' }, { status: 503 });
    }
    if (err instanceof ApiFootballRateLimitError) {
      notifyCronSyncFailure('P1', 'api_football_rate_limit', 'API-Football fixtures sync hit rate limit', err.message);
      trackCronSyncFailure(date, 'api_football_rate_limit');
      return Response.json(
        { error: 'api_football_rate_limit', retryAfterSec: err.retryAfterSec },
        { status: 503 },
      );
    }
    if (err instanceof ApiFootballTimeoutError) {
      notifyCronSyncFailure('P1', 'api_football_timeout', 'API-Football fixtures sync timeout', err.message);
      trackCronSyncFailure(date, 'api_football_timeout');
      return Response.json({ error: 'api_football_timeout' }, { status: 504 });
    }
    notifyCronSyncFailure('P0', 'unknown', 'API-Football fixtures cron sync crashed', (err as Error).message);
    trackCronSyncFailure(date, 'unknown');
    return Response.json({ error: 'cron_sync_fixtures_failed' }, { status: 500 });
  }
}

// 不传 league/season 时锁定目标赛事，不允许"默认拉全球"——6/12 生产实测:无参 cron 把当天
// 全球 162 场无关比赛灌进 matches(F58)。env 可覆写(API_FOOTBALL_LEAGUE_ID / API_FOOTBALL_SEASON)。
const DEFAULT_LEAGUE_ID = 1; // API-Football league 1 = 本项目的目标国际大赛
const DEFAULT_SEASON = 2026;

function parseRequest(req: Request):
  | { ok: true; date: string; league: number; season: number }
  | { ok: false; error: string } {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid_date' };
  const league = parseOptionalPositiveInt(url.searchParams.get('league'));
  if (league === false) return { ok: false, error: 'invalid_league' };
  const season = parseOptionalPositiveInt(url.searchParams.get('season'));
  if (season === false) return { ok: false, error: 'invalid_season' };
  return {
    ok: true,
    date,
    league: league ?? envPositiveInt('API_FOOTBALL_LEAGUE_ID', DEFAULT_LEAGUE_ID),
    season: season ?? envPositiveInt('API_FOOTBALL_SEASON', DEFAULT_SEASON),
  };
}

function envPositiveInt(name: string, fallback: number): number {
  const parsed = parseOptionalPositiveInt(process.env[name] ?? null);
  return parsed === false || parsed === undefined ? fallback : parsed;
}

function parseOptionalPositiveInt(value: string | null): number | undefined | false {
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : false;
}

function notifyCronSyncFailure(
  severity: 'P0' | 'P1',
  errorType: CronSyncError,
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
      dedupKey: `cron-sync:${severity}:${errorType}`,
      dedupWindowMs: 5 * 60 * 1000,
    },
  );
}

function trackCronSyncFailure(date: string, error: CronSyncError): void {
  trackServerEventGlobal({
    eventId: 'E072',
    properties: {
      date,
      fetched: 0,
      inserted: 0,
      updated: 0,
      errors_count: 1,
      error,
      trigger: 'cron',
    },
  });
}
