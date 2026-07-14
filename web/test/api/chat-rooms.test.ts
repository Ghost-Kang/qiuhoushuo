import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/chat/rooms/route';
import { authed, json, req } from './_utils';

describe('/api/chat/rooms', () => {
  it('returns empty rooms', async () => {
    expect(await json(await GET(authed('/api/chat/rooms')))).toEqual([]);
  });

  it('rejects unknown query', async () => {
    expect((await GET(authed('/api/chat/rooms?bad=1'))).status).toBe(400);
  });

  it('requires x-openid', async () => {
    expect((await GET(req('/api/chat/rooms'))).status).toBe(401);
  });

  it('matches miniprogram rooms shape', async () => {
    expect(Array.isArray(await json(await GET(authed('/api/chat/rooms'))))).toBe(true);
  });
});
