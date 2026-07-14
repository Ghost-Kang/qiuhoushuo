import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkEnvDrift, formatEnvDriftReport, scanEnvKeysFromSource } from '@/scripts/check-env-drift';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qhs-env-drift-'));
  await mkdir(join(dir, 'app'), { recursive: true });
  await mkdir(join(dir, 'lib'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checkEnvDrift', () => {
  it('passes when runtime env reads are documented', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\nNEXT_PUBLIC_SITE_URL=\n');
    await writeFixture('app/route.ts', 'const token = process.env.ADMIN_TOKEN;\n');
    await writeFixture('lib/site.ts', 'const site = process.env.NEXT_PUBLIC_SITE_URL;\n');
    const result = checkEnvDrift({ cwd: dir, roots: ['app', 'lib'], files: [] });
    expect(result.missingInExample).toEqual([]);
    expect(result.unusedInCode).toEqual([]);
  });

  it('reports code env reads missing from .env.example', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\n');
    await writeFixture('app/route.ts', 'const secret = process.env.INTERNAL_TOKEN;\n');
    const result = checkEnvDrift({ cwd: dir, roots: ['app'], files: [] });
    expect(result.missingInExample).toEqual(['INTERNAL_TOKEN']);
  });

  it('ignores comments, string literals, tests, and system env keys', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\n');
    await writeFixture('app/route.ts', [
      '// process.env.COMMENT_ONLY',
      "const text = 'process.env.STRING_ONLY';",
      'const runtime = process.env.NEXT_RUNTIME;',
      'const token = process.env.ADMIN_TOKEN;',
    ].join('\n'));
    await writeFixture('test/example.test.ts', 'const x = process.env.TEST_ONLY;\n');
    const result = checkEnvDrift({ cwd: dir, roots: ['app', 'test'], files: [] });
    expect(result.missingInExample).toEqual([]);
  });

  it('detects env reads after URL string literals with // characters', async () => {
    await writeFixture('.env.example', 'OPENAI_API_KEY=\n');
    await writeFixture('app/llm.ts', [
      "const baseURL = 'https://api.openai.com/v1';",
      'const apiKey = process.env.OPENAI_API_KEY;',
    ].join('\n'));
    const result = checkEnvDrift({ cwd: dir, roots: ['app'], files: [] });
    expect(result.usedKeys).toContain('OPENAI_API_KEY');
    expect(result.unusedInCode).toEqual([]);
  });

  it('keeps process.env mentions inside strings and comments ignored after URL stripping fix', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\n');
    await writeFixture('app/route.ts', [
      "const baseURL = 'https://example.com/v1';",
      "const literal = 'process.env.NOT_REAL';",
      '// process.env.COMMENT_ONLY',
      'const token = process.env.ADMIN_TOKEN;',
    ].join('\n'));
    const result = checkEnvDrift({ cwd: dir, roots: ['app'], files: [] });
    expect(result.usedKeys).toEqual(['ADMIN_TOKEN']);
    expect(result.missingInExample).toEqual([]);
  });

  it('warns on unused example keys unless they are planned prefixes', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\nWX_MERCHANT_ID=\nUNUSED_KEY=\n');
    await writeFixture('app/route.ts', 'const token = process.env.ADMIN_TOKEN;\n');
    const result = checkEnvDrift({ cwd: dir, roots: ['app'], files: [] });
    expect(result.unusedInCode).toEqual(['UNUSED_KEY']);
  });

  it('formats pass/fail summary for CLI and preflight', async () => {
    await writeFixture('.env.example', 'ADMIN_TOKEN=\n');
    await writeFixture('app/route.ts', 'const token = process.env.INTERNAL_TOKEN;\n');
    const report = formatEnvDriftReport(checkEnvDrift({ cwd: dir, roots: ['app'], files: [] }));
    expect(report).toContain('env drift check');
    expect(report).toContain('missing_in_example=1');
    expect(report).toContain('INTERNAL_TOKEN');
  });

  // F48：boot guard / wechat-pay / cos / openid-token 走 `env` 参数别名读取，
  // 旧版只认 process.env.X 字面 → 误报已接 key unused。集成层验证别名 key 不再 unused。
  it('detects keys read through an env alias bound to process.env (F48)', async () => {
    await writeFixture('.env.example', 'WXPAY_MCHID=\nWXPAY_NOTIFY_URL=\nGENUINELY_UNUSED=\n');
    await writeFixture('lib/wechat-pay-boot.ts', [
      'export function assertWechatPayConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {',
      '  if (!env.WXPAY_MCHID) throw new Error("missing mchid");',
      '  const notify = env.WXPAY_NOTIFY_URL ?? "";',
      '  return void notify;',
      '}',
    ].join('\n'));
    const result = checkEnvDrift({ cwd: dir, roots: ['lib'], files: [] });
    expect(result.usedKeys).toContain('WXPAY_MCHID');
    expect(result.usedKeys).toContain('WXPAY_NOTIFY_URL');
    // 红线反向：全仓没人引用的 key 仍必须落到 unusedInCode，drift 信号不被掩盖。
    expect(result.unusedInCode).toEqual(['GENUINELY_UNUSED']);
  });
});

describe('scanEnvKeysFromSource', () => {
  it('detects direct process.env.X and bracket access', () => {
    const keys = scanEnvKeysFromSource("const a = process.env.ADMIN_TOKEN; const b = process.env['INTERNAL_TOKEN'];");
    expect([...keys].sort()).toEqual(['ADMIN_TOKEN', 'INTERNAL_TOKEN']);
  });

  it('detects keys via a typed param alias bound to process.env', () => {
    const src = [
      'export function loadCosConfig(env: NodeJS.ProcessEnv = process.env) {',
      '  const id = env.COS_SECRET_ID;',
      '  const region = env.COS_REGION;',
      "  const bucket = env['COS_BUCKET'];",
      '  return { id, region, bucket };',
      '}',
    ].join('\n');
    expect([...scanEnvKeysFromSource(src)].sort()).toEqual(['COS_BUCKET', 'COS_REGION', 'COS_SECRET_ID']);
  });

  it('detects a non-typed local alias (const env = process.env)', () => {
    const keys = scanEnvKeysFromSource('const env = process.env;\nif (env.RATELIMIT_STRICT === "1") {}');
    expect([...keys]).toEqual(['RATELIMIT_STRICT']);
  });

  it('detects destructure from process.env', () => {
    const keys = scanEnvKeysFromSource('const { OPENID_SIGN_KEY, INTERNAL_TOKEN } = process.env;');
    expect([...keys].sort()).toEqual(['INTERNAL_TOKEN', 'OPENID_SIGN_KEY']);
  });

  it('does not treat unrelated object members as env reads (config.env.X)', () => {
    // `config.env` 不是 process.env 别名 → 不应把 NOT_AN_ENV 当 env key
    const keys = scanEnvKeysFromSource('const x = config.env.NOT_AN_ENV;\nconst y = settings.DB_HOST;');
    expect(keys.size).toBe(0);
  });

  it('does not alias a string read off process.env (x = process.env.FOO)', () => {
    // x 是字符串值不是 env 对象；FOO 走直接匹配进来，x.BAR 不应被当 env 读
    const keys = scanEnvKeysFromSource('const x = process.env.FOO;\nconst z = x.BAR;');
    expect([...keys]).toEqual(['FOO']);
  });
});

async function writeFixture(path: string, content: string) {
  const full = join(dir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}
