import { describe, expect, it } from 'vitest';
import {
  buildHighlightImageKey,
  createDoubaoHighlightImageProvider,
  createHighlightImageProviderFromEnv,
  createMockHighlightImageProvider,
  generateHighlightImage,
  loadDoubaoHighlightImageConfig,
  toHighlightImageInput,
  type HighlightImageContentType,
} from '@/lib/api/highlight-image';
import type { CardStorageClient, StorageContentType } from '@/lib/api/card-storage';
import type { HighlightMoment } from '@/lib/api/highlight-moments';

describe('highlight image service', () => {
  it('builds stable COS-safe image keys', () => {
    expect(buildHighlightImageKey({ matchId: 'match/abc 123', momentId: 'score-turn' })).toBe(
      'highlight-images/matchabc%20123/score-turn.jpg',
    );
  });

  it('mock provider returns a deterministic JPEG and composed prompt', async () => {
    const provider = createMockHighlightImageProvider();
    const out = await provider.generate({
      matchId: 'm1',
      moment: {
        id: 'score-turn',
        minute: '关键进球',
        title: '巴西把比分写进镜头',
        description: '这一下是整篇战报的主画面。',
        image_prompt: '足球比赛关键进球瞬间，非真实球员肖像',
      },
    });

    expect(provider.name).toBe('mock');
    expect(out.contentType).toBe('image/jpeg');
    expect(out.image.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(out.prompt).toContain('关键进球');
    expect(out.prompt).toContain('足球比赛关键进球瞬间');
  });

  it('writes provider output through the storage contract', async () => {
    const puts: Array<{ key: string; body: Buffer; contentType: StorageContentType }> = [];
    const storage: CardStorageClient = {
      async exists() {
        return null;
      },
      async put(key, body, contentType) {
        puts.push({ key, body, contentType });
        return `cos://bucket/${key}`;
      },
    };

    const result = await generateHighlightImage({
      matchId: 'm1',
      moment: {
        id: 'pressure-wave',
        title: '连续冲击',
        description: '禁区前沿和二点球争夺。',
        image_prompt: '足球比赛连续压迫镜头',
      },
    }, {
      provider: createMockHighlightImageProvider(),
      storage,
    });

    expect(result).toMatchObject({
      key: 'highlight-images/m1/pressure-wave.jpg',
      url: 'cos://bucket/highlight-images/m1/pressure-wave.jpg',
      provider: 'mock',
      contentType: 'image/jpeg',
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.contentType).toBe('image/jpeg');
    expect(puts[0]?.body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('can map a report highlight moment into provider input', () => {
    const moment: HighlightMoment = {
      id: 'final-whistle',
      kind: 'turning_point',
      minute: '终场前后',
      title: '终场哨响后的表情',
      description: '有人低头，有人开始复盘。',
      image_alt: '终场情绪镜头',
      image_prompt: '足球比赛终场哨响后，非真实球员肖像',
    };

    expect(toHighlightImageInput('match-1', moment)).toEqual({
      matchId: 'match-1',
      moment: {
        id: 'final-whistle',
        minute: '终场前后',
        title: '终场哨响后的表情',
        description: '有人低头，有人开始复盘。',
        image_prompt: '足球比赛终场哨响后，非真实球员肖像',
      },
    });
  });
});

describe('doubao highlight image provider', () => {
  it('loads image config from existing doubao env defaults', () => {
    const cfg = loadDoubaoHighlightImageConfig({
      DOUBAO_API_KEY: 'ark-key',
      DOUBAO_BASE_URL: 'https://ark.example/api/v3/',
    } as unknown as NodeJS.ProcessEnv);

    expect(cfg).toMatchObject({
      apiKey: 'ark-key',
      baseURL: 'https://ark.example/api/v3',
      model: 'doubao-seedream-4-0-250828',
      size: '2K',
      watermark: true,
      timeoutMs: 90_000,
    });
  });

  it('selects doubao provider from env', () => {
    const provider = createHighlightImageProviderFromEnv({
      HIGHLIGHT_IMAGE_PROVIDER: 'doubao',
      DOUBAO_API_KEY: 'ark-key',
      DOUBAO_IMAGE_BASE_URL: 'https://ark.example/api/v3',
      DOUBAO_IMAGE_MODEL: 'doubao-seedream-4-0-250828',
    } as unknown as NodeJS.ProcessEnv);

    expect(provider.name).toBe('doubao');
  });

  it('calls Ark images/generations, downloads and re-encodes to card JPEG (F65)', async () => {
    // 用 sharp 自产 PNG 当"下载结果":手写 base64 极小 PNG 在并发 worker 下 libspng 偶发读错(flaky)
    const sharp = (await import('sharp')).default;
    const downloadPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0a7a3d' } }).png().toBuffer();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://img.example/highlight.png' }] }), { status: 200 });
      }
      const body = new ArrayBuffer(downloadPng.byteLength);
      new Uint8Array(body).set(downloadPng);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png' } });
    };
    const provider = createDoubaoHighlightImageProvider({
      apiKey: 'ark-key',
      baseURL: 'https://ark.example/api/v3',
      model: 'doubao-seedream-4-0-250828',
      size: '2K',
      watermark: true,
      timeoutMs: 1000,
    }, fetchMock as typeof fetch);

    const out = await provider.generate({
      matchId: 'm1',
      moment: {
        id: 'score-turn',
        minute: '关键进球',
        title: '巴西把比分写进镜头',
        description: '这一下是整篇战报的主画面。',
        image_prompt: '足球比赛关键进球瞬间，非真实球员肖像',
      },
    });

    expect(out.contentType).toBe('image/jpeg');
    expect(out.image.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://ark.example/api/v3/images/generations');
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer ark-key' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: 'doubao-seedream-4-0-250828',
      size: '2K',
      response_format: 'url',
      sequential_image_generation: 'disabled',
      stream: false,
      watermark: true,
    });
    expect(calls[1]?.url).toBe('https://img.example/highlight.png');
  });

  it('re-encodes any download into bounded card JPEG before storage writes (F65:控制体积)', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#0a7a3d',
      },
    }).jpeg().toBuffer();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://img.example/highlight.jpg' }] }), { status: 200 });
      }
      const body = new ArrayBuffer(jpeg.byteLength);
      new Uint8Array(body).set(jpeg);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    };
    const provider = createDoubaoHighlightImageProvider({
      apiKey: 'ark-key',
      baseURL: 'https://ark.example/api/v3',
      model: 'doubao-seedream-4-0-250828',
      size: '2K',
      watermark: true,
      timeoutMs: 1000,
    }, fetchMock as typeof fetch);

    const out = await provider.generate({
      matchId: 'm1',
      moment: {
        id: 'score-turn',
        title: '巴西把比分写进镜头',
        description: '主画面。',
        image_prompt: '足球比赛关键进球瞬间',
      },
    });

    expect(out.image.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });
});

const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=',
  'base64',
);
