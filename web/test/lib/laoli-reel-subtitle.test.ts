import { describe, expect, it } from 'vitest';
import { renderReelSubtitlePng, renderReelWatermarkPng, renderReelTitleBgPng } from '@/lib/api/laoli-reel-subtitle';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(PNG_MAGIC);

describe('laoli-reel-subtitle', () => {
  it('字幕 → 透明 PNG', async () => {
    expect(isPng(await renderReelSubtitlePng('约旦1:3阿根廷，梅西替补登场杀疯了'))).toBe(true);
  });
  it('空文本不崩 → PNG', async () => {
    expect(isPng(await renderReelSubtitlePng(''))).toBe(true);
  });
  it('水印 → PNG', async () => {
    expect(isPng(await renderReelWatermarkPng())).toBe(true);
  });
  it('标题兜底底图 → PNG', async () => {
    expect(isPng(await renderReelTitleBgPng('约旦 1:3 阿根廷 · 老李赛后说'))).toBe(true);
  });
});
