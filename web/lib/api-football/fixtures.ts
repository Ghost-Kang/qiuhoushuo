import { z } from 'zod';
import { apiFootballGet, type ApiFootballGetOptions } from './client';
import { trackServerEventGlobal } from '@/lib/api/tracker';

export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';

export interface Fixture {
  externalId: string;
  apiFixtureId: number;
  league: {
    id: number;
    name: string;
    season: number;
    round: string;
  };
  kickoffAt: string;
  status: FixtureStatus;
  statusRaw: string;
  venue: { name: string; city: string } | null;
  home: { teamId: number; name: string; score: number | null };
  away: { teamId: number; name: string; score: number | null };
  /** 比分分段(半场/90分钟/加时净比分/点球),官方战报风卡的比分进程行数据源;上游缺则 null。 */
  scoreBreakdown: ScoreBreakdown | null;
}

export type ScorePair = { home: number; away: number };
export interface ScoreBreakdown {
  halftime: ScorePair | null;
  fulltime: ScorePair | null;
  extratime: ScorePair | null;
  penalty: ScorePair | null;
}

export interface GetFixturesByDateOptions {
  league?: number;
  season?: number;
  timezone?: string;
  client?: ApiFootballGetOptions;
}

export interface FixturesByDateResult {
  fixtures: Fixture[];
  rateLimitMinuteRemaining: number | null;
}

const Team = z.object({
  id: z.number(),
  name: z.string(),
}).passthrough();

const ScorePairSchema = z.object({
  home: z.number().nullable(),
  away: z.number().nullable(),
}).passthrough().nullish();

const ApiFixtureRow = z.object({
  fixture: z.object({
    id: z.number(),
    date: z.string(),
    venue: z.object({
      name: z.string().nullish(),
      city: z.string().nullish(),
    }).passthrough().nullish(),
    status: z.object({
      short: z.string(),
    }).passthrough(),
  }).passthrough(),
  league: z.object({
    id: z.number(),
    name: z.string(),
    season: z.number(),
    round: z.string().default(''),
  }).passthrough(),
  teams: z.object({
    home: Team,
    away: Team,
  }).passthrough(),
  goals: z.object({
    home: z.number().nullable(),
    away: z.number().nullable(),
  }).passthrough(),
  score: z.object({
    halftime: ScorePairSchema,
    fulltime: ScorePairSchema,
    extratime: ScorePairSchema,
    penalty: ScorePairSchema,
  }).passthrough().nullish(),
}).passthrough();

const ApiFixturesResponse = z.array(ApiFixtureRow);

export async function getFixturesByDate(
  date: string,
  opts: GetFixturesByDateOptions = {},
): Promise<Fixture[]> {
  return (await getFixturesByDateWithMeta(date, opts)).fixtures;
}

export async function getFixturesByDateWithMeta(
  date: string,
  opts: GetFixturesByDateOptions = {},
): Promise<FixturesByDateResult> {
  const startedAt = Date.now();
  const result = await apiFootballGet<unknown>(
    '/fixtures',
    {
      date,
      league: opts.league,
      season: opts.season,
      timezone: opts.timezone ?? 'UTC',
    },
    opts.client,
  );
  const latencyMs = Date.now() - startedAt;
  trackServerEventGlobal({
    eventId: 'E070',
    properties: {
      path: '/fixtures',
      results: result.results,
      rate_limit_remaining: result.rateLimitMinuteRemaining ?? -1,
      latency_ms: latencyMs,
    },
  });

  const parsed = ApiFixturesResponse.safeParse(result.response);
  if (!parsed.success) {
    throw new Error(`[api-football/fixtures] zod parse failed: ${parsed.error.message}`);
  }

  const fixtures = parsed.data
    .map(normalizeFixture)
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  return { fixtures, rateLimitMinuteRemaining: result.rateLimitMinuteRemaining };
}

function normalizeFixture(row: z.infer<typeof ApiFixtureRow>): Fixture {
  const venueName = row.fixture.venue?.name ?? null;
  const venueCity = row.fixture.venue?.city ?? null;
  return {
    externalId: `apifoot:${row.fixture.id}`,
    apiFixtureId: row.fixture.id,
    league: {
      id: row.league.id,
      name: row.league.name,
      season: row.league.season,
      round: row.league.round,
    },
    kickoffAt: new Date(row.fixture.date).toISOString(),
    status: normalizeStatus(row.fixture.status.short),
    statusRaw: row.fixture.status.short,
    venue: venueName || venueCity ? { name: venueName ?? '', city: venueCity ?? '' } : null,
    home: {
      teamId: row.teams.home.id,
      name: row.teams.home.name,
      score: row.goals.home,
    },
    away: {
      teamId: row.teams.away.id,
      name: row.teams.away.name,
      score: row.goals.away,
    },
    scoreBreakdown: normalizeScoreBreakdown(row.score),
  };
}

/** 上游 score 段:双端都有数才算有效段(开赛前全 null;点球场次 penalty 才非空)。全空 → null 不落库。 */
function normalizeScoreBreakdown(score: z.infer<typeof ApiFixtureRow>['score']): ScoreBreakdown | null {
  if (!score) return null;
  const pair = (p: { home: number | null; away: number | null } | null | undefined): ScorePair | null =>
    p && p.home != null && p.away != null ? { home: p.home, away: p.away } : null;
  const breakdown: ScoreBreakdown = {
    halftime: pair(score.halftime),
    fulltime: pair(score.fulltime),
    extratime: pair(score.extratime),
    penalty: pair(score.penalty),
  };
  return breakdown.halftime || breakdown.fulltime || breakdown.extratime || breakdown.penalty ? breakdown : null;
}

function normalizeStatus(status: string): FixtureStatus {
  if (['TBD', 'NS'].includes(status)) return 'scheduled';
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(status)) return 'live';
  if (['FT', 'AET', 'PEN'].includes(status)) return 'finished';
  if (['PST', 'SUSP'].includes(status)) return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(status)) return 'cancelled';
  console.warn('[api-football/fixtures] unknown fixture status:', status);
  return 'scheduled';
}
