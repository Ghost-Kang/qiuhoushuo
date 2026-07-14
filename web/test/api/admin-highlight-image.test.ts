import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, req } from './_utils';

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.ADMIN_TOKEN;
});

describe('/api/admin/highlight-image', () => {
  it('rejects requests without admin token', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req('/api/admin/highlight-image', {
      method: 'POST',
      body: JSON.stringify(validBody()),
    }));
    expect(res.status).toBe(401);
  });

  it('rejects invalid bodies before generating', async () => {
    const { POST, storage } = await loadRoute();
    const res = await POST(adminReq({ matchId: 'm1', moment: { id: 'x' } }));
    expect(res.status).toBe(400);
    expect(storage.puts).toEqual([]);
  });

  it('generates a mock JPEG and stores it with highlight-image key', async () => {
    const { POST, storage } = await loadRoute();
    const res = await POST(adminReq(validBody()));

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      key: 'highlight-images/match-1/score-turn.jpg',
      url: 'memory://test/highlight-images/match-1/score-turn.jpg',
      provider: 'mock',
      contentType: 'image/jpeg',
    });
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]?.contentType).toBe('image/jpeg');
    expect(storage.puts[0]?.body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });
});

function validBody() {
  return {
    matchId: 'match-1',
    moment: {
      id: 'score-turn',
      minute: '关键进球',
      title: '巴西把比分写进镜头',
      description: '这一下是整篇战报的主画面。',
      image_prompt: '足球比赛关键进球瞬间，非真实球员肖像',
    },
  };
}

function adminReq(body: unknown) {
  return req('/api/admin/highlight-image', {
    method: 'POST',
    headers: { 'x-admin-token': 'secret' },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  const storage = {
    puts: [] as Array<{ key: string; body: Buffer; contentType: 'image/png' | 'image/jpeg' }>,
    async exists() {
      return null;
    },
    async put(key: string, body: Buffer, contentType: 'image/png' | 'image/jpeg') {
      storage.puts.push({ key, body, contentType });
      return `memory://test/${key}`;
    },
  };
  vi.doMock('@/lib/api/card-storage', () => ({
    getCardStorage: () => storage,
  }));
  const route = await import('@/app/api/admin/highlight-image/route');
  return { POST: route.POST, storage };
}
