export async function readJsonWithLimit<T>(
  req: Request,
  limit: number,
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON'; limit?: number; actual?: number }
> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, error: 'INVALID_JSON' };
  const chunks: Uint8Array[] = [];
  let actual = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    actual += value.byteLength;
    if (actual > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, error: 'PAYLOAD_TOO_LARGE', limit, actual };
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder('utf-8').decode(concat(chunks, actual));
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
}

function concat(chunks: Uint8Array[], total: number) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
