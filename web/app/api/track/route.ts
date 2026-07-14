import { z } from 'zod';
import { readJsonWithLimit } from '@/lib/api/body-limit';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { findUserByOpenid } from '@/lib/api/users';
import type { UsersClient } from '@/lib/api/users';

const Body = z.object({
  event_id: z.string().regex(/^E(00[1-9]|0[1-9]\d|099)$/),
  event_name: z.string().min(1),
  properties: z.record(z.unknown()).optional().default({}),
  openid: z.string().optional(),
  session_id: z.string().optional(),
  ts: z.number().optional(),
}).strict();

const SessionId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export type TrackDb = UsersClient & {
  from(table: 'events'): {
    insert(row: Record<string, unknown>): PromiseLike<unknown> | unknown;
  };
};

function getTrackDb(): TrackDb | null {
  const client: object | null = getSupabaseService();
  return client ? client as TrackDb : null;
}

export async function POST(req: Request) {
  const rid = requestId();
  try {
    const openid = getOpenid(req);
    if (!openid) return unauthorized();
    const body = await readJsonWithLimit<unknown>(req, 8 * 1024);
    if (!body.ok) return Response.json(body.error === 'PAYLOAD_TOO_LARGE' ? body : { error: 'invalid json' }, { status: body.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400 });
    const parsed = withZod(Body, body.data);
    if ('error' in parsed) return parsed.error;
    const sessionId = resolveSessionId(req, parsed.data.session_id);
    if (!sessionId.ok) {
      return Response.json({ error: 'BAD_REQUEST', details: { session_id: ['invalid session_id'] } }, { status: 400 });
    }
    if (USE_DB) {
      const db = getTrackDb()!;
      const user = await findUserByOpenid(db, openid);
      void db.from('events').insert({
        user_id: user?.id ?? null,
        session_id: sessionId.value,
        event_id: parsed.data.event_id,
        event_name: parsed.data.event_name,
        properties: parsed.data.properties,
      });
    } else {
      console.log('[track]', parsed.data.event_id, parsed.data.event_name);
    }
    return ok({ ok: true });
  } catch {
    return internal(rid);
  }
}

function resolveSessionId(req: Request, bodySessionId?: string): { ok: true; value: string | null } | { ok: false } {
  const raw = bodySessionId ?? req.headers.get('x-session-id') ?? '';
  if (!raw) return { ok: true, value: null };
  const parsed = SessionId.safeParse(raw);
  if (!parsed.success) return { ok: false };
  return { ok: true, value: parsed.data };
}
