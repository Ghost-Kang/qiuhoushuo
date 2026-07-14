/**
 * POST /api/admin/mp-draft — 把某场战报一键推成服务号图文草稿(运营触发)。
 * 鉴权:ADMIN_API_SECRET Bearer(同 cron;运营用 curl 触发)。
 * Body: { match_id, style?, all? }。
 *   - 默认推单风格(style,默认 duanzi)。
 *   - all:true → 推全三版(战术/好笑/追剧)并给管理员发一条推送汇总提醒。
 * 取战报正文 + 一图看懂/战术图字节(COS getBytes,已预热)→ 建草稿。成功后运营在公众号后台「草稿箱」即见排好的图文。
 */
import { z } from 'zod';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { getCardStorage } from '@/lib/api/card-storage';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { notifyOpsFireAndForget } from '@/lib/alerts';
import { fanPortraitEnabled } from '@/lib/api/fan-portrait';
import {
  publishStyle,
  publishAllStyles,
  buildDraftPushedAlert,
  type MpDraftDb,
} from '@/lib/api/mp-draft-publish';

export const maxDuration = 60;

const Body = z.object({
  match_id: z.string().uuid(),
  style: z.enum(['hardcore', 'duanzi', 'emotion']).default('duanzi'),
  all: z.boolean().optional(),
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

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const mpDb = db as unknown as MpDraftDb;
  const storage = getCardStorage();

  // 全三版:推完给管理员发汇总提醒(同自动链路)。球迷形象仅此手动 all 路径附带(MP_DRAFT_FAN_PORTRAIT 门控),自动链路不带。
  if (parsed.all) {
    const summary = await publishAllStyles(mpDb, storage, parsed.match_id, {
      fanPortrait: { enabled: fanPortraitEnabled() },
    });
    if (!summary) return Response.json({ error: 'REPORT_NOT_FOUND' }, { status: 404 });
    notifyOpsFireAndForget(buildDraftPushedAlert(summary));
    const allOk = summary.results.every((r) => r.ok);
    return Response.json(
      { ok: allOk, match_id: parsed.match_id, results: summary.results },
      { status: allOk ? 200 : 502 },
    );
  }

  // 单风格。
  const r = await publishStyle(mpDb, storage, parsed.match_id, parsed.style);
  if (r.error === 'REPORT_NOT_FOUND') return Response.json({ error: 'REPORT_NOT_FOUND' }, { status: 404 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 502 });
  return Response.json({ ok: true, draftId: r.draftId, match_id: parsed.match_id, style: parsed.style });
}
