import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { validateFixtureContent, validateFixtureDir } from '../../evals/validate-fixtures';

const VALID_FIXTURE = {
  id: 'm99',
  competition: '国际大赛小组赛',
  stage: 'group_stage_round_1',
  home: { team: '德国', score: 1 },
  away: { team: '日本', score: 2 },
  stats: {
    home_possession: 60, away_possession: 40,
    home_shots: 10, away_shots: 4,
    home_shots_on: 5, away_shots_on: 2,
    home_xg: 1.5, away_xg: 0.9,
    home_pass_acc: 84, away_pass_acc: 70,
    home_corners: 6, away_corners: 1,
    home_fouls: 9, away_fouls: 11,
    home_yellow: 1, away_yellow: 2,
    home_red: 0, away_red: 0,
  },
  key_events: [
    { minute: 33, type: 'goal', team: 'home', player: '京多安' },
    { minute: 75, type: 'goal', team: 'away', player: '堂安律' },
    { minute: 83, type: 'goal', team: 'away', player: '浅野拓磨' },
  ],
};

describe('validateFixtureContent', () => {
  it('passes a well-formed fixture', () => {
    const errors = validateFixtureContent('m99.json', JSON.stringify(VALID_FIXTURE));
    expect(errors).toEqual([]);
  });

  it('flags malformed JSON', () => {
    const errors = validateFixtureContent('broken.json', '{not json');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/invalid JSON/i);
  });

  it('flags trademark words anywhere in raw JSON', () => {
    const tainted = { ...VALID_FIXTURE, competition: '国际大赛小组赛 (FIFA 2026)' }; // trademark-allowed (反向断言)
    const errors = validateFixtureContent('m99.json', JSON.stringify(tainted));
    expect(errors.some((e) => e.message.includes('blocked event name'))).toBe(true);
  });

  it('flags missing stats fields', () => {
    const broken = JSON.parse(JSON.stringify(VALID_FIXTURE));
    delete broken.stats.home_xg;
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('stats.home_xg'))).toBe(true);
  });

  it('flags non-numeric stats fields', () => {
    const broken = JSON.parse(JSON.stringify(VALID_FIXTURE));
    broken.stats.home_shots = 'lots';
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('stats.home_shots'))).toBe(true);
  });

  it('flags possession sum outside 100±1', () => {
    const broken = JSON.parse(JSON.stringify(VALID_FIXTURE));
    broken.stats.home_possession = 70;
    broken.stats.away_possession = 40; // sum = 110
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('possession sum'))).toBe(true);
  });

  it('accepts possession sum within tolerance', () => {
    const ok = JSON.parse(JSON.stringify(VALID_FIXTURE));
    ok.stats.home_possession = 60;
    ok.stats.away_possession = 41; // sum = 101 (within ±1)
    const errors = validateFixtureContent('m99.json', JSON.stringify(ok));
    expect(errors.find((e) => e.message.includes('possession sum'))).toBeUndefined();
  });

  it('flags home score / goals mismatch', () => {
    const broken = JSON.parse(JSON.stringify(VALID_FIXTURE));
    broken.home.score = 5; // events have 1 home goal
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('home score mismatch'))).toBe(true);
  });

  it('flags unsorted key_events', () => {
    const broken = JSON.parse(JSON.stringify(VALID_FIXTURE));
    broken.key_events = [
      { minute: 83, type: 'goal', team: 'away', player: 'x' },
      { minute: 33, type: 'goal', team: 'home', player: 'y' },
      { minute: 75, type: 'goal', team: 'away', player: 'z' },
    ];
    broken.home.score = 1;
    broken.away.score = 2;
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('key_events must be sorted'))).toBe(true);
  });

  it('flags competition not starting with 国际大赛', () => {
    const broken = { ...VALID_FIXTURE, competition: 'Premier League' };
    const errors = validateFixtureContent('m99.json', JSON.stringify(broken));
    expect(errors.some((e) => e.message.includes('国际大赛'))).toBe(true);
  });
});

describe('validateFixtureDir (5 production fixtures)', () => {
  it('returns no errors for the shipping fixture set', () => {
    const dir = join(process.cwd(), 'evals/fixtures');
    const errors = validateFixtureDir(dir, 5);
    expect(errors).toEqual([]);
  });
});
