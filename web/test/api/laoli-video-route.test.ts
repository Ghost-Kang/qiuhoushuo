import { afterEach, describe, expect, it, vi } from 'vitest';

const UUID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.LAOLI_VIDEO_ENABLED;
  delete process.env.LAOLI_AVATAR_ENABLED;
  delete process.env.LAOLI_AVATAR_MODE;
  delete process.env.LAOLI_AVATAR_PROVIDER;
});

function request(token?: string, body: unknown = { matchId: UUID }): Request {
  return new Request('http://localhost/api/admin/laoli-video', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function mockRuntime(options: { existing?: string | null; context?: object | null } = {}) {
  const storage = {
    exists: vi.fn(async () => options.existing ?? null),
    put: vi.fn(async (key: string) => `memory://${key}`),
  };
  vi.doMock('@/lib/api/mode', () => ({ USE_DB: true, getSupabaseService: () => ({}) }));
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => storage }));
  vi.doMock('@/lib/api/laoli-video-context', () => ({
    loadLaoliVideoContext: async () => options.context ?? {
      match: {},
      reports: {},
      referenceImage: Buffer.from('jpg'),
      referenceImageType: 'image/jpeg',
    },
    loadLaoliReelContext: async () => ({ match: {}, reports: {}, reportId: 'rep1' }),
  }));
  vi.doMock('@/lib/api/laoli-tts', () => ({ createLaoliTtsProviderFromEnv: () => ({ name: 'mock' }) }));
  vi.doMock('@/lib/api/laoli-video', () => ({ createLaoliVideoProviderFromEnv: () => ({ name: 'mock' }) }));
  return storage;
}

describe('POST /api/admin/laoli-video', () => {
  it('requires auth before checking the feature gate', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockRuntime();
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    expect((await POST(request())).status).toBe(401);
  });

  it('returns disabled without consuming Seedance when the gate is closed', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    mockRuntime();
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    expect((await POST(request('secret'))).status).toBe(403);
  });

  it('reuses an existing final video unless force=true', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.LAOLI_VIDEO_ENABLED = '1';
    mockRuntime({ existing: 'https://cdn.example/final.mp4' });
    const run = vi.fn();
    vi.doMock('@/lib/api/laoli-video-pipeline', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/api/laoli-video-pipeline')>(),
      runLaoliVideoPipeline: run,
    }));
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    const response = await POST(request('secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reused: true, finalUrl: 'https://cdn.example/final.mp4' });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the pipeline and returns its downloadable COS result', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.LAOLI_VIDEO_ENABLED = '1';
    mockRuntime();
    vi.doMock('@/lib/api/laoli-video-pipeline', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/api/laoli-video-pipeline')>(),
      runLaoliVideoPipeline: async () => ({
        matchId: UUID,
        finalKey: `laoli-videos/${UUID}/final.mp4`,
        finalUrl: 'https://cdn.example/final.mp4',
        statusKey: 'status.json',
        reviewKey: 'review.json',
        provider: 'mock',
        degraded: true,
        bytes: 10,
        durationMs: 20,
        warnings: [],
      }),
    }));
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    const response = await POST(request('secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      reused: false,
      finalUrl: 'https://cdn.example/final.mp4',
      degraded: true,
    });
  });

  it('reel 模式 → 异步 202 + statusKey/finalKey(detached)', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.LAOLI_VIDEO_ENABLED = '1';
    process.env.LAOLI_AVATAR_ENABLED = '1';
    process.env.LAOLI_AVATAR_MODE = 'reel';
    process.env.LAOLI_AVATAR_PROVIDER = 'mock'; // 免 DOUBAO 配置,createMockLaoliAvatarProvider
    mockRuntime();
    const started = vi.fn(() => ({ statusKey: 'st-key', finalKey: 'fk', accepted: true }));
    vi.doMock('@/lib/api/laoli-reel-pipeline', () => ({ startLaoliReelDetached: started }));
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    const response = await POST(request('secret'));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, mode: 'reel', state: 'running', statusKey: 'st-key' });
    expect(started).toHaveBeenCalledOnce();
  });

  it('reel:strict + ctaOverride 透传给 pipeline input(detached)', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.LAOLI_VIDEO_ENABLED = '1';
    process.env.LAOLI_AVATAR_ENABLED = '1';
    process.env.LAOLI_AVATAR_MODE = 'reel';
    process.env.LAOLI_AVATAR_PROVIDER = 'mock';
    mockRuntime();
    const started = vi.fn((_input: { strictArc?: boolean; ctaOverride?: string }, _deps?: unknown) => ({ statusKey: 'st-key', finalKey: 'fk', accepted: true }));
    vi.doMock('@/lib/api/laoli-reel-pipeline', () => ({ startLaoliReelDetached: started }));
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    const response = await POST(request('secret', { matchId: UUID, strict: true, ctaOverride: '想看老李押球，关注就行' }));
    expect(response.status).toBe(202);
    expect(started).toHaveBeenCalledOnce();
    const input = started.mock.calls[0]![0];
    expect(input.strictArc).toBe(true);
    expect(input.ctaOverride).toBe('想看老李押球，关注就行');
  });

  it('reel 占用中(单飞锁)→ 409', async () => {
    process.env.ADMIN_API_SECRET = 'secret';
    process.env.LAOLI_VIDEO_ENABLED = '1';
    process.env.LAOLI_AVATAR_ENABLED = '1';
    process.env.LAOLI_AVATAR_MODE = 'reel';
    process.env.LAOLI_AVATAR_PROVIDER = 'mock';
    mockRuntime();
    vi.doMock('@/lib/api/laoli-reel-pipeline', () => ({
      startLaoliReelDetached: () => ({ statusKey: 'st-key', finalKey: 'fk', accepted: false }),
    }));
    const { POST } = await import('@/app/api/admin/laoli-video/route');
    const response = await POST(request('secret'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, busy: true, mode: 'reel' });
  });
});
