/**
 * POST /api/admin/social-images — 手动触发某场「球迷形象样图 + 球星 AI 合影引流图」推企微(运营按需重推 / 回填 / 验证)。
 * 鉴权:ADMIN_API_SECRET Bearer(同 cron/xhs-note)。Body: { match_id }。
 * 不另设门控:与自动链路一致受 SOCIAL_FAN_PORTRAIT / SOCIAL_COSTAR_SHOWCASE(+ costar 生成门)控制;
 * 关则该类图不推。返回各图门控态 + 取到的当场球星,便于核对。best-effort,推送失败不报错。
 */
import { z } from 'zod';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import {
  loadSocialFactsFromDb,
  pushFanPortraitSamplesToWecom,
  pushCostarShowcaseToWecom,
  socialFanPortraitEnabled,
  socialCostarShowcaseEnabled,
  type SocialDb,
} from '@/lib/api/social-content';

export const maxDuration = 120; // costar img2img + 文生图,留足时间

const Body = z.object({ match_id: z.string().uuid() });

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

  const facts = await loadSocialFactsFromDb(db as unknown as SocialDb, parsed.match_id);
  if (!facts) return Response.json({ error: 'REPORT_NOT_FOUND' }, { status: 404 });

  await pushFanPortraitSamplesToWecom(facts).catch(() => {});
  await pushCostarShowcaseToWecom(facts).catch(() => {});

  return Response.json({
    ok: true,
    match_id: parsed.match_id,
    match: facts.matchLabel,
    star: facts.star ?? null,
    starTeam: facts.starTeam ?? null,
    fanPortrait: { enabled: socialFanPortraitEnabled() },
    costarShowcase: { enabled: socialCostarShowcaseEnabled(), willPush: socialCostarShowcaseEnabled() && Boolean(facts.star) },
  });
}
