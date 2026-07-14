import type { Fixture } from './fixtures';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@/lib/api/shortcode';

export interface SyncFixturesClient {
  from(table: 'matches'): {
    upsert(
      rows: Array<Record<string, unknown>>,
      opts: { onConflict: string },
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    select(columns: string): {
      in(
        column: string,
        values: string[],
      ): PromiseLike<{ data: Array<{ id: string; external_id: string; stats?: unknown }> | null; error: { message: string } | null }>;
    };
  };
}

export interface SyncFixturesResult {
  inserted: number;
  updated: number;
  errors: Array<{ externalId: string; error: string }>;
}

export async function syncFixturesToDb(
  client: SyncFixturesClient,
  fixtures: Fixture[],
): Promise<SyncFixturesResult> {
  if (fixtures.length === 0) return { inserted: 0, updated: 0, errors: [] };

  const externalIds = fixtures.map((fixture) => fixture.externalId);
  const existing = await client
    .from('matches')
    .select('id, external_id, stats')
    .in('external_id', externalIds);
  if (existing.error) throw new Error(`[api-football/sync] select failed: ${existing.error.message}`);

  const existingIds = new Set((existing.data ?? []).map((row) => row.external_id));
  // 现有 stats 按 external_id 索引:upsert 会整列覆盖 stats,必须先取出、合并保留 enrich 加的技术统计
  // (possession/shots/…),否则每次 sync 把它们冲掉(用户报修:厄瓜多尔-德国数据证据只剩比分)。
  const existingStats = new Map<string, unknown>();
  for (const row of existing.data ?? []) existingStats.set(row.external_id, row.stats);
  const result: SyncFixturesResult = { inserted: 0, updated: 0, errors: [] };

  for (const fixture of fixtures) {
    const row = fixtureToMatchRow(fixture, existingStats.get(fixture.externalId));
    const upsert = await client.from('matches').upsert([row], { onConflict: 'external_id' });
    if (upsert.error) {
      result.errors.push({ externalId: fixture.externalId, error: upsert.error.message });
      continue;
    }
    if (existingIds.has(fixture.externalId)) result.updated += 1;
    else result.inserted += 1;
  }

  if (result.inserted === 0 && result.updated === 0 && result.errors.length > 0) {
    throw new Error(`[api-football/sync] all upserts failed: ${result.errors.map((e) => e.error).join('; ')}`);
  }
  return result;
}

export function stableFixtureShortCodeForTest(externalId: string): string {
  return stableFixtureShortCode(externalId);
}

function fixtureToMatchRow(fixture: Fixture, existingStats?: unknown): Record<string, unknown> {
  const prior = existingStats && typeof existingStats === 'object' && !Array.isArray(existingStats)
    ? (existingStats as Record<string, unknown>)
    : {};
  return {
    external_id: fixture.externalId,
    short_code: stableFixtureShortCode(fixture.externalId),
    competition: `${fixture.league.name} ${fixture.league.season} - ${fixture.league.round}`,
    home_team: fixture.home.name,
    away_team: fixture.away.name,
    home_score: fixture.home.score,
    away_score: fixture.away.score,
    match_date: fixture.kickoffAt,
    status: fixture.status,
    stats: {
      // 保留 enrich 加的技术统计(possession/shots/…),只刷新 sync 自己拥有的几个字段。
      ...prior,
      venue: fixture.venue,
      statusRaw: fixture.statusRaw,
      // 比分分段(半场/90'/加时/点球):官方战报风(ft)卡比分进程行数据源;上游未给时保留旧值。
      ...(fixture.scoreBreakdown ? { scoreBreakdown: fixture.scoreBreakdown } : {}),
      apiFootball: {
        fixtureId: fixture.apiFixtureId,
        leagueId: fixture.league.id,
        round: fixture.league.round,
        homeTeamId: fixture.home.teamId,
        awayTeamId: fixture.away.teamId,
      },
    },
  };
}

function stableFixtureShortCode(externalId: string): string {
  let hash = 2166136261;
  for (const char of externalId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let value = hash >>> 0;
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    code += SHORT_CODE_ALPHABET[value % SHORT_CODE_ALPHABET.length]!;
    value = Math.floor(value / SHORT_CODE_ALPHABET.length);
  }
  return code;
}
