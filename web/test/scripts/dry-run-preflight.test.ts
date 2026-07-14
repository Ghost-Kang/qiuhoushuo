import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDryRunPreflightReport, runDryRunPreflight } from '@/scripts/dry-run-preflight';

let repoRoot = '';

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'qhs-dry-run-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runDryRunPreflight', () => {
  it('returns ready when all local dry-run prerequisites are present', async () => {
    await writeCompleteFixtureRepo();
    const result = runDryRunPreflight({ repoRoot });
    expect(result.verdict).toBe('ready');
    expect(result.summary).toEqual({ pass: 9, warn: 0, fail: 0 });
    expect(result.checks.find((check) => check.id === 'flags.readers')).toMatchObject({
      status: 'pass',
      detail: 'SOP feature flags wired in code (6/6)',
    });
  });

  it('returns blocked when a required route is missing', async () => {
    await writeCompleteFixtureRepo({ skip: ['web/app/api/card/[reportId]/route.ts'] });
    const result = runDryRunPreflight({ repoRoot });
    expect(result.verdict).toBe('blocked');
    expect(result.checks.find((check) => check.id === 'routes.required')).toMatchObject({
      status: 'fail',
    });
  });

  it('returns needs_attention for external human handoff docs only', async () => {
    await writeCompleteFixtureRepo({
      skip: [
        'tasks/EVALS-DOUBAO-VS-DEEPSEEK-W4.md',
        'tasks/L08-USER-AGREEMENT-DRAFT-v0.2.md',
        'tasks/KOL-ALPHA-12-PIECES.md',
        'tasks/CUSTOMER-COMPLAINT-RESPONSE-TEMPLATES.md',
      ],
    });
    const result = runDryRunPreflight({ repoRoot });
    expect(result.verdict).toBe('needs_attention');
    expect(result.summary).toEqual({ pass: 8, warn: 1, fail: 0 });
  });

  it('fails when required env keys or alert/safety paths are not documented', async () => {
    await writeCompleteFixtureRepo({
      overrides: {
        'web/.env.example': [
          'ADMIN_TOKEN=',
          'SUPABASE_URL=',
          'SUPABASE_SERVICE_KEY=',
        ].join('\n'),
      },
    });
    const result = runDryRunPreflight({ repoRoot });
    const envCheck = result.checks.find((check) => check.id === 'env.example');
    expect(result.verdict).toBe('blocked');
    expect(envCheck?.status).toBe('fail');
    expect(envCheck?.detail).toContain('INTERNAL_TOKEN');
    expect(envCheck?.detail).toContain('WECOM_BOT_WEBHOOK or DINGTALK_BOT_WEBHOOK');
    expect(envCheck?.detail).toContain('SHUMEI_ACCESS_KEY or YIDUN_* triplet');
  });

  it('fails when the events verifier does not cover a dry-run event id', async () => {
    await writeCompleteFixtureRepo({
      overrides: {
        'web/scripts/verify-events-pipeline.ts': "const events = ['E013', 'E041'];\n",
      },
    });
    const result = runDryRunPreflight({ repoRoot });
    const eventsCheck = result.checks.find((check) => check.id === 'events.verifier');
    expect(result.verdict).toBe('blocked');
    expect(eventsCheck?.status).toBe('fail');
    expect(eventsCheck?.detail).toContain('E096');
  });

  it('fails when a SOP feature flag has no code reader', async () => {
    await writeCompleteFixtureRepo({
      overrides: {
        'web/app/api/wx/login/route.ts': "isFeatureEnabled('feature.internal_only', { openid });\n",
      },
    });
    const result = runDryRunPreflight({ repoRoot });
    const flagsCheck = result.checks.find((check) => check.id === 'flags.readers');
    expect(result.verdict).toBe('blocked');
    expect(flagsCheck?.status).toBe('fail');
    expect(flagsCheck?.detail).toContain('feature.public_register');
  });

  it('formats a compact report for the CLI', async () => {
    await writeCompleteFixtureRepo();
    const report = formatDryRunPreflightReport(runDryRunPreflight({ repoRoot }), repoRoot);
    expect(report).toContain('6/4 internal-test dry-run preflight');
    expect(report).toContain('verdict: ready');
    expect(report).toContain('[PASS] files.required');
  });
});

async function writeCompleteFixtureRepo(opts: {
  skip?: string[];
  overrides?: Record<string, string>;
} = {}) {
  const skip = new Set(opts.skip ?? []);
  const overrides = opts.overrides ?? {};
  const files: Record<string, string> = {
    'tasks/INTERNAL-TEST-DRY-RUN-SOP-2026-06-04.md': '# SOP\n',
    'tasks/EXTERNAL-DEPS-ACTION-MATRIX.md': '# external deps\n',
    'tasks/FINALS-DAY-RUNBOOK.md': '# finals runbook\n',
    'tasks/EVALS-DOUBAO-VS-DEEPSEEK-W4.md': '# evals\n',
    'tasks/L08-USER-AGREEMENT-DRAFT-v0.2.md': '# agreement\n',
    'tasks/KOL-ALPHA-12-PIECES.md': '# kol\n',
    'tasks/CUSTOMER-COMPLAINT-RESPONSE-TEMPLATES.md': '# complaints\n',
    'web/.env.example': [
      'ADMIN_TOKEN=',
      'INTERNAL_TOKEN=',
      'SUPABASE_URL=',
      'SUPABASE_ANON_KEY=',
      'SUPABASE_SERVICE_KEY=',
      'DEEPSEEK_API_KEY=',
      'DEEPSEEK_BASE_URL=',
      'DOUBAO_API_KEY=',
      'DOUBAO_BASE_URL=',
      'API_FOOTBALL_KEY=',
      'API_FOOTBALL_BASE_URL=',
      'UPSTASH_REDIS_REST_URL=',
      'UPSTASH_REDIS_REST_TOKEN=',
      'INTERNAL_ALLOWED_OPENIDS=',
      'WECOM_BOT_WEBHOOK=',
      'YIDUN_SECRET_ID=',
      'YIDUN_SECRET_KEY=',
      'YIDUN_BUSINESS_ID=',
    ].join('\n'),
    'web/db/schema.sql': [
      'create table events (event_id text);',
      'create table reports (id text);',
      'create table matches (id text);',
      'create table shares (id text);',
      'create table landings (id text);',
      'create table safety_logs (id text);',
    ].join('\n'),
    'web/evals/fixtures/m01.json': '{}\n',
    'web/scripts/verify-events-pipeline.ts': [
      "'E013'",
      "'E031'",
      "'E032'",
      "'E033'",
      "'E041'",
      "'E044'",
      "'E045'",
      "'E046'",
      "'E047'",
      "'E060'",
      "'E061'",
      "'E062'",
      "'E063'",
      "'E064'",
      "'E054'",
      "'E070'",
      "'E071'",
      "'E072'",
      "'E073'",
      "'E074'",
      "'E092'",
      "'E096'",
    ].join('\n'),
    'web/scripts/check-trademark.ts': 'export {};\n',
    'web/scripts/check-no-any-annotation.ts': 'export {};\n',
    'web/app/api/admin/flags/route.ts': 'export {};\n',
    'web/app/api/admin/sync-fixtures/route.ts': 'export {};\n',
    'web/app/api/report/route.ts': 'export {};\n',
    'web/app/api/report/[id]/route.ts': 'export {};\n',
    'web/app/api/card/[reportId]/route.ts': 'export {};\n',
    'web/app/m/[shortCode]/route.ts': 'export {};\n',
    'web/app/api/chat/rooms/route.ts': 'export {};\n',
    'web/app/api/me/route.ts': 'export {};\n',
    'web/app/api/wx/login/route.ts': [
      "isFeatureEnabled('feature.internal_only', { openid });",
      "isFeatureEnabled('feature.public_register', { openid });",
    ].join('\n'),
    'web/app/api/track/route.ts': 'export {};\n',
    'web/lib/api/finals-mode.ts': "isFeatureEnabled('feature.finals_mode', { openid: 'global' });\n",
    'web/lib/flag-readers.ts': [
      "isFeatureEnabled('feature.kol_alpha', { openid });",
      "isFeatureEnabled('feature.show_payment_history', { openid });",
      "isFeatureEnabled('feature.host_intro_card', { openid });",
    ].join('\n'),
    'web/package.json': JSON.stringify({
      scripts: {
        ci: 'pnpm check:trademark',
        'check:trademark': 'tsx scripts/check-trademark.ts',
        'check:no-any': 'tsx scripts/check-no-any-annotation.ts',
        'evals:validate': 'tsx evals/validate-fixtures.ts',
      },
    }),
    'web/app/page.tsx': 'export default function Page() { return null; }\n',
    'web/lib/env.ts': [
      'export const env = {',
      '  ADMIN_TOKEN: process.env.ADMIN_TOKEN,',
      '  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,',
      '  SUPABASE_URL: process.env.SUPABASE_URL,',
      '  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,',
      '  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,',
      '  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,',
      '  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,',
      '  DOUBAO_API_KEY: process.env.DOUBAO_API_KEY,',
      '  DOUBAO_BASE_URL: process.env.DOUBAO_BASE_URL,',
      '  API_FOOTBALL_KEY: process.env.API_FOOTBALL_KEY,',
      '  API_FOOTBALL_BASE_URL: process.env.API_FOOTBALL_BASE_URL,',
      '  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,',
      '  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,',
      '  INTERNAL_ALLOWED_OPENIDS: process.env.INTERNAL_ALLOWED_OPENIDS,',
      '  WECOM_BOT_WEBHOOK: process.env.WECOM_BOT_WEBHOOK,',
      '  YIDUN_SECRET_ID: process.env.YIDUN_SECRET_ID,',
      '  YIDUN_SECRET_KEY: process.env.YIDUN_SECRET_KEY,',
      '  YIDUN_BUSINESS_ID: process.env.YIDUN_BUSINESS_ID,',
      '};',
      '',
    ].join('\n'),
  };

  for (const [rel, defaultContent] of Object.entries(files)) {
    if (skip.has(rel)) continue;
    await writeFixture(rel, overrides[rel] ?? defaultContent);
  }
}

async function writeFixture(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}
