/**
 * GET /api/card/standings?group=A → 小组积分榜卡 PNG(xhs 1080x1440)
 *
 * - 赛事级单组积分表,数据来自 API-Football /standings(live)。
 * - key 带 组+北京日期戳 → 日级不可变缓存:当日命中,次日新键自动刷新。
 * - group 必填(A-L);缺/非法 → 400。该组无数据 → 404 + no-store。API 异常 → 502 + no-store。
 * - inline=1:直返 PNG 字节;命中缓存走 COS getBytes。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCardStorage } from '@/lib/api/card-storage';
import { getSupabaseService } from '@/lib/api/mode';
import { trackServerEvent } from '@/lib/api/tracker';
import { ApiFootballError } from '@/lib/api-football/client';
import { fetchStandings, pickGroup } from '@/lib/api-football/standings';
import { beijingDateParts } from '@/lib/api/scoreboard-card';
import { buildStandingsCardKey, buildStandingsPayload, renderStandingsCard } from '@/lib/api/standings-card';

export async function GET(req: NextRequest) {
  const rawGroup = (req.nextUrl.searchParams.get('group') || '').trim().toUpperCase();
  if (!/^[A-L]$/.test(rawGroup)) {
    return NextResponse.json({ error: 'BAD_GROUP', detail: 'group must be A-L' }, { status: 400 });
  }
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  const { stamp, display } = beijingDateParts();
  const storage = getCardStorage();
  const key = buildStandingsCardKey(rawGroup, stamp);

  if (process.env.CARD_PRERENDER_DISABLE !== '1') {
    const storedUrl = await storage.exists(key);
    if (storedUrl) {
      if (!inline) return NextResponse.redirect(storedUrl, 302);
      const cachedBytes = await storage.getBytes?.(key);
      if (cachedBytes) return pngResponse(cachedBytes);
    }
  }

  let group;
  try {
    const groups = await fetchStandings();
    group = pickGroup(groups, rawGroup);
  } catch (err) {
    console.error('[api/card/standings] standings fetch fail:', err);
    const status = err instanceof ApiFootballError ? 502 : 500;
    return NextResponse.json({ error: 'STANDINGS_UNAVAILABLE' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!group || group.rows.length === 0) {
    return NextResponse.json({ error: 'NO_DATA' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const png = await renderStandingsCard(buildStandingsPayload(group, display));
    if (process.env.CARD_PRERENDER_DISABLE !== '1') {
      try {
        await storage.put(key, png, 'image/png');
      } catch (err) {
        console.warn('[api/card/standings] lazy back-fill failed:', (err as Error).message);
      }
    }
    trackServerEvent(getSupabaseService(), {
      eventId: 'E053',
      properties: { report_id: `standings-${rawGroup}-${stamp}`, style: 'standings', platform: 'xhs', variant: 'standings', cache_hit: false },
    });
    return pngResponse(png);
  } catch (err) {
    console.error('[api/card/standings] render fail:', err);
    return NextResponse.json({ error: 'render failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

// 积分榜 URL 稳定但内容每小时变(key 带小时戳),不能 immutable/一年。30 分钟 max-age 配小时级 key。
function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(Buffer.from(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=1800, must-revalidate',
    },
  });
}
