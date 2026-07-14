import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGrayscale } from '@/scripts/grayscale';

let dir = '';
let envPath = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qhs-grayscale-'));
  envPath = join(dir, '.env.local');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('grayscale CLI', () => {
  it('set updates .env.local without losing other vars', async () => {
    await writeFile(envPath, 'SUPABASE_URL=https://example.supabase.co\nFEATURE_FLAG_CHAT=5\n');
    const output: string[] = [];
    const code = await runGrayscale(['set', 'feature.chat', '20'], { envPath, stdout: (s) => output.push(s) });
    expect(code).toBe(0);
    expect(await readFile(envPath, 'utf8')).toBe('SUPABASE_URL=https://example.supabase.co\nFEATURE_FLAG_CHAT=20\n');
    expect(output).toEqual(['feature.chat=20']);
  });

  it('panic requires confirmation', async () => {
    await writeFile(envPath, 'FEATURE_FLAG_CHAT=20\nFEATURE_FLAG_PAYMENT=10\n');
    const errors: string[] = [];
    const code = await runGrayscale(['panic'], {
      envPath,
      stderr: (s) => errors.push(s),
      readLine: async () => 'no',
    });
    expect(code).toBe(1);
    expect(errors).toEqual(['panic aborted']);
    expect(await readFile(envPath, 'utf8')).toContain('FEATURE_FLAG_CHAT=20');
  });

  it('list shows current snapshot from .env', async () => {
    await writeFile(envPath, 'FEATURE_FLAG_CHAT=20\nFEATURE_FLAG_HOST_INTRO_CARD=100\nOTHER=keep\n');
    const output: string[] = [];
    const code = await runGrayscale(['list'], { envPath, stdout: (s) => output.push(s) });
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('feature.chat=20');
    expect(output.join('\n')).toContain('feature.host_intro_card=100');
  });

  it('finals-on sets feature.finals_mode=100', async () => {
    const output: string[] = [];
    const code = await runGrayscale(['finals-on'], { envPath, stdout: (s) => output.push(s) });
    expect(code).toBe(0);
    expect(await readFile(envPath, 'utf8')).toBe('FEATURE_FLAG_FINALS_MODE=100\n');
    expect(output).toEqual(['feature.finals_mode=100']);
  });

  it('finals-off sets feature.finals_mode=0', async () => {
    await writeFile(envPath, 'FEATURE_FLAG_FINALS_MODE=100\n');
    const output: string[] = [];
    const code = await runGrayscale(['finals-off'], { envPath, stdout: (s) => output.push(s) });
    expect(code).toBe(0);
    expect(await readFile(envPath, 'utf8')).toBe('FEATURE_FLAG_FINALS_MODE=0\n');
    expect(output).toEqual(['feature.finals_mode=0']);
  });
});
