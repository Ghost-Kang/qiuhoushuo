import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetStoryLeadRateLimitForTests } from '@/lib/story/lead';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  delete process.env.STORY_ENABLED;
  delete process.env.WECOM_BOT_WEBHOOK;
  __resetStoryLeadRateLimitForTests();
});

function leadReq(body: unknown, ip = '203.0.113.20') {
  return new Request('http://localhost/api/story/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/story/lead', () => {
  it('returns 404 when disabled', async () => {
    const { POST } = await import('@/app/api/story/lead/route');
    const res = await POST(leadReq({ role: 'client', contact: 'contact-ok' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when contact is missing', async () => {
    process.env.STORY_ENABLED = '1';
    process.env.WECOM_BOT_WEBHOOK = 'https://example.test/wecom';
    const { POST } = await import('@/app/api/story/lead/route');
    const res = await POST(leadReq({ role: 'client' }));
    expect(res.status).toBe(400);
  });

  it('sends webhook for a valid lead', async () => {
    process.env.STORY_ENABLED = '1';
    process.env.WECOM_BOT_WEBHOOK = 'https://example.test/wecom';
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('@/app/api/story/lead/route');
    const res = await POST(leadReq({
      role: 'developer',
      industry: 'content',
      need: 'MVP review',
      contact: 'dev@example.test',
    }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.test/wecom');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('"msgtype":"markdown"');
  });

  it('returns 503 when webhook is missing', async () => {
    process.env.STORY_ENABLED = '1';
    const { POST } = await import('@/app/api/story/lead/route');
    const res = await POST(leadReq({ role: 'client', contact: 'contact-ok' }));
    expect(res.status).toBe(503);
  });
});
