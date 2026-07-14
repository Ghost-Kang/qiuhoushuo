import { describe, expect, it, vi } from 'vitest';
import {
  OMNIHUMAN_REQ_KEY,
  createOmnihumanAvatarProvider,
  formatVisualQuery,
  loadOmnihumanConfig,
  signVolcVisualV4,
} from '@/lib/api/laoli-omnihuman';

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'test', ...values }) as NodeJS.ProcessEnv;

const SIGN_CFG = {
  accessKey: 'AKLTtest000',
  secretKey: 'c2VjcmV0LWtleS1zYW1wbGU=',
  host: 'visual.volcengineapi.com',
  region: 'cn-north-1',
  service: 'cv',
};
const fixedClock = () => new Date('2026-06-22T08:09:10.123Z');

describe('laoli omnihuman signing', () => {
  it('formats query keys in dictionary order', () => {
    expect(formatVisualQuery({ Version: '2022-08-31', Action: 'CVSubmitTask' }))
      .toBe('Action=CVSubmitTask&Version=2022-08-31');
  });

  it('reproduces the reference Volc V4 signature for a fixed request (golden lock)', () => {
    const body = JSON.stringify({
      req_key: OMNIHUMAN_REQ_KEY,
      image_url: 'https://cdn.example/laoli.png',
      audio_url: 'https://cdn.example/a.mp3',
    });
    const signed = signVolcVisualV4({
      cfg: SIGN_CFG,
      query: 'Action=CVSubmitTask&Version=2022-08-31',
      body,
      clock: fixedClock,
    });
    expect(signed.url).toBe('https://visual.volcengineapi.com/?Action=CVSubmitTask&Version=2022-08-31');
    expect(signed.headers['X-Date']).toBe('20260622T080910Z');
    expect(signed.headers['X-Content-Sha256'])
      .toBe('37d8ef1217b1e3fa509a02a4b0df4326d2911f162fe4ec479996143e1f785606');
    expect(signed.headers['Content-Type']).toBe('application/json');
    expect(signed.headers.Authorization).toBe(
      'HMAC-SHA256 Credential=AKLTtest000/20260622/cn-north-1/cv/request, '
      + 'SignedHeaders=content-type;host;x-content-sha256;x-date, '
      + 'Signature=32c1fa8b0e3b22a237f45816ceab3775b4e0546861e0d615834291230810e8e5',
    );
  });
});

describe('laoli omnihuman provider', () => {
  const cfg = {
    ...SIGN_CFG,
    reqKey: OMNIHUMAN_REQ_KEY,
    pollIntervalMs: 1,
    timeoutMs: 10_000,
  };

  it('submits, polls until done, then downloads the video', async () => {
    let polls = 0;
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('Action=CVSubmitTask')) {
        bodies.push(String(init?.body));
        return Response.json({ data: { task_id: 'oh-1' } });
      }
      if (u.includes('Action=CVGetResult')) {
        polls += 1;
        return Response.json(polls < 2
          ? { data: { status: 'in_queue' } }
          : { data: { status: 'done', video_url: 'https://cdn.example/oh.mp4' } });
      }
      return new Response(Buffer.from('omni-mp4'), { status: 200 });
    }) as typeof fetch;
    const wait = vi.fn(async () => {});
    const provider = createOmnihumanAvatarProvider(cfg, fetchImpl, wait, fixedClock);

    const out = await provider.generate({
      matchId: 'm1',
      segmentIndex: 0,
      imageUrl: 'https://cdn.example/laoli.png',
      audioUrl: 'https://cdn.example/a.mp3',
      audioDurationSec: 12,
      prompt: '老李正对镜头自然说话',
    });

    expect(out.video.toString()).toBe('omni-mp4');
    expect(out.provider).toBe('omnihuman');
    expect(out.taskId).toBe('oh-1');
    expect(wait).toHaveBeenCalledTimes(1);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
      req_key: OMNIHUMAN_REQ_KEY,
      image_url: 'https://cdn.example/laoli.png',
      audio_url: 'https://cdn.example/a.mp3',
      prompt: '老李正对镜头自然说话',
    });
  });

  it('throws when the task fails', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('CVSubmitTask')) return Response.json({ data: { task_id: 'oh-x' } });
      return Response.json({ data: { status: 'failed' }, message: 'unsafe portrait' });
    }) as typeof fetch;
    const provider = createOmnihumanAvatarProvider(cfg, fetchImpl, async () => {}, fixedClock);
    await expect(provider.generate({
      matchId: 'm1',
      segmentIndex: 0,
      imageUrl: 'https://cdn.example/laoli.png',
      audioUrl: 'https://cdn.example/a.mp3',
      audioDurationSec: 12,
    })).rejects.toThrow('task failed: unsafe portrait');
  });

  it('requires public image and audio urls', async () => {
    const provider = createOmnihumanAvatarProvider(cfg, vi.fn() as unknown as typeof fetch, async () => {}, fixedClock);
    await expect(provider.generate({
      matchId: 'm1', segmentIndex: 0, audioUrl: 'https://cdn.example/a.mp3', audioDurationSec: 12,
    })).rejects.toThrow('requires public imageUrl');
  });

  it('throws a clear error when credentials are missing', () => {
    expect(() => loadOmnihumanConfig(env({}))).toThrow('OMNIHUMAN_ACCESS_KEY');
    expect(loadOmnihumanConfig(env({ OMNIHUMAN_ACCESS_KEY: 'ak', OMNIHUMAN_SECRET_KEY: 'sk' })).reqKey)
      .toBe(OMNIHUMAN_REQ_KEY);
  });
});
