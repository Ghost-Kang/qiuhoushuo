import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetMemoryCardStorageForTests,
  buildCardKey,
  CARD_RENDER_CACHE_VERSION,
  cosObjectUrl,
  createCosCardStorage,
  createMemoryCardStorage,
  getCardStorage,
  loadCosConfig,
  type CosConfig,
  type CosLike,
} from '@/lib/api/card-storage';

const COS_KEYS = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION', 'COS_CDN_BASE_URL'];

afterEach(() => {
  __resetMemoryCardStorageForTests();
  for (const k of COS_KEYS) delete process.env[k];
});

function cfg(over: Partial<CosConfig> = {}): CosConfig {
  return { secretId: 'id', secretKey: 'key', bucket: 'qhs-cards-1300', region: 'ap-guangzhou', cdnBase: '', ...over };
}

/** 假 COS client：exists 命中集合则成功，否则 404；put 记录写入；getObject 回存入的 Body。 */
function fakeCos(existing: Set<string>, onPut?: (key: string) => void): CosLike {
  const bodies = new Map<string, Buffer>();
  return {
    headObject({ Key }, cb) {
      if (existing.has(Key)) cb(null, {});
      else cb({ statusCode: 404 }, undefined);
    },
    putObject({ Key, Body }, cb) {
      onPut?.(Key);
      existing.add(Key);
      bodies.set(Key, Body);
      cb(null, {});
    },
    getObject({ Key }, cb) {
      if (!existing.has(Key)) return cb({ statusCode: 404 });
      cb(null, { Body: bodies.get(Key) ?? Buffer.from('png') });
    },
  };
}

describe('card storage', () => {
  it('memory storage round-trips put to exists', async () => {
    const storage = createMemoryCardStorage();
    const key = 'cards/r1/duanzi-wechat.png';
    await expect(storage.exists(key)).resolves.toBeNull();
    const url = await storage.put(key, Buffer.from('png'), 'image/png');
    await expect(storage.exists(key)).resolves.toBe(url);
  });

  it('memory getBytes 回 put 的字节,miss 返 null', async () => {
    const storage = createMemoryCardStorage();
    await storage.put('cards/r1/m.png', Buffer.from('MEM'), 'image/png');
    expect((await storage.getBytes!('cards/r1/m.png'))?.toString()).toBe('MEM');
    await expect(storage.getBytes!('cards/r1/none.png')).resolves.toBeNull();
  });

  it('buildCardKey produces stable url-safe path', () => {
    expect(buildCardKey({ reportId: 'abc_123-x', style: 'hardcore', platform: 'xhs' })).toBe(`cards/${CARD_RENDER_CACHE_VERSION}/abc_123-x/hardcore-xhs.png`);
  });

  it('getCardStorage falls back to memory when COS env missing', async () => {
    const storage = getCardStorage();
    const url = await storage.put('cards/r1/duanzi-x.png', Buffer.from('png'), 'image/png');
    await expect(storage.exists('cards/r1/duanzi-x.png')).resolves.toBe(url);
  });
});

describe('COS card storage', () => {
  it('loadCosConfig returns null when core vars missing', () => {
    expect(loadCosConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(loadCosConfig({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it('loadCosConfig parses and strips trailing slash on cdnBase', () => {
    const c = loadCosConfig({
      COS_SECRET_ID: 'id',
      COS_SECRET_KEY: 'key',
      COS_BUCKET: 'qhs-1300',
      COS_REGION: 'ap-guangzhou',
      COS_CDN_BASE_URL: 'https://cdn.qiuhoushuo.cn/',
    } as unknown as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ bucket: 'qhs-1300', region: 'ap-guangzhou', cdnBase: 'https://cdn.qiuhoushuo.cn' });
  });

  it('cosObjectUrl uses CDN base when set, else default COS domain', () => {
    expect(cosObjectUrl(cfg({ cdnBase: 'https://cdn.x' }), 'cards/r/a.png')).toBe('https://cdn.x/cards/r/a.png');
    expect(cosObjectUrl(cfg({ bucket: 'b-1', region: 'ap-shanghai' }), 'cards/r/a.png')).toBe(
      'https://b-1.cos.ap-shanghai.myqcloud.com/cards/r/a.png',
    );
  });

  it('createCosCardStorage throws when config missing', () => {
    expect(() => createCosCardStorage(null)).toThrow(/COS 配置缺失/);
  });

  it('exists returns CDN url on hit, null on 404', async () => {
    const storage = createCosCardStorage(cfg({ cdnBase: 'https://cdn.x' }), fakeCos(new Set(['cards/r/hit.png'])));
    await expect(storage.exists('cards/r/hit.png')).resolves.toBe('https://cdn.x/cards/r/hit.png');
    await expect(storage.exists('cards/r/miss.png')).resolves.toBeNull();
  });

  it('put writes to COS and returns url', async () => {
    const puts: string[] = [];
    const storage = createCosCardStorage(cfg({ cdnBase: 'https://cdn.x' }), fakeCos(new Set(), (k) => puts.push(k)));
    const url = await storage.put('cards/r/new.png', Buffer.from('png'), 'image/png');
    expect(url).toBe('https://cdn.x/cards/r/new.png');
    expect(puts).toEqual(['cards/r/new.png']);
    await expect(storage.exists('cards/r/new.png')).resolves.toBe('https://cdn.x/cards/r/new.png');
  });

  it('getBytes 走 COS getObject 回字节(命中)/ null(404),不碰 CDN 域名', async () => {
    const storage = createCosCardStorage(cfg(), fakeCos(new Set()));
    await storage.put('cards/r/b.png', Buffer.from('PNGDATA'), 'image/png');
    const bytes = await storage.getBytes!('cards/r/b.png');
    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes?.toString()).toBe('PNGDATA');
    await expect(storage.getBytes!('cards/r/miss.png')).resolves.toBeNull();
  });

  it('exists rejects on non-404 COS error', async () => {
    const errClient: CosLike = {
      headObject(_p, cb) {
        cb({ statusCode: 503 }, undefined);
      },
      putObject(_p, cb) {
        cb(null, {});
      },
      getObject(_p, cb) {
        cb({ statusCode: 404 });
      },
    };
    const storage = createCosCardStorage(cfg(), errClient);
    await expect(storage.exists('cards/r/x.png')).rejects.toThrow();
  });

  it('getCardStorage routes to COS when env fully set (loadCosConfig non-null)', () => {
    process.env.COS_SECRET_ID = 'id';
    process.env.COS_SECRET_KEY = 'key';
    process.env.COS_BUCKET = 'qhs-1300';
    process.env.COS_REGION = 'ap-guangzhou';
    expect(loadCosConfig()).not.toBeNull();
    const storage = getCardStorage();
    expect(typeof storage.exists).toBe('function');
    expect(typeof storage.put).toBe('function');
  });
});
