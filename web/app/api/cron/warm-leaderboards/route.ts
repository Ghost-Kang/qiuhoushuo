/**
 * GET /api/cron/warm-leaderboards — 全量预热射手榜/助攻榜 + 12 小组积分榜 + 淘汰赛对阵图。
 * ADMIN_API_SECRET Bearer 鉴权(同 auto-report)。空榜不落卡;失败不抛,best-effort。
 *
 * ⚠️ 不再每小时调度(2026-06-30 改):无比赛时空跑无意义。**主刷新改为事件驱动**——每场完赛后
 * auto-report 取到数据即调 prewarmLeaderboards 重渲(见 auto-report/route.ts)。本端点保留作
 * **手动/部署后一次性初始预热**(消除冷启动首访冷渲),按需手动调,不挂 crontab。
 */

import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { getCardStorage } from '@/lib/api/card-storage';
import { prewarmLeaderboards } from '@/lib/api/leaderboard-prewarm';

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await prewarmLeaderboards(getCardStorage());
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/warm-leaderboards] fail:', err);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
