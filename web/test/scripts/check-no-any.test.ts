import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanForAnyAnnotations } from '@/scripts/check-no-any-annotation';

let dir = '';
const loose = 'any';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qhs-no-any-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('check-no-any annotation scanner', () => {
  it('returns no hits for clean fixtures', async () => {
    await writeFixture('lib/clean.ts', 'const x: number = 1;\n');
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['lib'] })).toEqual([]);
  });

  it('reports explicit scalar any annotations', async () => {
    await writeFixture('lib/bad.ts', `const x: ${loose} = 1;\n`);
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['lib'] })).toEqual([`lib/bad.ts:1:const x: ${loose} = 1;`]);
  });

  it('reports annotations with no space after colon', async () => {
    await writeFixture('lib/bad-nospace.ts', `const x:${loose} = 1;\nfunction f(req:${loose}) { return req; }\n`);
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['lib'] })).toEqual([
      `lib/bad-nospace.ts:1:const x:${loose} = 1;`,
      `lib/bad-nospace.ts:2:function f(req:${loose}) { return req; }`,
    ]);
  });

  it('reports explicit any array annotations', async () => {
    await writeFixture('test/bad.ts', `const calls: ${loose}[] = [];\n`);
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['test'] })).toEqual([`test/bad.ts:1:const calls: ${loose}[] = [];`]);
  });

  it('does not match longer type names that start with any', async () => {
    await writeFixture('app/safe.ts', `const handler: ${loose}Body = createHandler();\nconst t: ${loose}Type = createType();\n`);
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['app'] })).toEqual([]);
  });

  it('does not match patterns inside string literals with single quotes', async () => {
    await writeFixture('app/message.ts', `const message = 'message: ${loose}';\n`);
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['app'] })).toEqual([]);
  });

  it('does not match patterns inside double-quoted strings or template literals', async () => {
    await writeFixture('app/msgs.ts', [
      `const a = "warn: ${loose} user";`,
      `const b = \`error: ${loose} threshold\`;`,
      '',
    ].join('\n'));
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['app'] })).toEqual([]);
  });

  it('does not match patterns inside line or block comments', async () => {
    await writeFixture('app/cmt.ts', [
      `// example: ${loose} usage`,
      `/* note: ${loose} type */`,
      '',
    ].join('\n'));
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['app'] })).toEqual([]);
  });

  it('skips missing roots', () => {
    expect(scanForAnyAnnotations({ cwd: dir, roots: ['missing'] })).toEqual([]);
  });

  it('honors allowed prefixes', async () => {
    await writeFixture('scripts/allowed.ts', `const x: ${loose} = 1;\n`);
    expect(scanForAnyAnnotations({
      cwd: dir,
      roots: ['scripts'],
      allowed: ['scripts/allowed.ts:1:'],
    })).toEqual([]);
  });
});

async function writeFixture(path: string, content: string) {
  const full = join(dir, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
}
