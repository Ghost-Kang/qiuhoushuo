import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './_utils';
import type { ServerEvent } from '@/lib/api/tracker';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=';

type Storage = { exists: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.FEATURE_FLAG_FAN_AVATAR;
  delete process.env.FEATURE_FLAG_FAN_AVATAR_COSTAR;
});

describe('POST /api/avatar', () => {
  it('returns 403 FEATURE_DISABLED when feature.fan_avatar is absent (default off)', async () => {
    const { POST } = await loadRoute({ flag: undefined });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'FEATURE_DISABLED' });
  });

  it('returns 401 without x-openid', async () => {
    const { POST } = await loadRoute({});
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }, { openid: null }));
    expect(res.status).toBe(401);
  });

  it('accepts x-openid-token (服务号 H5 路径),拒伪造 token', async () => {
    const { signOpenidToken } = await import('@/lib/api/openid-token');
    const { POST, storage } = await loadRoute({});
    const token = signOpenidToken('mock_user_h5', Date.now());
    const okRes = await POST(reqToken({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }, token));
    expect(okRes.status).toBe(200);
    expect(storage.put).toHaveBeenCalledTimes(1);

    const { POST: POST2 } = await loadRoute({});
    const badRes = await POST2(reqToken({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }, 'forged.token.sig'));
    expect(badRes.status).toBe(401);
  });

  it('returns 400 CONSENT_REQUIRED when consent !== true (PIPL 敏感信息单独同意)', async () => {
    const { POST, storage } = await loadRoute({});
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: false }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'CONSENT_REQUIRED' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects non-image payloads', async () => {
    const { POST } = await loadRoute({});
    const res = await POST(req({ image_b64: Buffer.from('definitely not an image').toString('base64'), team: '巴西', consent: true }));
    expect(res.status).toBe(400);
    const body = await json(res) as { error: string; details?: { image_b64?: string } };
    expect(body.error).toBe('BAD_REQUEST');
    expect(body.details).toEqual({ image_b64: 'UNSUPPORTED_IMAGE' });
  });

  it('rejects schema violations (missing team / overlong team)', async () => {
    const { POST } = await loadRoute({});
    expect((await POST(req({ image_b64: TINY_PNG_B64, consent: true }))).status).toBe(400);
    expect((await POST(req({ image_b64: TINY_PNG_B64, team: 'x'.repeat(31), consent: true }))).status).toBe(400);
  });

  it('returns 413 when the decoded selfie exceeds 4MB', async () => {
    const { POST } = await loadRoute({});
    const big = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(4 * 1024 * 1024 + 1)]);
    const res = await POST(req({ image_b64: big.toString('base64'), team: '巴西', consent: true }));
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ error: 'PAYLOAD_TOO_LARGE', limit: 4 * 1024 * 1024 });
  });

  it('generates via mock provider in mock mode and stores under the hashed key', async () => {
    const { POST, storage, track } = await loadRoute({});
    const res = await POST(req({ image_b64: `data:image/png;base64,${TINY_PNG_B64}`, team: '巴西', consent: true }));

    expect(res.status).toBe(200);
    const body = await json(res) as { url: string; request_id: string };
    expect(body.url).toContain('fan-avatars/');
    expect(body.request_id).toBeTruthy();
    const [key] = storage.put.mock.calls[0]! as unknown as [string];
    expect(key).toMatch(/^fan-avatars\/[0-9a-f]{16}\//);
    expect(key).not.toContain('openid-1');
    expect(track).toContainEqual(expect.objectContaining({
      eventId: 'E055',
      properties: expect.objectContaining({ team: '巴西', provider: 'mock' }),
    }));
  });

  it('blocks minors with 403 MINOR_BLOCKED in DB mode', async () => {
    const { POST, storage } = await loadRoute({ useDb: true, user: { id: 'u1', is_minor: true } });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'MINOR_BLOCKED' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('allows unknown DB users after wx/login and only blocks explicit minors', async () => {
    const { POST, storage } = await loadRoute({ useDb: true, user: null });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(200);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('mode=costar is gated by feature.fan_avatar_costar even when fan_avatar is on (独立 kill 开关)', async () => {
    const { POST, storage } = await loadRoute({}); // fan_avatar on, costar flag absent
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '葡萄牙', star: 'C罗', mode: 'costar', consent: true }));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'FEATURE_DISABLED' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('mode=costar requires a star when the costar flag is on', async () => {
    const { POST, storage } = await loadRoute({ costarFlag: '100' });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '葡萄牙', mode: 'costar', consent: true }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'BAD_REQUEST', details: { star: 'REQUIRED' } });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('mode=costar with the flag on and a star generates and tracks mode=costar', async () => {
    const { POST, storage, track } = await loadRoute({ costarFlag: '100' });
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '葡萄牙', star: 'C罗', mode: 'costar', consent: true }));
    expect(res.status).toBe(200);
    expect(storage.put).toHaveBeenCalled();
    expect(track).toContainEqual(expect.objectContaining({
      eventId: 'E055',
      properties: expect.objectContaining({ mode: 'costar' }),
    }));
  });

  it('returns 500 INTERNAL when the provider throws (上游挂了不泄细节)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('FAN_AVATAR_PROVIDER', 'doubao'); // 无 DOUBAO_API_KEY → createProvider throw
    const { POST } = await loadRoute({});
    const res = await POST(req({ image_b64: TINY_PNG_B64, team: '巴西', consent: true }));
    expect(res.status).toBe(500);
    expect((await json(res) as { error: string }).error).toBe('INTERNAL');
    expect(error).toHaveBeenCalled();
  });
});

function req(body: Record<string, unknown>, opts: { openid?: string | null } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.openid !== null) headers.set('x-openid', opts.openid ?? 'openid-1');
  return new Request('http://localhost/api/avatar', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// 服务号 H5:用 x-openid-token 鉴权(无 x-openid)
function reqToken(body: Record<string, unknown>, token: string) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'x-openid-token': token });
  return new Request('http://localhost/api/avatar', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function loadRoute(opts: {
  flag?: string;
  costarFlag?: string;
  useDb?: boolean;
  user?: { id: string; is_minor?: boolean } | null;
} = {}) {
  const { useDb = false, user = { id: 'u1', is_minor: false } } = opts;
  const flag = 'flag' in opts ? opts.flag : '100';

  if (flag != null) vi.stubEnv('FEATURE_FLAG_FAN_AVATAR', flag);
  if (opts.costarFlag != null) vi.stubEnv('FEATURE_FLAG_FAN_AVATAR_COSTAR', opts.costarFlag);
  if (useDb) {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service';
    process.env.SUPABASE_ANON_KEY = 'anon';
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: user }) }),
          }),
        }),
      }),
    }));
  } else {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_KEY', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
  }

  const storage: Storage = {
    exists: vi.fn(async () => null),
    put: vi.fn(async (key: string) => `https://cdn.example.com/${key}`),
  };
  const track: ServerEvent[] = [];

  vi.resetModules();
  vi.doMock('@/lib/api/card-storage', () => ({ getCardStorage: () => storage }));
  vi.doMock('@/lib/api/tracker', () => ({
    trackServerEvent: (_client: unknown, event: ServerEvent) => track.push(event),
  }));

  const route = await import('@/app/api/avatar/route');
  return { ...route, storage, track };
}
