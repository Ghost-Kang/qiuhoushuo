import { describe, expect, it } from 'vitest';
import { readJsonWithLimit } from '@/lib/api/body-limit';

describe('readJsonWithLimit', () => {
  it('accepts payload under limit', async () => {
    const res = await readJsonWithLimit<{ ok: boolean }>(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ok: true }) }), 100);
    expect(res).toEqual({ ok: true, data: { ok: true } });
  });

  it('rejects payload over limit with PAYLOAD_TOO_LARGE', async () => {
    const res = await readJsonWithLimit(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(20) }) }), 10);
    expect(res).toMatchObject({ ok: false, error: 'PAYLOAD_TOO_LARGE', limit: 10 });
  });

  it('rejects malformed JSON with INVALID_JSON', async () => {
    const res = await readJsonWithLimit(new Request('http://localhost', { method: 'POST', body: '{bad' }), 100);
    expect(res).toEqual({ ok: false, error: 'INVALID_JSON' });
  });

  it('handles empty body gracefully', async () => {
    const res = await readJsonWithLimit(new Request('http://localhost', { method: 'POST' }), 100);
    expect(res).toEqual({ ok: false, error: 'INVALID_JSON' });
  });
});
