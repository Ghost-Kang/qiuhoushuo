import { describe, expect, it, vi } from 'vitest';
import { loadReelBackgrounds, resolveSceneBackground } from '@/lib/api/laoli-reel-assets';
import { CARD_RENDER_CACHE_VERSION, type CardStorageClient } from '@/lib/api/card-storage';

function storageWith(map: Record<string, Buffer>): CardStorageClient {
  return {
    put: async () => 'memory://x',
    exists: async () => false,
    getBytes: async (k: string) => map[k] ?? null,
  } as unknown as CardStorageClient;
}

describe('loadReelBackgrounds', () => {
  it('brief/ratings/ft 全走 getBytes(reportId key·含缓存版本)命中', async () => {
    const briefKey = `cards/${CARD_RENDER_CACHE_VERSION}/rep1/brief-full-xhs.png`;
    const ratingsKey = `cards/${CARD_RENDER_CACHE_VERSION}/rep1/ratings-full-xhs.png`;
    const ftKey = `cards/${CARD_RENDER_CACHE_VERSION}/rep1/ft-full-xhs.png`;
    const fetchImpl = vi.fn(); // 不应被调(getBytes 命中)
    const bg = await loadReelBackgrounds({
      matchId: 'm1', reportId: 'rep1',
      storage: storageWith({
        [briefKey]: Buffer.from('B'),
        [ratingsKey]: Buffer.from('R'),
        [ftKey]: Buffer.from('F'),
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bg.brief?.toString()).toBe('B');
    expect(bg.ratings?.toString()).toBe('R');
    expect(bg.ft?.toString()).toBe('F');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('getBytes miss → 127.0.0.1 inline,且 URL 绝不含 CDN img.qiuhoushuo.cn', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('variant=brief')) return new Response(new Uint8Array([1]), { status: 200 });
      return new Response('no', { status: 404 }); // ratings 404
    });
    const bg = await loadReelBackgrounds({
      matchId: 'm9', reportId: 'rep9', storage: storageWith({}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bg.brief).toBeInstanceOf(Buffer);
    expect(bg.ratings).toBeUndefined(); // 404 → undefined
    expect(bg.ft).toBeUndefined();
    expect(urls.every((u) => u.startsWith('http://127.0.0.1:3000/api/card/m9'))).toBe(true);
    expect(urls.some((u) => u.includes('img.qiuhoushuo.cn'))).toBe(false);
    expect(urls.some((u) => u.includes('variant=ft'))).toBe(true);
  });

  it('briefHint 复用,免重复请求 brief', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 404 }));
    const bg = await loadReelBackgrounds({
      matchId: 'm1', reportId: 'rep1', storage: storageWith({}),
      fetchImpl: fetchImpl as unknown as typeof fetch, briefHint: Buffer.from('HINT'),
    });
    expect(bg.brief?.toString()).toBe('HINT');
    // 只请求了 ratings + ft(brief 用 hint)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('resolveSceneBackground 降级', () => {
  const bg = { brief: Buffer.from('B'), ratings: undefined, highlight: undefined };
  it('ratings 缺 → brief(无 ft 时)', () => {
    expect(resolveSceneBackground('ratings', bg)?.buf.toString()).toBe('B');
  });
  it('highlight 缺 → brief(无 ft 时)', () => {
    expect(resolveSceneBackground('highlight', bg)?.buf.toString()).toBe('B');
  });
  it('brief 也缺 → null(走标题兜底)', () => {
    expect(resolveSceneBackground('brief', { })).toBeNull();
  });
  it('有 ft 时 brief 位优先 ft;highlight 缺也先回 ft', () => {
    const withFt = { ...bg, ft: Buffer.from('F') };
    expect(resolveSceneBackground('brief', withFt)?.buf.toString()).toBe('F');
    expect(resolveSceneBackground('highlight', withFt)?.buf.toString()).toBe('F');
    expect(resolveSceneBackground('ratings', withFt)?.buf.toString()).toBe('F'); // ratings 缺 → ft
  });
  it('ratings 在时不被 ft 抢位', () => {
    const full = { brief: Buffer.from('B'), ratings: Buffer.from('R'), ft: Buffer.from('F'), highlight: undefined };
    expect(resolveSceneBackground('ratings', full)?.buf.toString()).toBe('R');
  });
});
