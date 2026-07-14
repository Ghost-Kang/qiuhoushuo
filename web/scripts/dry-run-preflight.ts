#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkEnvDrift } from './check-env-drift';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

export type PreflightStatus = 'pass' | 'warn' | 'fail';
export type PreflightCheck = {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
};

export type DryRunPreflightResult = {
  checks: PreflightCheck[];
  summary: Record<PreflightStatus, number>;
  verdict: 'ready' | 'needs_attention' | 'blocked';
};

export type DryRunPreflightOptions = {
  repoRoot?: string;
};

const REQUIRED_FILES = [
  'tasks/INTERNAL-TEST-DRY-RUN-SOP-2026-06-04.md',
  'tasks/EXTERNAL-DEPS-ACTION-MATRIX.md',
  'tasks/FINALS-DAY-RUNBOOK.md',
  'web/.env.example',
  'web/db/schema.sql',
  'web/evals/fixtures/m01.json',
  'web/scripts/verify-events-pipeline.ts',
  'web/scripts/check-trademark.ts',
  'web/scripts/check-no-any-annotation.ts',
] as const;

const OPTIONAL_EXTERNAL_DOCS = [
  'tasks/EVALS-DOUBAO-VS-DEEPSEEK-W4.md',
  'tasks/L08-USER-AGREEMENT-DRAFT-v0.2.md',
  'tasks/KOL-ALPHA-12-PIECES.md',
  'tasks/CUSTOMER-COMPLAINT-RESPONSE-TEMPLATES.md',
] as const;

const REQUIRED_ROUTES = [
  'web/app/api/admin/flags/route.ts',
  'web/app/api/admin/sync-fixtures/route.ts',
  'web/app/api/report/route.ts',
  'web/app/api/report/[id]/route.ts',
  'web/app/api/card/[reportId]/route.ts',
  'web/app/m/[shortCode]/route.ts',
  'web/app/api/chat/rooms/route.ts',
  'web/app/api/me/route.ts',
  'web/app/api/track/route.ts',
] as const;

const REQUIRED_ENV_KEYS = [
  'ADMIN_TOKEN',
  'INTERNAL_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DOUBAO_API_KEY',
  'DOUBAO_BASE_URL',
  'API_FOOTBALL_KEY',
  'API_FOOTBALL_BASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

const EXPECTED_EVENT_IDS = [
  'E013',
  'E031',
  'E032',
  'E033',
  'E041',
  'E044',
  'E045',
  'E046',
  'E047',
  'E060',
  'E061',
  'E062',
  'E063',
  'E064',
  'E054',
  'E070',
  'E071',
  'E072',
  'E073',
  'E074',
  'E092',
  'E096',
] as const;

const REQUIRED_FLAG_READERS = [
  'feature.internal_only',
  'feature.public_register',
  'feature.kol_alpha',
  'feature.finals_mode',
  'feature.show_payment_history',
  'feature.host_intro_card',
] as const;

export function runDryRunPreflight(opts: DryRunPreflightOptions = {}): DryRunPreflightResult {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const checks: PreflightCheck[] = [
    checkRequiredFiles(repoRoot),
    checkOptionalExternalDocs(repoRoot),
    checkRequiredRoutes(repoRoot),
    checkEnvExample(repoRoot),
    checkEnvDriftGate(repoRoot),
    checkEventVerifier(repoRoot),
    checkSchemaTables(repoRoot),
    checkPackageScripts(repoRoot),
    checkFeatureFlagReaders(repoRoot),
  ];
  const summary = summarize(checks);
  const verdict = summary.fail > 0 ? 'blocked' : summary.warn > 0 ? 'needs_attention' : 'ready';
  return { checks, summary, verdict };
}

function checkEnvDriftGate(repoRoot: string): PreflightCheck {
  try {
    const result = checkEnvDrift({ cwd: join(repoRoot, 'web') });
    if (result.missingInExample.length) {
      return makeCheck(
        'env.drift',
        'process.env vs .env.example drift',
        'fail',
        `missing in .env.example: ${result.missingInExample.join(', ')}`,
      );
    }
    if (result.unusedInCode.length) {
      return makeCheck(
        'env.drift',
        'process.env vs .env.example drift',
        'warn',
        `unused documented keys: ${result.unusedInCode.join(', ')}`,
      );
    }
    return makeCheck('env.drift', 'process.env vs .env.example drift', 'pass', 'runtime env reads are documented');
  } catch (err) {
    return makeCheck('env.drift', 'process.env vs .env.example drift', 'fail', (err as Error).message);
  }
}

function checkRequiredFiles(repoRoot: string): PreflightCheck {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(join(repoRoot, file)));
  return makeCheck(
    'files.required',
    'dry-run required local files',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `${REQUIRED_FILES.length} files present` : `missing: ${missing.join(', ')}`,
  );
}

function checkOptionalExternalDocs(repoRoot: string): PreflightCheck {
  const missing = OPTIONAL_EXTERNAL_DOCS.filter((file) => !existsSync(join(repoRoot, file)));
  return makeCheck(
    'docs.external',
    'external/human handoff docs',
    missing.length === 0 ? 'pass' : 'warn',
    missing.length === 0
      ? `${OPTIONAL_EXTERNAL_DOCS.length} docs present`
      : `not yet landed: ${missing.join(', ')}`,
  );
}

function checkRequiredRoutes(repoRoot: string): PreflightCheck {
  const missing = REQUIRED_ROUTES.filter((file) => !existsSync(join(repoRoot, file)));
  return makeCheck(
    'routes.required',
    'A1-A5 route surface',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `${REQUIRED_ROUTES.length} routes present` : `missing: ${missing.join(', ')}`,
  );
}

function checkEnvExample(repoRoot: string): PreflightCheck {
  const envPath = join(repoRoot, 'web/.env.example');
  if (!existsSync(envPath)) {
    return makeCheck('env.example', 'dry-run env keys documented', 'fail', 'web/.env.example missing');
  }
  const content = readFileSync(envPath, 'utf8');
  const present = parseEnvKeys(content);
  const missing = REQUIRED_ENV_KEYS.filter((key) => !present.has(key));
  const hasAlertWebhook = present.has('WECOM_BOT_WEBHOOK') || present.has('DINGTALK_BOT_WEBHOOK');
  const hasRemoteSafety =
    present.has('SHUMEI_ACCESS_KEY') ||
    (present.has('YIDUN_SECRET_ID') && present.has('YIDUN_SECRET_KEY') && present.has('YIDUN_BUSINESS_ID'));
  const extras: string[] = [];
  if (!hasAlertWebhook) extras.push('WECOM_BOT_WEBHOOK or DINGTALK_BOT_WEBHOOK');
  if (!hasRemoteSafety) extras.push('SHUMEI_ACCESS_KEY or YIDUN_* triplet');
  const issues = [...missing, ...extras];
  return makeCheck(
    'env.example',
    'dry-run env keys documented',
    issues.length === 0 ? 'pass' : 'fail',
    issues.length === 0 ? `${REQUIRED_ENV_KEYS.length} required keys + alert/safety keys present` : `missing: ${issues.join(', ')}`,
  );
}

function checkEventVerifier(repoRoot: string): PreflightCheck {
  const scriptPath = join(repoRoot, 'web/scripts/verify-events-pipeline.ts');
  if (!existsSync(scriptPath)) {
    return makeCheck('events.verifier', 'server event verifier coverage', 'fail', 'verify-events-pipeline.ts missing');
  }
  const content = readFileSync(scriptPath, 'utf8');
  const missing = EXPECTED_EVENT_IDS.filter((eventId) => !content.includes(`'${eventId}'`));
  return makeCheck(
    'events.verifier',
    'server event verifier coverage',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `${EXPECTED_EVENT_IDS.length} dry-run event ids covered` : `missing event ids: ${missing.join(', ')}`,
  );
}

function checkSchemaTables(repoRoot: string): PreflightCheck {
  const schemaPath = join(repoRoot, 'web/db/schema.sql');
  if (!existsSync(schemaPath)) return makeCheck('db.schema', 'dry-run db tables', 'fail', 'web/db/schema.sql missing');
  const content = readFileSync(schemaPath, 'utf8').toLowerCase();
  const requiredTokens = ['create table', 'events', 'reports', 'matches', 'shares', 'landings', 'safety_logs'];
  const missing = requiredTokens.filter((token) => !content.includes(token));
  return makeCheck(
    'db.schema',
    'dry-run db tables',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? 'schema includes dry-run core tables' : `missing schema token(s): ${missing.join(', ')}`,
  );
}

function checkPackageScripts(repoRoot: string): PreflightCheck {
  const packagePath = join(repoRoot, 'web/package.json');
  if (!existsSync(packagePath)) return makeCheck('package.scripts', 'local command entrypoints', 'fail', 'web/package.json missing');
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  const scripts = parsed.scripts ?? {};
  const requiredScripts = ['ci', 'check:trademark', 'check:no-any', 'evals:validate'];
  const missing = requiredScripts.filter((name) => !scripts[name]);
  return makeCheck(
    'package.scripts',
    'local command entrypoints',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `${requiredScripts.length} command entrypoints present` : `missing scripts: ${missing.join(', ')}`,
  );
}

function checkFeatureFlagReaders(repoRoot: string): PreflightCheck {
  const files = [...walkTsFiles(join(repoRoot, 'web/app')), ...walkTsFiles(join(repoRoot, 'web/lib'))];
  const contents = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const missing = REQUIRED_FLAG_READERS.filter((flag) => !contents.includes(`isFeatureEnabled('${flag}'`));
  return makeCheck(
    'flags.readers',
    'SOP feature flags wired in code',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `SOP feature flags wired in code (${REQUIRED_FLAG_READERS.length}/${REQUIRED_FLAG_READERS.length})` : `missing readers: ${missing.join(', ')}`,
  );
}

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^([A-Z0-9_]+)=/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function makeCheck(id: string, label: string, status: PreflightStatus, detail: string): PreflightCheck {
  return { id, label, status, detail };
}

function summarize(checks: PreflightCheck[]): Record<PreflightStatus, number> {
  return checks.reduce<Record<PreflightStatus, number>>(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

export function formatDryRunPreflightReport(result: DryRunPreflightResult, repoRoot = REPO_ROOT): string {
  const lines = [
    '== 6/4 internal-test dry-run preflight ==',
    `repo: ${relative(dirname(repoRoot), repoRoot) || repoRoot}`,
    `verdict: ${result.verdict}`,
    `summary: pass=${result.summary.pass} warn=${result.summary.warn} fail=${result.summary.fail}`,
    '',
  ];
  for (const check of result.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.id} - ${check.label}`);
    lines.push(`  ${check.detail}`);
  }
  return lines.join('\n');
}

function runCli(): void {
  const result = runDryRunPreflight();
  console.log(formatDryRunPreflightReport(result));
  process.exit(result.verdict === 'blocked' ? 1 : 0);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
