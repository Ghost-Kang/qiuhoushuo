import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAlertCallScan, scanAlertCallSites } from '@/scripts/scan-alert-calls';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qhs-alert-scan-'));
  await mkdir(join(dir, 'lib'), { recursive: true });
  await mkdir(join(dir, 'app'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('scanAlertCallSites', () => {
  it('finds fire-and-forget alert calls', async () => {
    await writeFixture('lib/a.ts', 'notifyOpsFireAndForget({ severity: "P1", title: "x", body: "" });\n');
    const sites = scanAlertCallSites(dir);
    expect(sites).toEqual([
      expect.objectContaining({ file: 'lib/a.ts', line: 1, kind: 'notifyOpsFireAndForget' }),
    ]);
  });

  it('also finds raw void notifyOps calls so F21-style scans cannot miss them', async () => {
    await writeFixture('lib/raw.ts', 'void notifyOps({ severity: "P1", title: "x", body: "" });\n');
    const sites = scanAlertCallSites(dir);
    expect(sites).toEqual([
      expect.objectContaining({ file: 'lib/raw.ts', line: 1, kind: 'voidNotifyOps' }),
    ]);
  });

  it('excludes alerts.ts wrapper internals and formats a summary', async () => {
    await writeFixture('lib/alerts.ts', 'void notifyOps(payload, opts);\n');
    await writeFixture('app/route.ts', 'notifyOpsFireAndForget({ severity: "P1", title: "x", body: "" });\n');
    const report = formatAlertCallScan(scanAlertCallSites(dir));
    expect(report).toContain('alert call scan');
    expect(report).toContain('void_notifyOps=0');
    expect(report).toContain('app/route.ts:1');
  });
});

async function writeFixture(path: string, content: string) {
  const full = join(dir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}
