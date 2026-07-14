import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/track/route';
import { authed, json, req } from './_utils';

const body = { event_id: 'E001', event_name: 'app_open', properties: {} };

describe('/api/track', () => {
  it('returns ok', async () => {
    expect(await json(await POST(authed('/api/track', { method: 'POST', body: JSON.stringify(body) })))).toEqual({ ok: true });
  });

  it('rejects bad event id', async () => {
    expect((await POST(authed('/api/track', { method: 'POST', body: JSON.stringify({ ...body, event_id: 'X1' }) }))).status).toBe(400);
  });

  it('requires x-openid', async () => {
    expect((await POST(req('/api/track', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(401);
  });

  it('matches miniprogram track shape', async () => {
    expect(Object.keys(await json(await POST(authed('/api/track', { method: 'POST', body: JSON.stringify(body) }))))).toEqual(['ok']);
  });

  it('rejects payload > 8KB', async () => {
    const res = await POST(authed('/api/track', { method: 'POST', body: JSON.stringify({ huge: 'a'.repeat(9 * 1024) }) }));
    expect(res.status).toBe(413);
  });

  it('rejects unknown fields', async () => {
    const res = await POST(authed('/api/track', { method: 'POST', body: JSON.stringify({ ...body, system_override: 'bypass' }) }));
    expect(res.status).toBe(400);
  });

  it('accepts session_id in the event body', async () => {
    const res = await POST(authed('/api/track', {
      method: 'POST',
      body: JSON.stringify({ ...body, session_id: 'sess_2026-05-15:a.1' }),
    }));
    expect(await json(res)).toEqual({ ok: true });
  });

  it('rejects invalid body session_id', async () => {
    const res = await POST(authed('/api/track', {
      method: 'POST',
      body: JSON.stringify({ ...body, session_id: 'bad session id' }),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid x-session-id header', async () => {
    const res = await POST(authed('/api/track', {
      method: 'POST',
      headers: { 'x-session-id': 'bad session id' },
      body: JSON.stringify(body),
    }));
    expect(res.status).toBe(400);
  });
});
