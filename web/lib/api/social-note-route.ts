/**
 * 手动触发某平台某场社媒内容生成的共用路由处理器(运营 curl / 回填历史场)。
 * 鉴权:ADMIN_API_SECRET Bearer(同 cron/mp-draft)。Body: { match_id }。
 * 三平台各一个 route 文件,均 `export const POST = makeSocialNoteHandler(<platform>)`。
 * 不受 *_AUTO_GEN 门控(手动即生成);生成 → 落「比赛文件夹/<平台>/」→ 企微推首条全文。
 */
import { z } from 'zod';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { notifyOpsFireAndForget } from '@/lib/alerts';
import { generateSocialForMatch, buildSocialAlert, pushMatchCardImagesToWecom, PLATFORMS, type SocialDb, type PlatformId } from '@/lib/api/social-content';

const Body = z.object({ match_id: z.string().uuid() });

export function makeSocialNoteHandler(platform: PlatformId) {
  return async function POST(req: Request): Promise<Response> {
    const expected = process.env.ADMIN_API_SECRET;
    if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
    if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (!USE_DB) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
    const db = getSupabaseService();
    if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

    let parsed: z.infer<typeof Body>;
    try {
      parsed = Body.parse(await req.json());
    } catch {
      return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
    }

    const res = await generateSocialForMatch(db as unknown as SocialDb, parsed.match_id, platform);
    if (!res) return Response.json({ error: 'REPORT_NOT_FOUND' }, { status: 404 });
    notifyOpsFireAndForget(buildSocialAlert(PLATFORMS[platform], res.bundle, res.dir, res.archived));
    void pushMatchCardImagesToWecom(parsed.match_id); // 手机长按存图,免点链接(best-effort)
    return Response.json({
      ok: true,
      platform,
      match_id: parsed.match_id,
      dir: res.dir,
      archived: res.archived,
      notes: res.bundle.notes.map((n) => ({ kind: n.kind, title: n.title })),
    });
  };
}
