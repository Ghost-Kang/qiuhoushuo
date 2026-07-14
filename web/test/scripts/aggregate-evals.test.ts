import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregateRun, formatAggregate, formatCompare, parseCsv } from '@/scripts/aggregate-evals';

let root = '';
let runsDir = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qhs-evals-agg-'));
  runsDir = join(root, 'runs');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('aggregate-evals', () => {
  it('aggregates a complete 5-reviewer scoresheet with decisions and quoted notes', async () => {
    await writeRun('run-a', csvRows(['PM', '后端1', '后端2', '内容', '客服'], { brand: 2.8, note: '事实清晰, 但节奏慢' }));
    const report = formatAggregate(aggregateRun('run-a', { runsDir }));
    expect(report).toContain('评审完成数**：5/5');
    expect(report).toContain('| fact_acc | 3.60 | ✅ ≥ 3.5 GREEN |');
    expect(report).toContain('| brand_voice | 2.80 | 🔴 < 3.0 RED → 触发 v1.1 |');
    expect(report).toContain('"事实清晰, 但节奏慢"');
  });

  it('reports partial reviewer completion while still calculating available means', async () => {
    await writeRun('run-partial', csvRows(['PM', '后端1', '内容'], { brand: 3.2 }));
    const report = formatAggregate(aggregateRun('run-partial', { runsDir }));
    expect(report).toContain('评审完成数**：3/5');
    expect(report).toContain('Warning');
    expect(report).toContain('🟡 3.0-3.5 YELLOW');
  });

  it('skips blank dimension cells without dropping other dimensions', async () => {
    await writeRun('run-missing', [
      'reviewer,fixture_id,style,fact_acc,tone_match,brand_voice,share_vibe,notes',
      'PM,m01,hardcore,,4,3,3,blank fact',
      '后端1,m01,hardcore,5,4,3,3,filled',
    ].join('\n'));
    const report = formatAggregate(aggregateRun('run-missing', { runsDir }));
    expect(report).toContain('| fact_acc | 5.00 | ✅ ≥ 3.5 GREEN |');
    expect(report).toContain('| tone_match | 4.00 | ✅ ≥ 3.5 GREEN |');
  });

  it('compares two runs side by side', async () => {
    await writeRun('doubao', csvRows(['PM'], { fact: 4, brand: 4 }));
    await writeRun('deepseek', csvRows(['PM'], { fact: 3, brand: 3 }));
    const report = formatCompare(aggregateRun('doubao', { runsDir }), aggregateRun('deepseek', { runsDir }));
    expect(report).toContain('EVALS 对比 · doubao vs deepseek');
    expect(report).toContain('| fact_acc | 4.00 | 3.00 | 1.00 |');
    expect(report).toContain('| 加权平均 |');
  });

  it('throws a clear error for invalid csv shape', () => {
    expect(() => parseCsv('a,b,c,d,e,f,g,h\n1,2,3\n')).toThrow(/row 2 has 3 columns/);
    expect(() => parseCsv('\n')).toThrow(/empty/);
  });

  it('supports the legacy match_id and *_1to5 scoresheet columns', async () => {
    await writeRun('legacy', [
      'match_id,style,reviewer,fact_acc_1to5,tone_match_1to5,brand_voice_1to5,share_vibe_1to5,avg,auto_schema_pass,auto_trademark_clean,notes',
      'm01,duanzi,PM,4,3,3,4,,true,true,ok',
    ].join('\n'));
    const report = formatAggregate(aggregateRun('legacy', { runsDir }));
    expect(report).toContain('| duanzi | 4.00 | 3.00 | 3.00 | 4.00 |');
  });
});

async function writeRun(runId: string, csv: string) {
  const dir = join(runsDir, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'scoresheet.csv'), `${csv}\n`);
}

function csvRows(reviewers: string[], opts: { fact?: number; brand?: number; note?: string } = {}) {
  return [
    'reviewer,fixture_id,style,fact_acc,tone_match,brand_voice,share_vibe,notes',
    ...reviewers.map((reviewer) => `${reviewer},m01,hardcore,${opts.fact ?? 3.6},3.2,${opts.brand ?? 3.4},3.4,"${opts.note ?? 'ok'}"`),
  ].join('\n');
}
