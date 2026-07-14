import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';
import {
  ApiFootballAuthError,
  ApiFootballRateLimitError,
} from '@/lib/api-football/client';
import { getFixturesByDateWithMeta } from '@/lib/api-football/fixtures';
import { syncFixturesToDb, type SyncFixturesClient } from '@/lib/api-football/sync';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  league: z.number().int().positive().optional(),
  season: z.number().int().positive().optional(),
}).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  trackServerEventGlobal({
    eventId: 'E071',
    properties: { date: body.date, league: body.league ?? null, season: body.season ?? null, trigger: 'admin' },
  });

  try {
    const db = getSupabaseService() as SyncFixturesClient | null;
    if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

    const fetched = await getFixturesByDateWithMeta(body.date, {
      league: body.league,
      season: body.season,
    });
    const synced = await syncFixturesToDb(db, fetched.fixtures);
    trackServerEventGlobal({
      eventId: 'E072',
      properties: {
        date: body.date,
        fetched: fetched.fixtures.length,
        inserted: synced.inserted,
        updated: synced.updated,
        errors_count: synced.errors.length,
        trigger: 'admin',
      },
    });
    return Response.json({
      date: body.date,
      fetched: fetched.fixtures.length,
      inserted: synced.inserted,
      updated: synced.updated,
      errors: synced.errors,
      rateLimitMinuteRemaining: fetched.rateLimitMinuteRemaining,
    });
  } catch (err) {
    if (err instanceof ApiFootballAuthError) {
      trackSyncFailure(body.date, 'api_football_auth');
      return Response.json({ error: 'api_football_auth' }, { status: 503 });
    }
    if (err instanceof ApiFootballRateLimitError) {
      trackSyncFailure(body.date, 'api_football_rate_limit');
      return Response.json(
        { error: 'api_football_rate_limit', retryAfterSec: err.retryAfterSec },
        { status: 503 },
      );
    }
    trackSyncFailure(body.date, 'sync_failed');
    console.error('[admin/sync-fixtures] handler failed:', (err as Error).message);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
});

function trackSyncFailure(date: string, error: string): void {
  trackServerEventGlobal({
    eventId: 'E072',
    properties: { date, fetched: 0, inserted: 0, updated: 0, errors_count: 1, error, trigger: 'admin' },
  });
}
