import { describe, expect, it } from 'vitest';
import { buildLaoliReferenceRequest, LAOLI_REFERENCE_PROMPT } from '@/lib/api/laoli-reference';

describe('laoli reference image policy', () => {
  it('locks the approved non-photorealistic persona and clean background constraints', () => {
    expect(LAOLI_REFERENCE_PROMPT).toContain('半写实数字插画风');
    expect(LAOLI_REFERENCE_PROMPT).toContain('非照片级写实人脸');
    expect(LAOLI_REFERENCE_PROMPT).toContain('空白本');
    expect(LAOLI_REFERENCE_PROMPT).toContain('关闭黑屏');
    expect(LAOLI_REFERENCE_PROMPT).toContain('无任何可读文字');
  });

  it('forces provider watermark on with no environment escape hatch', () => {
    const request = buildLaoliReferenceRequest({
      apiKey: 'key',
      baseURL: 'https://ark.example',
      model: 'seedream',
      size: '2K',
      watermark: false,
      timeoutMs: 1000,
    });
    expect(request.watermark).toBe(true);
    expect(request).toMatchObject({ model: 'seedream', size: '2K', response_format: 'url' });
  });
});
