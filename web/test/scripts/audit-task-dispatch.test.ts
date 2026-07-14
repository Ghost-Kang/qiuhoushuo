/**
 * audit-task-dispatch 单测（PROCESS §3.7 派单分派状态护栏自动巡检）
 *
 * 用 fixture 仓库结构覆盖：
 *  - §4.1 全 placeholder → verdict='possibly_unimplemented'
 *  - §4.1 全填 + 有最近修改 → verdict='likely_implemented'
 *  - §4.1 部分填 → verdict='possibly_unimplemented'
 *  - §4.1 缺失 → verdict='no_section_41'
 *  - 0 recent file → verdict 降级
 *  - TASK 文件未找到 → throw
 *  - parseArgs 兼容性（间接通过 export 验）
 *  - formatReport 输出包含关键标识
 */
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditTaskDispatch, formatReport } from '@/scripts/audit-task-dispatch';

let repoRoot = '';

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'qhs-audit-'));
  await mkdir(join(repoRoot, 'tasks'), { recursive: true });
  await mkdir(join(repoRoot, 'web', 'lib'), { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

async function writeTask(name: string, body: string) {
  await writeFile(join(repoRoot, 'tasks', name), body);
}

async function writeTs(rel: string, content: string, mtimeMsAgo = 0) {
  const full = join(repoRoot, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
  if (mtimeMsAgo > 0) {
    const t = new Date(Date.now() - mtimeMsAgo);
    await utimes(full, t, t);
  }
}

describe('auditTaskDispatch', () => {
  it('detects all-placeholder §4.1 as possibly_unimplemented', async () => {
    await writeTask('TASK-99-test.md', [
      '# TASK-99 · test',
      '',
      '### 4.1 Codex 执行记录（待填）',
      '',
      '- H100：',
      '- H101：',
      '- 真链路 smoke 结果（或注明未跑）：',
      '',
      '---',
    ].join('\n'));
    const r = auditTaskDispatch({ taskId: 'TASK-99', repoRoot });
    expect(r.section41).toEqual({ filled: 0, total: 3 });
    expect(r.verdict).toBe('possibly_unimplemented');
  });

  it('detects fully-filled §4.1 + recent file as likely_implemented', async () => {
    await writeTask('TASK-100-test.md', [
      '# TASK-100',
      '',
      '### 4.1 Codex 执行记录',
      '',
      '- H110：完成 wrapper await 修改，2 行 diff',
      '- H111：新增 4 测试用例覆盖 wrapper rejection',
      '- 冷缓存 CI 双跑结果：web 58/426 全绿',
      '',
      '---',
    ].join('\n'));
    await writeTs('web/lib/foo.ts', 'export const x = 1;\n');
    const r = auditTaskDispatch({ taskId: 'TASK-100', repoRoot, ageMins: 60 });
    expect(r.section41).toEqual({ filled: 3, total: 3 });
    expect(r.recentFiles.length).toBeGreaterThan(0);
    expect(r.verdict).toBe('likely_implemented');
  });

  it('partial fill → possibly_unimplemented', async () => {
    await writeTask('TASK-101-x.md', [
      '### 4.1',
      '',
      '- H110：done with diff',
      '- H111：',
      '- H112：',
      '',
      '---',
    ].join('\n'));
    await writeTs('web/lib/y.ts', '//\n');
    const r = auditTaskDispatch({ taskId: 'TASK-101', repoRoot, ageMins: 60 });
    expect(r.section41).toEqual({ filled: 1, total: 3 });
    expect(r.verdict).toBe('possibly_unimplemented');
  });

  it('missing §4.1 → verdict=no_section_41', async () => {
    await writeTask('TASK-102-y.md', [
      '# TASK-102',
      '',
      '## 1. 背景',
      '',
      'nothing.',
    ].join('\n'));
    const r = auditTaskDispatch({ taskId: 'TASK-102', repoRoot });
    expect(r.section41).toEqual({ filled: 0, total: 0 });
    expect(r.verdict).toBe('no_section_41');
  });

  it('zero recent files even with filled §4.1 still flags possibly_unimplemented', async () => {
    await writeTask('TASK-103-z.md', [
      '### 4.1',
      '',
      '- H110：done',
      '- H111：also done with extra detail',
      '',
      '---',
    ].join('\n'));
    // 写文件并 backdate 远超 ageMins
    await writeTs('web/lib/old.ts', 'old\n', 24 * 60 * 60_000); // 24h ago
    const r = auditTaskDispatch({ taskId: 'TASK-103', repoRoot, ageMins: 60 });
    expect(r.section41.filled).toBe(2);
    expect(r.recentFiles).toHaveLength(0);
    expect(r.verdict).toBe('possibly_unimplemented');
  });

  it('throws when task file not found', () => {
    expect(() => auditTaskDispatch({ taskId: 'TASK-999', repoRoot })).toThrow(
      /no task file matching TASK-999/,
    );
  });

  it('ignores node_modules / .next / coverage / .git etc when scanning recent files', async () => {
    await writeTask('TASK-104-i.md', '### 4.1\n\n- H110：done\n\n---\n');
    await writeTs('web/lib/included.ts', '//\n');
    await writeTs('node_modules/pkg/index.ts', '//\n');
    await writeTs('.next/types/foo.ts', '//\n');
    await writeTs('coverage/lcov.ts', '//\n');
    const r = auditTaskDispatch({ taskId: 'TASK-104', repoRoot, ageMins: 60 });
    expect(r.recentFiles).toContain('web/lib/included.ts');
    expect(r.recentFiles).not.toContain('node_modules/pkg/index.ts');
    expect(r.recentFiles).not.toContain('.next/types/foo.ts');
    expect(r.recentFiles).not.toContain('coverage/lcov.ts');
  });

  it('handles bold markdown markers like "- **H110**:" in §4.1', async () => {
    await writeTask('TASK-105-b.md', [
      '### 4.1',
      '',
      '- **H110**：with bold markers and real content',
      '- **H111**：',
      '',
      '---',
    ].join('\n'));
    const r = auditTaskDispatch({ taskId: 'TASK-105', repoRoot, ageMins: 60 });
    expect(r.section41).toEqual({ filled: 1, total: 2 });
  });

  it('formatReport includes section header, verdict, and key labels', async () => {
    await writeTask('TASK-106-f.md', '### 4.1\n\n- H110：done\n\n---\n');
    await writeTs('web/lib/q.ts', '//\n');
    const r = auditTaskDispatch({ taskId: 'TASK-106', repoRoot, ageMins: 60 });
    const out = formatReport(r, 60);
    expect(out).toContain('TASK-106');
    expect(out).toContain('§4.1');
    expect(out).toContain('PROCESS §3.7');
    expect(out).toContain(`verdict: ${r.verdict}`);
  });
});
