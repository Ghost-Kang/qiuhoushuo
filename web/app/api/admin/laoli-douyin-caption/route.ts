/**
 * 老李抖音发帖话术（标题/简介/自评）生成端点 · 薄编排层。
 * 服务端从 DB 载入同一个 match+reports（reel 六拍弧同源），走 buildLaoliDouyinCaption（envelope + 全套守卫），
 * 返回渲染好的 md。deploy/laoli-douyin-caption.sh 只负责 POST matchId 并落盘（不再内联 python 反向猜事实）。
 */
import { z } from 'zod';
import { getCardStorage } from '@/lib/api/card-storage';
import { loadLaoliReelContext, type LaoliVideoContextDb } from '@/lib/api/laoli-video-context';
import { buildLaoliDouyinCaption, renderCaptionMarkdown } from '@/lib/api/laoli-douyin-caption';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

const Body = z.object({
  matchId: z.string().uuid(),
  /** 已批准旁白（可选，仅作 LLM 语气参考，不反向解析成事实）。 */
  approvedNarration: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!USE_DB) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const storage = getCardStorage();
  const context = await loadLaoliReelContext(db as unknown as LaoliVideoContextDb, storage, body.matchId);
  if (!context) return Response.json({ error: 'MATCH_OR_REPORT_NOT_FOUND' }, { status: 404 });

  try {
    const caption = await buildLaoliDouyinCaption(context.match, context.reports, {
      matchId: body.matchId,
      approvedNarration: body.approvedNarration,
    });
    const markdown = renderCaptionMarkdown(caption, { match: context.match });
    return Response.json({
      ok: true,
      matchId: body.matchId,
      angleId: caption.angleId,
      source: caption.source,
      degraded: caption.degraded,
      fallbackReason: caption.fallbackReason,
      caption: { title: caption.title, intro: caption.intro, self: caption.self },
      markdown,
    });
  } catch (error) {
    return Response.json({ error: 'CAPTION_FAILED', message: (error as Error).message }, { status: 502 });
  }
}
