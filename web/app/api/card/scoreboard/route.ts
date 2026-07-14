/**
 * GET /api/card/scoreboard → 射手榜/助攻榜卡 PNG(xhs 1080x1440)
 *
 * - 赛事级榜单,数据来自 API-Football /players/topscorers + /players/topassists(live)。
 * - key 带北京日期戳 → 日级不可变缓存:当日命中 CDN,次日新键自动刷新(榜单随赛程变)。
 * - 双榜皆空(赛事初期无进球)→ 404 NO_DATA + no-store(可重试,不钉空卡进缓存)。
 * - API 异常 → 502 + no-store(不缓存坏数据)。
 * - inline=1:直返 PNG 字节(真机 wx.downloadFile 不跟 302);命中缓存走 COS getBytes。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCardStorage } from '@/lib/api/card-storage';
import { getSupabaseService } from '@/lib/api/mode';
import { trackServerEvent } from '@/lib/api/tracker';
import { ApiFootballError } from '@/lib/api-football/client';
import { fetchLeaderboard } from '@/lib/api-football/leaderboard';
import { fetchScoreLeaderboardsFromDb } from '@/lib/api/leaderboard-data';
import {
  beijingDateParts,
  buildScoreboardCardKey,
  buildScoreboardPayload,
  renderScoreboardCard,
} from '@/lib/api/scoreboard-card';

export async function GET(req: NextRequest) {
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  const { stamp, display } = beijingDateParts();
  const storage = getCardStorage();
  const key = buildScoreboardCardKey(stamp);

  // 缓存命中(当日已渲)→ 直返,免重复拉 API + 渲染
  if (process.env.CARD_PRERENDER_DISABLE !== '1') {
    const storedUrl = await storage.exists(key);
    if (storedUrl) {
      if (!inline) return NextResponse.redirect(storedUrl, 302);
      const cachedBytes = await storage.getBytes?.(key);
      if (cachedBytes) return pngResponse(cachedBytes);
    }
  }

  let scorers, assists;
  try {
    // 优先从 matches.events 算(即时准确·不滞后于完赛);无 DB 回退第三方聚合接口。
    const fromDb = await fetchScoreLeaderboardsFromDb(8);
    ({ scorers, assists } = fromDb ?? {
      scorers: await fetchLeaderboard('topscorers', {}, {}, 8),
      assists: await fetchLeaderboard('topassists', {}, {}, 8),
    });
  } catch (err) {
    console.error('[api/card/scoreboard] leaderboard fetch fail:', err);
    const status = err instanceof ApiFootballError ? 502 : 500;
    return NextResponse.json({ error: 'LEADERBOARD_UNAVAILABLE' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  // 赛事初期无进球/助攻 → 不钉空卡,可重试
  if (scorers.length === 0 && assists.length === 0) {
    return NextResponse.json({ error: 'NO_DATA' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const png = await renderScoreboardCard(buildScoreboardPayload(scorers, assists, display));
    if (process.env.CARD_PRERENDER_DISABLE !== '1') {
      try {
        await storage.put(key, png, 'image/png');
      } catch (err) {
        console.warn('[api/card/scoreboard] lazy back-fill failed:', (err as Error).message);
      }
    }
    trackServerEvent(getSupabaseService(), {
      eventId: 'E053',
      properties: { report_id: `scoreboard-${stamp}`, style: 'scoreboard', platform: 'xhs', variant: 'scoreboard', cache_hit: false },
    });
    return pngResponse(png);
  } catch (err) {
    console.error('[api/card/scoreboard] render fail:', err);
    return NextResponse.json({ error: 'render failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

// 榜单 URL 稳定但内容每小时变(key 带小时戳),故**不能** immutable/一年:否则客户端/CDN 钉死旧卡。
// 30 分钟 max-age:配小时级 key,端到端滞后 ≤ ~1.5h,够"赛事榜单快照"用,API 调用极省。
function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(Buffer.from(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=1800, must-revalidate',
    },
  });
}
