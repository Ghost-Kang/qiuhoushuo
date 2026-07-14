import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatLintReport, lintFiles, lintTaskSpec } from '@/scripts/lint-task-spec';

let tasksRoot = '';
let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qhs-spec-lint-'));
  tasksRoot = join(root, 'tasks');
  await mkdir(tasksRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('lintTaskSpec', () => {
  it('passes all 8 checks for a complete spec', () => {
    const result = lintTaskSpec(completeSpec());
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('fails C1 when severity emoji is missing from §1', () => {
    const result = lintTaskSpec(completeSpec().replace('🟢', 'low'));
    expect(result.checks.find((c) => c.id === 'C1')?.ok).toBe(false);
  });

  it('fails C3 when fewer than 5 redlines are listed', () => {
    const result = lintTaskSpec(completeSpec().replace(/\n- \*\*R[4-6]\*\*[^\n]*/g, ''));
    expect(result.checks.find((c) => c.id === 'C3')?.ok).toBe(false);
  });

  it('fails C5 when reverse validation has fewer than 3 items', () => {
    const result = lintTaskSpec(completeSpec().replace(/临时删测试|临时改阈值|临时删脚本|未实现|删除文档/g, '普通验证'));
    expect(result.checks.find((c) => c.id === 'C5')?.ok).toBe(false);
  });

  it('fails C8 when §6 trade-off is missing', () => {
    const result = lintTaskSpec(completeSpec().replace(/## 6\. Trade-off[\s\S]*/, ''));
    expect(result.checks.find((c) => c.id === 'C8')?.ok).toBe(false);
  });

  it('reports mixed multi-file verdicts and respects explicit excludes', async () => {
    await writeTask('TASK-66-good.md', completeSpec());
    await writeTask('TASK-67-bad.md', completeSpec().replace('🟢', 'low'));
    const results = lintFiles({ tasksRoot, includeExempt: true });
    const report = formatLintReport(results);
    expect(report).toContain('TASK-66');
    expect(report).toContain('TASK-67');
    expect(report).toContain('1 ❌');
    const excluded = lintFiles({ tasksRoot, exclude: ['TASK-67'], includeExempt: true });
    expect(excluded.map((r) => r.taskId)).toEqual(['TASK-66']);
  });
});

async function writeTask(name: string, content: string) {
  await writeFile(join(tasksRoot, name), content);
}

function completeSpec() {
  return [
    '# TASK-99 · sample',
    '',
    '## 1. 背景',
    '🟢 low risk cleanup.',
    '',
    '## 2. 必修动作',
    '### H1 · do one thing',
    '### H2 · do another thing',
    '',
    '## 3. 红线',
    '- **R1**：不动 ci',
    '- **R2**：不加依赖',
    '- **R3**：不改生产逻辑',
    '- **R4**：不删测试',
    '- **R5**：不改配置',
    '- **R6**：不越界',
    '',
    '## 4. 实测与验证',
    '### 4.1 实测表',
    '| # | 实测项 | 期望 | 反向验证 |',
    '|---|---|---|---|',
    '| 1 | test | pass | 临时删测试 → 红 |',
    '| 2 | lint | pass | 临时改阈值 → 红 |',
    '| 3 | grep | pass | 临时删脚本 → 红 |',
    '| 4 | ci | pass | 未实现 → 红 |',
    '| 5 | docs | pass | 删除文档 → 红 |',
    '',
    '### 4.2 grep 验证',
    '```bash',
    'rg "H1" tasks/TASK-99-sample.md',
    '```',
    '',
    '## 5. 沟通',
    '完成后更新 STATUS。',
    '',
    '## 6. Trade-off',
    '不接 CI，手动跑。',
    '',
  ].join('\n');
}
