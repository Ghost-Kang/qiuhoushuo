import { describe, expect, it } from 'vitest';
import {
  buildScoresheetCsv,
  fixtureToMatchData,
  parseArgs,
} from '../../evals/run-evals';
import { FIXTURES } from '../../evals/fixtures';

describe('parseArgs', () => {
  it('defaults to dry mode (no LLM)', () => {
    expect(parseArgs([])).toEqual({ runLLM: false });
  });

  it('flips runLLM on --run-llm', () => {
    expect(parseArgs(['--run-llm'])).toEqual({ runLLM: true });
  });

  it('captures --provider', () => {
    expect(parseArgs(['--run-llm', '--provider', 'deepseek'])).toEqual({
      runLLM: true,
      provider: 'deepseek',
    });
  });

  it('ignores unknown flags without throwing', () => {
    expect(parseArgs(['--noisy', '--run-llm'])).toEqual({ runLLM: true });
  });
});

describe('fixtureToMatchData', () => {
  it('shapes m01 fixture into MatchData with both team events resolved', () => {
    const m01 = FIXTURES[0];
    const data = fixtureToMatchData(m01);
    expect(data.match).toBe(`${m01.home.team} vs ${m01.away.team}`);
    expect(data.final_score).toBe(`${m01.home.score}:${m01.away.score}`);
    expect(data.date).toBe(m01.kickoff_iso.slice(0, 10));
    expect(data.stats.possession).toEqual({
      home: m01.stats.home_possession,
      away: m01.stats.away_possession,
    });
    expect(data.events.length).toBeGreaterThan(0);
    for (const e of data.events) {
      expect([m01.home.team, m01.away.team]).toContain(e.team);
    }
  });

  it('drops event types outside VALID_EVENT_TYPES', () => {
    const tainted = JSON.parse(JSON.stringify(FIXTURES[0]));
    tainted.key_events.push({ minute: 90, type: 'corner', team: 'home', player: '边后卫' });
    const data = fixtureToMatchData(tainted);
    expect(data.events.find((e) => (e.type as string) === 'corner')).toBeUndefined();
  });
});

describe('buildScoresheetCsv', () => {
  it('emits header + 5 × 3 × 5 = 75 rows for the 5-fixture set', () => {
    const csv = buildScoresheetCsv(new Map());
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1 + 5 * 3 * 5); // header + matrix
    expect(lines[0]).toBe(
      'match_id,style,reviewer,fact_acc_1to5,tone_match_1to5,brand_voice_1to5,share_vibe_1to5,avg,auto_schema_pass,auto_trademark_clean,notes',
    );
  });

  it('fills auto_schema_pass and auto_trademark_clean from the autoFlags map', () => {
    const flags = new Map<string, { schema_pass: boolean; trademark_clean: boolean }>();
    flags.set('m01-hardcore', { schema_pass: true, trademark_clean: true });
    flags.set('m02-duanzi', { schema_pass: false, trademark_clean: true });

    const csv = buildScoresheetCsv(flags);
    const lines = csv.trim().split('\n');
    const hardcoreRow = lines.find((l) => l.startsWith('m01,hardcore,PM,'));
    const duanziRow = lines.find((l) => l.startsWith('m02,duanzi,PM,'));
    expect(hardcoreRow).toContain(',true,true,');
    expect(duanziRow).toContain(',false,true,');
  });

  it('defaults missing fixture/style keys to (false,false)', () => {
    const csv = buildScoresheetCsv(new Map());
    const lines = csv.trim().split('\n');
    const sample = lines.find((l) => l.startsWith('m03,emotion,内容,'));
    expect(sample).toBeDefined();
    expect(sample).toContain(',false,false,');
  });

  it('CSV-escapes commas / quotes via header check', () => {
    // The header itself has no commas inside fields, so it should not be quoted.
    const csv = buildScoresheetCsv(new Map());
    expect(csv.split('\n')[0]).not.toMatch(/^"/);
  });
});
