/**
 * applyAIGCFooterForDisplay 测试（W3 末 AIGC 合规缺口修复）
 *
 * 设计意图：
 * - 不修改原 report 对象（落库纯净）
 * - ending 末尾附 `【AI 生成内容】`
 * - 其他字段不动
 */
import { describe, expect, it } from 'vitest';
import { applyAIGCFooterForDisplay, type GeneratedReport } from '@/lib/report';

function makeReport(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    style: 'hardcore',
    title: 'title example',
    subtitle: 'sub',
    lead: 'lead 200 字摘要',
    body: ['段一', '段二'],
    ending: '收尾段落，叙事告一段落。',
    share_quote: '一句话金句',
    tags: ['战报', 'hardcore'],
    promptVersion: '2026.05.09-v1',
    meta: {
      provider: 'doubao',
      model: 'doubao-pro-32k',
      latencyMs: 1234,
      safetyPassed: true,
    },
    ...overrides,
  };
}

describe('applyAIGCFooterForDisplay', () => {
  it('appends "AI 生成内容" footer to ending', () => {
    const r = applyAIGCFooterForDisplay(makeReport({ ending: '原结尾' }));
    expect(r.ending).toBe('原结尾\n\n【AI 生成内容】');
  });

  it('does not mutate input report (落库数据纯净)', () => {
    const original = makeReport({ ending: '原结尾保留' });
    const displayed = applyAIGCFooterForDisplay(original);
    expect(original.ending).toBe('原结尾保留');
    expect(displayed).not.toBe(original); // 新对象
  });

  it('preserves all other fields verbatim', () => {
    const original = makeReport();
    const displayed = applyAIGCFooterForDisplay(original);
    expect(displayed.title).toBe(original.title);
    expect(displayed.subtitle).toBe(original.subtitle);
    expect(displayed.lead).toBe(original.lead);
    expect(displayed.body).toEqual(original.body);
    expect(displayed.share_quote).toBe(original.share_quote);
    expect(displayed.tags).toEqual(original.tags);
    expect(displayed.style).toBe(original.style);
    expect(displayed.promptVersion).toBe(original.promptVersion);
    expect(displayed.meta).toEqual(original.meta);
  });

  it('works on fallback reports (provider=fallback)', () => {
    const r = applyAIGCFooterForDisplay(
      makeReport({ meta: { provider: 'fallback', model: 'template', latencyMs: 0, safetyPassed: true } }),
    );
    expect(r.ending).toContain('【AI 生成内容】');
    expect(r.meta.provider).toBe('fallback');
  });
});
