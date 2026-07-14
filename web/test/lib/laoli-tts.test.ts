import { describe, expect, it, vi } from 'vitest';
import {
  createLaoliTtsProviderFromEnv,
  createMockLaoliTtsProvider,
  createVolcLaoliTtsProvider,
  createVolcV3LaoliTtsProvider,
  extractAudioBase64,
  extractStreamedTtsAudio,
  loadVolcLaoliTtsConfig,
  loadVolcV3LaoliTtsConfig,
  pcmToWav,
} from '@/lib/api/laoli-tts';

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'test', ...values }) as NodeJS.ProcessEnv;

const config = {
  appId: 'app',
  accessToken: 'token',
  secretKey: 'secret',
  endpoint: 'https://openspeech.example/api/v1/tts',
  resourceId: 'resource-id',
  cluster: 'volcano_tts',
  voice: 'voice-a',
  model: '1.2.1.1',
  timeoutMs: 1000,
};

describe('laoli tts', () => {
  it('mock provider returns deterministic 24k mono WAV', async () => {
    const out = await createMockLaoliTtsProvider().synthesize({ text: '老李赛后说' });
    expect(out.provider).toBe('mock');
    expect(out.contentType).toBe('audio/wav');
    expect(out.sampleRate).toBe(24000);
    expect(out.audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.audio.subarray(8, 12).toString()).toBe('WAVE');
  });

  it('calls the HTTP non-streaming API with its unusual Bearer semicolon auth', async () => {
    const wav = pcmToWav(Buffer.alloc(8), 24000, 1);
    let capturedInit: RequestInit | undefined;
    const fetchMock: typeof fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Response.json({ data: wav.toString('base64') });
    });
    const out = await createVolcLaoliTtsProvider(config, fetchMock)
      .synthesize({ text: '今儿这场球有味道' });

    expect(out.audio).toEqual(wav);
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer;token',
      'X-Api-App-Id': 'app',
      'X-Api-Access-Key': 'secret',
      'X-Api-Resource-Id': 'resource-id',
    });
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toMatchObject({
      app: { appid: 'app', token: 'token', cluster: 'volcano_tts' },
      audio: { voice_type: 'voice-a', encoding: 'wav', speed_ratio: 1 },
      request: { text: '今儿这场球有味道', operation: 'query' },
    });
    expect(body.audio.extra_param).toContain('"aigc_metadata":{"enable":true}');
  });

  it('accepts nested or data-uri base64 audio and wraps raw PCM', async () => {
    const raw = Buffer.from([1, 0, 2, 0]);
    expect(extractAudioBase64({ result: { audio: `data:audio/wav;base64,${raw.toString('base64')}` } }))
      .toBe(raw.toString('base64'));
    const fetchImpl = vi.fn(async () => Response.json({ audio: raw.toString('base64') })) as typeof fetch;
    const out = await createVolcLaoliTtsProvider(config, fetchImpl).synthesize({ text: '测试' });
    expect(out.audio.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('fails closed on HTTP errors and missing audio', async () => {
    const failed = vi.fn(async () => new Response('bad token', { status: 401 })) as typeof fetch;
    await expect(createVolcLaoliTtsProvider(config, failed).synthesize({ text: '测试' }))
      .rejects.toThrow('request failed: 401 bad token');
    const empty = vi.fn(async () => Response.json({ data: '' })) as typeof fetch;
    await expect(createVolcLaoliTtsProvider(config, empty).synthesize({ text: '测试' }))
      .rejects.toThrow('missing base64 audio');
  });

  it('requires all volc credentials including the console resource id', () => {
    expect(createLaoliTtsProviderFromEnv(env({})).name).toBe('mock');
    expect(() => loadVolcLaoliTtsConfig(env({
      VOLC_TTS_APP_ID: 'a',
      VOLC_TTS_ACCESS_TOKEN: 't',
      VOLC_TTS_SECRET_KEY: 's',
    }))).toThrow('VOLC_TTS_RESOURCE_ID');
    expect(() => createLaoliTtsProviderFromEnv(env({ LAOLI_TTS_PROVIDER: 'bad' }))).toThrow('unknown');
  });

  it('writes a valid RIFF length for PCM', () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWav(pcm, 24000, 1);
    expect(wav.readUInt32LE(4)).toBe(136);
    expect(wav.readUInt32LE(40)).toBe(100);
  });
});

describe('laoli tts volc-v3 (seed-tts-2.0 大模型)', () => {
  const v3 = {
    appId: 'app',
    accessToken: 'token',
    resourceId: 'seed-tts-2.0',
    endpoint: 'https://openspeech.example/api/v3/tts/unidirectional',
    voice: 'zh_male_yuanboxiaoshu_uranus_bigtts',
    format: 'mp3' as const,
    sampleRate: 24000,
    timeoutMs: 1000,
  };

  it('concatenates base64 data chunks from the streamed response', () => {
    const a = Buffer.from('ID3a'); const b = Buffer.from('mp3b');
    const body = `{"data":"${a.toString('base64')}"}\n{"data":"${b.toString('base64')}"}\n{"data":""}`;
    expect(extractStreamedTtsAudio(body)).toEqual(Buffer.concat([a, b]));
    expect(extractStreamedTtsAudio('{"header":{"code":1}}').length).toBe(0);
  });

  it('posts v3 unidirectional with App-Id/Access-Key auth and a uranus speaker', async () => {
    const audio = Buffer.from('mp3-bytes');
    let init: RequestInit | undefined;
    const fetchMock: typeof fetch = vi.fn(async (_u: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Response(`{"data":"${audio.toString('base64')}"}`, { status: 200 });
    });
    const out = await createVolcV3LaoliTtsProvider(v3, fetchMock).synthesize({ text: '嚯，这球赢得提气' });
    expect(out).toMatchObject({ provider: 'volc-v3', contentType: 'audio/mpeg', sampleRate: 24000 });
    expect(out.audio).toEqual(audio);
    expect(init?.headers).toMatchObject({
      'X-Api-App-Id': 'app',
      'X-Api-Access-Key': 'token',
      'X-Api-Resource-Id': 'seed-tts-2.0',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.req_params).toMatchObject({
      text: '嚯，这球赢得提气',
      speaker: 'zh_male_yuanboxiaoshu_uranus_bigtts',
      audio_params: { format: 'mp3', sample_rate: 24000 },
    });
  });

  it('throws a clear error when the resource is not granted', async () => {
    const denied: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ header: { code: 45000030, message: 'requested resource not granted' } }), { status: 403 }));
    await expect(createVolcV3LaoliTtsProvider(v3, denied).synthesize({ text: '测试' }))
      .rejects.toThrow('v3 request failed: 403');
  });

  it('defaults resource/voice and selects volc-v3 from env', () => {
    const cfg = loadVolcV3LaoliTtsConfig(env({ VOLC_TTS_APP_ID: 'a', VOLC_TTS_ACCESS_TOKEN: 't' }));
    expect(cfg).toMatchObject({ resourceId: 'seed-tts-2.0', voice: 'zh_male_yuanboxiaoshu_uranus_bigtts' });
    expect(cfg.endpoint).toContain('/api/v3/tts/unidirectional');
    expect(createLaoliTtsProviderFromEnv(env({ LAOLI_TTS_PROVIDER: 'volc-v3', VOLC_TTS_APP_ID: 'a', VOLC_TTS_ACCESS_TOKEN: 't' })).name)
      .toBe('volc-v3');
  });
});
