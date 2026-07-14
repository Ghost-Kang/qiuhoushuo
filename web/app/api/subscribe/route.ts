/**
 * POST /api/subscribe — 记录用户的开赛/战报订阅(微信一次性订阅,客户端 requestSubscribeMessage 授权后调用)。
 * body: { match_id(uuid), kinds: ['match_start'|'report_ready'] };鉴权:x-openid。
 * upsert(openid,match_id,kind):重订阅重置 sent_at=null(微信每次授权 = 一次推送额度)。
 */
import { z } from 'zod';
import { badRequest, getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';

const Body = z.object({
  match_id: z.string().uuid(),
  kinds: z.array(z.enum(['match_start', 'report_ready'])).min(1).max(2),
});

export async function POST(req: Request) {
  const rid = requestId();
  const openid = getOpenid(req);
  if (!openid) return unauthorized();
  if (!USE_DB) return ok({ subscribed: [] }); // dev/mock:无 DB,直接 ok 不报错

  let raw: unknown;
  try { raw = await req.json(); } catch { return badRequest({ body: 'INVALID_JSON' }); }
  const parsed = withZod(Body, raw);
  if ('error' in parsed) return parsed.error;
  const { match_id, kinds } = parsed.data;

  try {
    const db = getSupabaseService();
    if (!db) return internal(rid);
    const rows = kinds.map((kind) => ({ openid, match_id, kind, sent_at: null }));
    const { error } = await db.from('match_subscriptions').upsert(rows, { onConflict: 'openid,match_id,kind' });
    if (error) {
      console.warn('[api/subscribe] upsert fail:', error.message);
      return internal(rid);
    }
    return ok({ subscribed: kinds });
  } catch (e) {
    console.warn('[api/subscribe] error:', (e as Error).message);
    return internal(rid);
  }
}
