/**
 * POST /api/admin/laoli-topic — 老李「话题口播」片(跨场专题:金靴之争、盘点等)。
 * 与 /api/admin/laoli-video(单场)平行:接话题标题+事实清单+背景图(base64),
 * 走 laoli-topic-pipeline 出 shared PiP reel(0 seedance),存 topic-<slug>,审核 pending。
 * 异步 202,客户端轮询 status.json;单飞锁防并发同 slug。
 */
import { z } from 'zod';
import { getCardStorage } from '@/lib/api/card-storage';
import { buildLaoliFinalVideoKey, laoliVideoEnabled } from '@/lib/api/laoli-video-pipeline';
import { startLaoliTopicDetached } from '@/lib/api/laoli-topic-pipeline';
import { createLaoliTtsProviderFromEnv } from '@/lib/api/laoli-tts';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

const Body = z.object({
  slug: z.string().regex(/^[A-Za-z0-9-]{2,40}$/),
  title: z.string().min(2).max(60),
  facts: z.string().min(4).max(4000),
  backgrounds: z.array(z.string().min(16)).min(1).max(8),   // base64 PNG/JPG
  bgExts: z.array(z.enum(['png', 'jpg'])).optional(),
  // 显式逐场脚本(给了就跳过 LLM,逐场精确配图,如逐场看点片);缺省=LLM 话题脚本
  scenes: z.array(z.object({
    narration: z.string().min(4).max(200),
    subtitle: z.string().max(80).optional(),
    bgIndex: z.number().int().min(0).max(7).optional(),
  })).min(1).max(12).optional(),
  hook: z.string().max(40).optional(),   // 顶部钩子 banner(显式脚本时用)
  force: z.boolean().optional().default(false),
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

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const storage = getCardStorage();
  const topicId = `topic-${body.slug}`;
  const finalKey = buildLaoliFinalVideoKey(topicId);
  if (!body.force) {
    const existing = await storage.exists(finalKey);
    if (existing) {
      return Response.json({ ok: true, reused: true, topicId, finalKey, finalUrl: existing });
    }
  }

  let backgrounds: Buffer[];
  try {
    backgrounds = body.backgrounds.map((b) => Buffer.from(b, 'base64'));
    if (backgrounds.some((b) => b.length < 64)) throw new Error('bg too small');
  } catch {
    return Response.json({ error: 'BAD_BACKGROUNDS' }, { status: 400 });
  }

  const { statusKey, finalKey: topicFinalKey, accepted } = startLaoliTopicDetached(
    { slug: body.slug, title: body.title, facts: body.facts, backgrounds, bgExts: body.bgExts, scenes: body.scenes, hook: body.hook },
    { storage, ttsProvider: createLaoliTtsProviderFromEnv() },
  );
  if (!accepted) return Response.json({ ok: false, busy: true, mode: 'topic', statusKey }, { status: 409 });
  return Response.json({ ok: true, mode: 'topic', state: 'running', statusKey, finalKey: topicFinalKey }, { status: 202 });
}
