import { z } from 'zod';
import type { Fixture } from './fixtures';

const OpenFootballMatch = z.object({
  round: z.string().default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().optional(),
  team1: z.string(),
  team2: z.string(),
  group: z.string().optional(),
  ground: z.string().optional(),
  score1: z.number().optional(),
  score2: z.number().optional(),
}).passthrough();

const OpenFootballTournament = z.object({
  name: z.string().default('Global Tournament 2026'),
  matches: z.array(OpenFootballMatch),
}).passthrough();

type OpenFootballMatchRow = z.infer<typeof OpenFootballMatch>;

export interface OpenFootballImportOptions {
  leagueId?: number;
  leagueName?: string;
  season?: number;
}

const DEFAULT_LEAGUE_ID = 2026_000;
const DEFAULT_SEASON = 2026;

export function parseOpenFootballFixtures(
  raw: unknown,
  opts: OpenFootballImportOptions = {},
): Fixture[] {
  const parsed = OpenFootballTournament.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`[openfootball] zod parse failed: ${parsed.error.message}`);
  }

  const leagueName = opts.leagueName ?? parsed.data.name;
  const season = opts.season ?? inferSeason(parsed.data.name) ?? DEFAULT_SEASON;
  return parsed.data.matches
    .map((match, index) => normalizeOpenFootballMatch(match, index, {
      leagueId: opts.leagueId ?? DEFAULT_LEAGUE_ID,
      leagueName,
      season,
    }))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
}

function normalizeOpenFootballMatch(
  match: OpenFootballMatchRow,
  index: number,
  opts: { leagueId: number; leagueName: string; season: number },
): Fixture {
  const kickoffAt = normalizeKickoff(match.date, match.time);
  const status = match.score1 === undefined || match.score2 === undefined ? 'scheduled' : 'finished';
  return {
    externalId: `openfootball:${match.date}:${slug(match.team1)}:${slug(match.team2)}:${index + 1}`,
    apiFixtureId: -1 * (index + 1),
    league: {
      id: opts.leagueId,
      name: opts.leagueName,
      season: opts.season,
      round: match.round || match.group || 'OpenFootball',
    },
    kickoffAt,
    status,
    statusRaw: status === 'finished' ? 'FT' : 'NS',
    venue: match.ground ? { name: match.ground, city: match.ground } : null,
    home: { teamId: negativeTeamId(match.team1), name: match.team1, score: match.score1 ?? null },
    away: { teamId: negativeTeamId(match.team2), name: match.team2, score: match.score2 ?? null },
    scoreBreakdown: null, // openfootball 数据源无分段比分
  };
}

function normalizeKickoff(date: string, time?: string): string {
  if (!time) return `${date}T00:00:00.000Z`;
  const match = time.match(/^(\d{1,2}):(\d{2})(?:\s+UTC([+-]\d{1,2}))?$/);
  if (!match) return `${date}T00:00:00.000Z`;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const offset = match[3] ? Number(match[3]) : 0;
  return new Date(Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour - offset,
    minute,
  )).toISOString();
}

function inferSeason(name: string): number | null {
  const match = name.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function negativeTeamId(name: string): number {
  let hash = 2166136261;
  for (const char of name) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return -1 * ((hash >>> 0) % 1_000_000_000 || 1);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
}
