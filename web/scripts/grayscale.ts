import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

type CliIo = {
  envPath?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  readLine?: (question: string) => Promise<string>;
};

const DEFAULT_ENV_PATH = resolve(process.cwd(), '.env.local');

export async function runGrayscale(argv: string[], io: CliIo = {}): Promise<number> {
  const out = io.stdout ?? console.log;
  const err = io.stderr ?? console.error;
  const envPath = io.envPath ?? DEFAULT_ENV_PATH;
  const [cmd, flag, value] = argv;
  try {
    if (cmd === 'list') {
      const env = await readEnvFile(envPath);
      const flags = listFlags(env);
      out(flags.length ? flags.join('\n') : '(no feature flags)');
      return 0;
    }
    if (cmd === 'set') {
      await setFlagInEnvFile(envPath, requireFlag(flag), requirePercent(value));
      out(`${flag}=${value}`);
      return 0;
    }
    if (cmd === 'full') {
      await setFlagInEnvFile(envPath, requireFlag(flag), 100);
      out(`${flag}=100`);
      return 0;
    }
    if (cmd === 'rollback') {
      await setFlagInEnvFile(envPath, requireFlag(flag), 0);
      out(`${flag}=0`);
      return 0;
    }
    if (cmd === 'panic') {
      const answer = await prompt(io, 'Type yes-panic-all to rollback all feature flags: ');
      if (answer !== 'yes-panic-all') {
        err('panic aborted');
        return 1;
      }
      await panicRollback(envPath);
      out('all feature flags set to 0');
      return 0;
    }
    if (cmd === 'finals-on') {
      await setFlagInEnvFile(envPath, 'feature.finals_mode', 100);
      out('feature.finals_mode=100');
      return 0;
    }
    if (cmd === 'finals-off') {
      await setFlagInEnvFile(envPath, 'feature.finals_mode', 0);
      out('feature.finals_mode=0');
      return 0;
    }
    err('usage: grayscale.ts list | set <feature.flag> <0-100> | full <feature.flag> | rollback <feature.flag> | finals-on | finals-off | panic');
    return 1;
  } catch (e) {
    err((e as Error).message);
    return 1;
  }
}

export async function setFlagInEnvFile(envPath: string, flag: string, percent: number): Promise<void> {
  const env = await readEnvFile(envPath);
  await writeEnvFile(envPath, upsertEnv(env, envKeyForFlag(flag), String(percent)));
}

export function envKeyForFlag(flag: string): string {
  requireFlag(flag);
  return `FEATURE_FLAG_${flag.replace(/^feature\./, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

async function panicRollback(envPath: string) {
  const env = await readEnvFile(envPath);
  const next = env
    .split('\n')
    .map((line) => line.replace(/^(FEATURE_FLAG_[A-Z0-9_]+=).*/, (_match, prefix) => `${prefix}0`))
    .join('\n');
  await writeEnvFile(envPath, next);
}

function listFlags(env: string) {
  return env
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^FEATURE_FLAG_[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const [key = '', rawValue = ''] = line.split('=');
      return `${keyToFlag(key)}=${rawValue}`;
    });
}

function keyToFlag(key: string) {
  return `feature.${key.replace(/^FEATURE_FLAG_/, '').toLowerCase()}`;
}

function upsertEnv(env: string, key: string, value: string) {
  const lines = env.length ? env.split('\n') : [];
  const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}

async function readEnvFile(envPath: string) {
  try {
    return await readFile(envPath, 'utf8');
  } catch {
    return '';
  }
}

async function writeEnvFile(envPath: string, content: string) {
  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, content);
}

function requireFlag(flag?: string) {
  if (!flag || !/^feature\.[a-z0-9][a-z0-9_.-]*$/.test(flag)) {
    throw new Error('flag must look like feature.chat');
  }
  return flag;
}

function requirePercent(value?: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('percent must be an integer from 0 to 100');
  return n;
}

async function prompt(io: CliIo, question: string) {
  if (io.readLine) return io.readLine(question);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runGrayscale(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
