import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const STATS_FIELDS = [
  'home_possession',
  'away_possession',
  'home_shots',
  'away_shots',
  'home_shots_on',
  'away_shots_on',
  'home_xg',
  'away_xg',
  'home_pass_acc',
  'away_pass_acc',
  'home_corners',
  'away_corners',
  'home_fouls',
  'away_fouls',
  'home_yellow',
  'away_yellow',
  'home_red',
  'away_red',
] as const;

// 禁词正则。本行是 fixture 商标自检的实现，行级豁免见 web/scripts/check-trademark.ts
const BLOCKED = [/FIFA/i, /世界杯/i, /World\s*Cup/i]; // trademark-allowed

export interface FixtureValidationError {
  id: string;
  message: string;
}

type FixtureTeam = { score: number };
type FixtureKeyEvent = { minute: number; type: string; team: string };
type FixtureStats = Partial<Record<(typeof STATS_FIELDS)[number], number>>;
type EvalFixture = {
  id?: string;
  competition?: string;
  home?: FixtureTeam;
  away?: FixtureTeam;
  stats?: FixtureStats;
  key_events?: FixtureKeyEvent[];
};

export function validateFixtureContent(idHint: string, raw: string): FixtureValidationError[] {
  const errors: FixtureValidationError[] = [];
  let fixture: EvalFixture;
  try {
    fixture = JSON.parse(raw);
  } catch (err) {
    return [{ id: idHint, message: `invalid JSON: ${(err as Error).message}` }];
  }
  const id = fixture.id || idHint;
  const push = (message: string) => errors.push({ id, message });

  for (const word of BLOCKED) {
    if (word.test(raw)) push('blocked event name appears in JSON');
  }

  for (const field of STATS_FIELDS) {
    if (typeof fixture.stats?.[field] !== 'number') push(`stats.${field} must be number`);
  }

  if (typeof fixture.stats?.home_possession === 'number' && typeof fixture.stats?.away_possession === 'number') {
    const poss = fixture.stats.home_possession + fixture.stats.away_possession;
    if (Math.abs(poss - 100) > 1) push(`possession sum must be 100±1, got ${poss}`);
  }

  if (Array.isArray(fixture.key_events) && fixture.home && fixture.away) {
    const homeGoals = fixture.key_events.filter((e: { type: string; team: string }) => e.type === 'goal' && e.team === 'home').length;
    const awayGoals = fixture.key_events.filter((e: { type: string; team: string }) => e.type === 'goal' && e.team === 'away').length;
    if (homeGoals !== fixture.home.score) push(`home score mismatch: score ${fixture.home.score}, goals ${homeGoals}`);
    if (awayGoals !== fixture.away.score) push(`away score mismatch: score ${fixture.away.score}, goals ${awayGoals}`);

    for (let i = 1; i < fixture.key_events.length; i += 1) {
      const current = fixture.key_events[i];
      const previous = fixture.key_events[i - 1];
      if (current && previous && current.minute < previous.minute) {
        push('key_events must be sorted by minute');
        break;
      }
    }
  }

  if (typeof fixture.competition !== 'string' || !fixture.competition.startsWith('国际大赛')) {
    push('competition must start with 国际大赛');
  }

  return errors;
}

export function validateFixtureDir(dir: string, expectedCount = 5): FixtureValidationError[] {
  const files = readdirSync(dir).filter((name) => /^m\d\d\.json$/.test(name)).sort();
  const errors: FixtureValidationError[] = [];
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    errors.push(...validateFixtureContent(file, raw));
  }
  if (files.length !== expectedCount) {
    errors.push({ id: 'fixtures', message: `expected ${expectedCount} JSON fixtures, got ${files.length}` });
  }
  return errors;
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  const dir = join(process.cwd(), 'evals/fixtures');
  const errors = validateFixtureDir(dir);
  if (errors.length > 0) {
    console.error(errors.map((e) => `${e.id}: ${e.message}`).join('\n'));
    process.exit(1);
  }
}
