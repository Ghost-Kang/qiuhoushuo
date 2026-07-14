/**
 * GET /api/card/bracket → 淘汰赛对阵图卡 PNG(新华社双向树·竖长图 1080×2560)
 *
 * - 赛事级整届一张图:固定 bracket 骨架 + matches 表实时比分覆盖 + 晋级方上浮(assembleBracket)。
 * - key 带北京小时戳 → 小时级缓存;随赛程刷新。inline=1 直返字节(命中走 COS getBytes)。
 * - 无 DB → 503;渲染失败 → 500 + no-store。供小程序「淘汰赛对阵图」页展示 + downloadFile 存相册分享。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCardStorage } from '@/lib/api/card-storage';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { beijingDateParts } from '@/lib/api/scoreboard-card';
import { assembleBracket, type BracketDbRow } from '@/lib/api/bracket-data';
import { buildBracketCardKey, buildBracketPayload, renderBracketCard } from '@/lib/api/bracket-card';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  if (!USE_DB) return NextResponse.json({ error: 'DB_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const db = getSupabaseService();
  if (!db) return NextResponse.json({ error: 'DB_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

  const { stamp } = beijingDateParts();
  const storage = getCardStorage();
  const key = buildBracketCardKey(stamp);

  if (process.env.CARD_PRERENDER_DISABLE !== '1') {
    const storedUrl = await storage.exists(key);
    if (storedUrl) {
      if (!inline) return NextResponse.redirect(storedUrl, 302);
      const cachedBytes = await storage.getBytes?.(key);
      if (cachedBytes) return pngResponse(cachedBytes);
    }
  }

  let rows: BracketDbRow[];
  try {
    const { data, error } = await db
      .from('matches')
      .select('home_team, away_team, home_score, away_score, status, match_date, events, stats')
      .order('match_date', { ascending: true });
    if (error) throw error;
    rows = (data || []) as unknown as BracketDbRow[];
  } catch (err) {
    console.error('[api/card/bracket] matches fetch fail:', err);
    return NextResponse.json({ error: 'DATA_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const png = await renderBracketCard(buildBracketPayload(assembleBracket(rows)));
    if (process.env.CARD_PRERENDER_DISABLE !== '1') {
      try {
        await storage.put(key, png, 'image/png');
      } catch (err) {
        console.warn('[api/card/bracket] lazy back-fill failed:', (err as Error).message);
      }
    }
    return pngResponse(png);
  } catch (err) {
    console.error('[api/card/bracket] render fail:', err);
    return NextResponse.json({ error: 'render failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

// 对阵随赛程变(key 带小时戳),30 分钟 max-age 配小时级 key,不 immutable。
function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(Buffer.from(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=1800, must-revalidate' },
  });
}
