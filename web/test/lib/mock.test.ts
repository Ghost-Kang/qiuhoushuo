import { describe, expect, it } from 'vitest';
import { mockReport } from '@/lib/api/mock';

describe('mockReport', () => {
  it('ending contains AIGC footer', () => {
    const report = mockReport();
    expect(report.hardcore.ending).toContain('【AI 生成内容】');
    expect(report.duanzi.ending).toContain('【AI 生成内容】');
    expect(report.emotion.ending).toContain('【AI 生成内容】');
  });
});
