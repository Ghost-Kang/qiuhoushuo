/**
 * GET /api/standings → 12 小组积分榜 + 淘汰赛对阵 JSON(小程序端内页渲染用)。
 * 走 leaderboard-data 进程内缓存(配每小时 cron 预热)→ 命中秒返,免每次打 API。
 */

import { getStandingsData } from '@/lib/api/leaderboard-data';

export async function GET(): Promise<Response> {
  try {
    const data = await getStandingsData();
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=600' } });
  } catch (err) {
    console.error('[api/standings] fail:', err);
    return Response.json({ error: 'STANDINGS_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
