import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFanPortraitPrompt,
  buildFanPortraitKey,
  fanPortraitEnabled,
  createMockFanPortraitProvider,
  createFanPortraitProviderFromEnv,
  createDoubaoFanPortraitProvider,
  ensureFanPortraitBytes,
  type FanPortraitProvider,
} from '@/lib/api/fan-portrait';

// 让 doubao 生成路径里的 sharp 压缩可在单测跑(不真做图像处理)。
vi.mock('sharp', () => ({
  default: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('jpeg-out') }) }) }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('buildFanPortraitPrompt', () => {
  it('含队名 + 克制 SFW 锁定 + 虚构不像真人', () => {
    const p = buildFanPortraitPrompt('巴西');
    expect(p).toContain('巴西');
    expect(p).toContain('禁止裸露');
    expect(p).toContain('禁止刻意强调身材');
    expect(p).toContain('不得与任何真实人物相似');
    expect(p).toContain('不得出现任何文字');
  });
  it('清洗注入字符,空队名兜底', () => {
    expect(buildFanPortraitPrompt('<script>')).toContain('script'); // 去掉尖括号,保留字母
    expect(buildFanPortraitPrompt('   ')).toContain('主队'); // 空 → 兜底
  });
});

describe('buildFanPortraitKey / fanPortraitEnabled', () => {
  it('key 形如 fan-portraits/<matchId>/<side>.jpg', () => {
    expect(buildFanPortraitKey({ matchId: 'm1', side: 'home' })).toBe('fan-portraits/m1/home.jpg');
    expect(buildFanPortraitKey({ matchId: 'm1', side: 'away' })).toBe('fan-portraits/m1/away.jpg');
  });
  it('开关:=1/true 开,其余关', () => {
    expect(fanPortraitEnabled({ MP_DRAFT_FAN_PORTRAIT: '1' } as never)).toBe(true);
    expect(fanPortraitEnabled({ MP_DRAFT_FAN_PORTRAIT: 'true' } as never)).toBe(true);
    expect(fanPortraitEnabled({ MP_DRAFT_FAN_PORTRAIT: '' } as never)).toBe(false);
    expect(fanPortraitEnabled({} as never)).toBe(false);
  });
});

describe('provider 工厂', () => {
  it('默认 mock;未知 provider 抛错', () => {
    expect(createFanPortraitProviderFromEnv({} as never).name).toBe('mock');
    expect(createFanPortraitProviderFromEnv({ FAN_PORTRAIT_PROVIDER: 'mock' } as never).name).toBe('mock');
    expect(() => createFanPortraitProviderFromEnv({ FAN_PORTRAIT_PROVIDER: 'x' } as never)).toThrow();
  });
  it('mock provider 出图(jpeg buffer)', async () => {
    const out = await createMockFanPortraitProvider().generate({ team: '巴西', side: 'home' });
    expect(out.contentType).toBe('image/jpeg');
    expect(Buffer.isBuffer(out.image)).toBe(true);
    expect(out.prompt).toContain('巴西');
  });
  it('doubao:请求体 watermark 恒 true + prompt 带队名,b64_json → jpeg buffer', async () => {
    let body: { watermark?: boolean; prompt?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    const provider = createDoubaoFanPortraitProvider(
      { apiKey: 'k', baseURL: 'https://ark', model: 'm', size: '2K', timeoutMs: 9000 },
      fetchImpl as unknown as typeof fetch,
    );
    const out = await provider.generate({ team: '巴西', side: 'home' });
    expect(body.watermark).toBe(true);
    expect(body.prompt).toContain('巴西');
    expect(out.contentType).toBe('image/jpeg');
    expect(Buffer.isBuffer(out.image)).toBe(true);
  });
});

describe('ensureFanPortraitBytes', () => {
  function mockProvider(): FanPortraitProvider & { generate: ReturnType<typeof vi.fn> } {
    return { name: 'mock', generate: vi.fn(async () => ({ image: Buffer.from('FAN'), contentType: 'image/jpeg' as const, prompt: 'p' })) };
  }
  it('缓存命中 → 直返缓存,不调 provider', async () => {
    const provider = mockProvider();
    const storage = { getBytes: vi.fn(async () => Buffer.from('CACHED')), put: vi.fn(async () => 'u'), exists: vi.fn(async () => null) };
    const out = await ensureFanPortraitBytes({ matchId: 'm1', side: 'home', team: '巴西' }, { provider, storage });
    expect(out?.toString()).toBe('CACHED');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('未命中 → 生成并落缓存,返回新图', async () => {
    const provider = mockProvider();
    const storage = { getBytes: vi.fn(async () => null), put: vi.fn(async () => 'u'), exists: vi.fn(async () => null) };
    const out = await ensureFanPortraitBytes({ matchId: 'm1', side: 'away', team: '西班牙' }, { provider, storage });
    expect(out?.toString()).toBe('FAN');
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(storage.put).toHaveBeenCalledWith('fan-portraits/m1/away.jpg', expect.any(Buffer), 'image/jpeg');
  });
  it('生成失败 → null(best-effort,不抛)', async () => {
    const provider: FanPortraitProvider = { name: 'mock', generate: vi.fn(async () => { throw new Error('blocked'); }) };
    const storage = { getBytes: vi.fn(async () => null), put: vi.fn(async () => 'u'), exists: vi.fn(async () => null) };
    expect(await ensureFanPortraitBytes({ matchId: 'm1', side: 'home', team: '巴西' }, { provider, storage })).toBeNull();
  });
});
