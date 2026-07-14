import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = { scripts: Record<string, string> };

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson;

describe('package.json ci script determinism', () => {
  it('runs build before lint so .next/types is fresh', () => {
    const ci = script('ci');
    const buildIdx = ci.indexOf('pnpm build');
    const lintIdx = ci.indexOf('pnpm lint');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeLessThan(lintIdx);
  });

  it('lint disables incremental for a fresh tsc check', () => {
    expect(script('lint')).toContain('--incremental false');
  });

  it('runs coverage after lint', () => {
    const ci = script('ci');
    expect(ci.indexOf('pnpm lint')).toBeLessThan(ci.indexOf('pnpm test:coverage'));
  });

  it('runs static gates before build', () => {
    const ci = script('ci');
    expect(ci.indexOf('pnpm check:trademark')).toBeLessThan(ci.indexOf('pnpm build'));
    expect(ci.indexOf('pnpm check:no-any')).toBeLessThan(ci.indexOf('pnpm build'));
  });

  it('includes evals validation to keep fixture gates wired', () => {
    expect(script('ci')).toContain('pnpm evals:validate');
  });

  it('runs share-cards workspace tests last', () => {
    const ci = script('ci');
    const shareIdx = ci.indexOf('@qhs/share-cards');
    const coverageIdx = ci.indexOf('pnpm test:coverage');
    expect(shareIdx).toBeGreaterThan(-1);
    expect(shareIdx).toBeGreaterThan(coverageIdx);
  });

  it('never swallows errors in the ci chain', () => {
    const ci = script('ci');
    expect(ci).not.toContain('|| true');
    expect(ci).not.toContain('; pnpm');
  });
});

function script(name: string) {
  const value = pkg.scripts[name];
  expect(value).toBeTruthy();
  return value || '';
}
