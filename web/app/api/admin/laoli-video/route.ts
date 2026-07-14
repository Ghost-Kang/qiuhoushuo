import { z } from 'zod';
import { getCardStorage } from '@/lib/api/card-storage';
import { loadLaoliVideoContext, loadLaoliReelContext, type LaoliVideoContextDb } from '@/lib/api/laoli-video-context';
import { startLaoliReelDetached } from '@/lib/api/laoli-reel-pipeline';
import {
  buildLaoliFinalVideoKey,
  laoliVideoEnabled,
  runLaoliVideoPipeline,
} from '@/lib/api/laoli-video-pipeline';
import {
  createLaoliAvatarProviderFromEnv,
  laoliAvatarEnabled,
  laoliAvatarMode,
  laoliRefPublicUrl,
  type LaoliAvatarProvider,
} from '@/lib/api/laoli-avatar';
import { runLaoliLeanPipeline } from '@/lib/api/laoli-lean-pipeline';
import { buildLaoliLipsyncPrompt } from '@/lib/api/laoli-avatar';
import { createLaoliTtsProviderFromEnv } from '@/lib/api/laoli-tts';
import { createLaoliVideoProviderFromEnv } from '@/lib/api/laoli-video';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

const Body = z.object({
  matchId: z.string().uuid(),
  force: z.boolean().optional().default(false),
  /** 首场景封面照(base64·可选):reel 模式首帧卡槽放这张照片封面(像 topic 片)。压过的小图,~几百 KB。 */
  cover: z.string().optional(),
  /** 结尾 CTA 覆写(跨promo钩子·如押球导流):透传 arc,过轻校验才用,否则回退 FOLLOW_HOOK。 */
  ctaOverride: z.string().max(60).optional(),
  /** strict arc-only(内容质量红线):arc 不可用时硬失败,不产降级片。自动线传 true。 */
  strict: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!laoliVideoEnabled()) {
    return Response.json({ error: 'LAOLI_VIDEO_DISABLED' }, { status: 403 });
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
  const finalKey = buildLaoliFinalVideoKey(body.matchId);
  if (!body.force) {
    const existing = await storage.exists(finalKey);
    if (existing) {
      return Response.json({ ok: true, reused: true, matchId: body.matchId, finalKey, finalUrl: existing });
    }
  }
  const context = await loadLaoliVideoContext(db as unknown as LaoliVideoContextDb, storage, body.matchId);
  if (!context) return Response.json({ error: 'MATCH_OR_REPORT_NOT_FOUND' }, { status: 404 });

  let avatarProvider: LaoliAvatarProvider | undefined;
  if (laoliAvatarEnabled()) {
    try {
      avatarProvider = createLaoliAvatarProviderFromEnv();
    } catch {
      // 配置不全(如 omnihuman 缺 AK/SK)时不阻断,回退动态背景路径。
      avatarProvider = undefined;
    }
  }

  try {
    // reel:ffmpeg 合成版(30s·生成图轮播 + 老李右下 PiP + 字幕 + 混音)。
    // **异步 202**:真 pipeline 后台跑(多段 seedance ~分钟级,绕 HTTP/nginx 超时),客户端轮询 status.json。
    if (laoliAvatarMode() === 'reel' && avatarProvider) {
      const reel = await loadLaoliReelContext(db as unknown as LaoliVideoContextDb, storage, body.matchId);
      if (!reel) return Response.json({ error: 'MATCH_OR_REPORT_NOT_FOUND' }, { status: 404 });
      const coverImage = body.cover ? Buffer.from(body.cover, 'base64') : undefined;
      const { statusKey, finalKey: reelFinalKey, accepted } = startLaoliReelDetached(
        { matchId: body.matchId, match: reel.match, reports: reel.reports, coverImage, ctaOverride: body.ctaOverride, strictArc: body.strict },
        { storage, ttsProvider: createLaoliTtsProviderFromEnv(), avatarProvider, refImageUrl: laoliRefPublicUrl(), reportId: reel.reportId },
      );
      if (!accepted) return Response.json({ ok: false, busy: true, mode: 'reel', statusKey }, { status: 409 });
      return Response.json({ ok: true, mode: 'reel', state: 'running', statusKey, finalKey: reelFinalKey }, { status: 202 });
    }
    // 精简版:裸 OmniHuman 口播直出,不走 Remotion/ffmpeg(生产容器无 Chromium/ffmpeg)。
    if (laoliAvatarMode() === 'lean' && avatarProvider) {
      const result = await runLaoliLeanPipeline({
        matchId: body.matchId,
        match: context.match,
        reports: context.reports,
      }, {
        storage,
        ttsProvider: createLaoliTtsProviderFromEnv(),
        avatarProvider,
        refImageUrl: laoliRefPublicUrl(),
        prompt: buildLaoliLipsyncPrompt(),
      });
      return Response.json({ ok: true, reused: false, mode: 'lean', ...result });
    }

    const result = await runLaoliVideoPipeline({
      matchId: body.matchId,
      ...context,
    }, {
      storage,
      ttsProvider: createLaoliTtsProviderFromEnv(),
      videoProvider: createLaoliVideoProviderFromEnv(),
      avatarProvider,
    });
    return Response.json({ ok: true, reused: false, mode: 'compose', ...result });
  } catch (error) {
    return Response.json({ error: 'LAOLI_VIDEO_FAILED', message: (error as Error).message }, { status: 502 });
  }
}
