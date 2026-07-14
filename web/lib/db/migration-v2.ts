export interface MigrationResult {
  step: string;
  ok: boolean;
  rowsAffected?: number;
  error?: string;
}

export interface MigrationSummary {
  startedAt: string;
  finishedAt: string;
  results: MigrationResult[];
  overallOk: boolean;
}

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface MigrationClient {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): RpcResult<T>;
}

const MIGRATION_STEPS: Array<{ name: string; sql: string }> = [
  {
    name: 'add_scenario_column',
    sql: "ALTER TABLE reports ADD COLUMN IF NOT EXISTS scenario TEXT CHECK (scenario IN ('home_wins', 'away_wins', 'tie'))",
  },
  {
    name: 'add_published_at_column',
    sql: 'ALTER TABLE reports ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ',
  },
  {
    name: 'add_reviewer_note_column',
    sql: 'ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewer_note TEXT',
  },
  {
    name: 'add_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_reports_match_scenario ON reports (match_id, scenario) WHERE scenario IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_reports_published ON reports (published_at DESC) WHERE published_at IS NOT NULL;
    `,
  },
  {
    name: 'drop_old_unique',
    sql: 'ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_match_id_style_key',
  },
  {
    name: 'create_new_unique',
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_match_style_scenario_uniq ON reports (match_id, style, COALESCE(scenario, ''))",
  },
  {
    name: 'unpack_scenario',
    sql: `
      UPDATE reports SET scenario = CASE
        WHEN 'scenario:home_wins' = ANY(tags) THEN 'home_wins'
        WHEN 'scenario:away_wins' = ANY(tags) THEN 'away_wins'
        WHEN 'scenario:tie' = ANY(tags) THEN 'tie'
        ELSE NULL
      END
      WHERE scenario IS NULL AND tags && ARRAY['scenario:home_wins', 'scenario:away_wins', 'scenario:tie']
    `,
  },
  {
    name: 'unpack_published_at',
    sql: `
      UPDATE reports SET published_at = (
        SELECT TO_TIMESTAMP(SUBSTRING(t FROM 'published:(.+)$'), 'YYYY-MM-DD"T"HH24:MI:SS')
        FROM unnest(tags) t
        WHERE t LIKE 'published:%'
        LIMIT 1
      )
      WHERE published_at IS NULL AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t LIKE 'published:%')
    `,
  },
];

export async function runSchemaV2Migration(client: MigrationClient): Promise<MigrationSummary> {
  const startedAt = new Date().toISOString();
  const results: MigrationResult[] = [];

  const { data: exists, error: colErr } = await client.rpc<boolean>('check_column_exists', {
    table_name: 'reports',
    column_name: 'scenario',
  });
  if (colErr) {
    results.push({ step: 'check_column_exists', ok: false, error: colErr.message });
    return finalize(results, startedAt);
  }
  if (exists === true) {
    results.push({ step: 'check_column_exists', ok: true, rowsAffected: 0 });
    return finalize(results, startedAt);
  }
  results.push({ step: 'check_column_exists', ok: true, rowsAffected: 0 });

  for (const step of MIGRATION_STEPS) {
    const { error } = await client.rpc<null>('exec_sql_admin', { sql_query: step.sql });
    if (error) {
      results.push({ step: step.name, ok: false, error: error.message });
      return finalize(results, startedAt);
    }
    results.push({ step: step.name, ok: true });
  }

  return finalize(results, startedAt);
}

function finalize(results: MigrationResult[], startedAt: string): MigrationSummary {
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    overallOk: results.every((result) => result.ok),
  };
}
