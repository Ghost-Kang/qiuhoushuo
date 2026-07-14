import { afterEach, describe, expect, it, vi } from 'vitest';

const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=',
  'base64',
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('renderShareCard highlight image handling', () => {
  it('embeds highlight image URL as a data URL before rendering', async () => {
    const renderCard = vi.fn(async () => MOCK_PNG);
    vi.doMock('@qhs/share-cards', () => ({ renderCard }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MOCK_PNG, {
      headers: { 'content-type': 'image/png' },
    })));

    const { renderShareCard } = await import('@/lib/share-cards');
    await renderShareCard('duanzi', 'wechat', basePayload('https://img.example.com/highlight.png'));

    expect(renderCard).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      highlightMoment: expect.objectContaining({
        image_url: `data:image/png;base64,${MOCK_PNG.toString('base64')}`,
      }),
    }));
  });

  it('omits highlight image when download fails so templates can use fallback art', async () => {
    const renderCard = vi.fn(async () => MOCK_PNG);
    vi.doMock('@qhs/share-cards', () => ({ renderCard }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    const { renderShareCard } = await import('@/lib/share-cards');
    await renderShareCard('duanzi', 'wechat', basePayload('https://img.example.com/missing.png'));

    expect(renderCard).toHaveBeenCalledWith('duanzi', 'wechat', expect.objectContaining({
      highlightMoment: expect.objectContaining({
        image_url: undefined,
      }),
    }));
  });
});

function basePayload(imageUrl: string) {
  return {
    competition: '国际大赛',
    date: '2026.06.09',
    homeTeam: '阿根廷',
    awayTeam: '沙特阿拉伯',
    homeScore: 1,
    awayScore: 2,
    title: '测试标题',
    shareQuote: '测试金句',
    brand: '超帧球后说 · AI 生成',
    shortUrl: 'qiuhoushuo.com/m/test',
    highlightMoment: {
      title: '沙特阿拉伯把比分写进镜头',
      description: '关键进球',
      image_url: imageUrl,
    },
  };
}
