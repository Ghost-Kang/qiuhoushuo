/**
 * GET /api/card/tactics/[matchId] → 战术图解卡 PNG（xhs 1080x1440）
 *
 * - feature.tactics_card 灰度门（默认关，FEATURE_FLAG_TACTICS_CARD 控制）
 * - matchId 接受 match UUID 或 short_code（与 card 路由 id 语义对齐）
 * - 阵容来自 API-Football /fixtures/lineups（开球前 ~20-40min 可用）；
 *   无阵容 → 404 NO_LINEUPS + no-store（赛前轮询不可缓存）
 * - 渲染成功 → COS 回填 + immutable 缓存（与 card 路由同策略）
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCardStorage } from '@/lib/api/card-storage';
import { getSupabaseAnon, getSupabaseService, USE_DB } from '@/lib/api/mode';
import { trackServerEvent } from '@/lib/api/tracker';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { ApiFootballError } from '@/lib/api-football/client';
import { externalIdToFixtureId, fetchFixtureLineups, pickFormations, type MatchFormations } from '@/lib/api-football/lineups';
import {
  buildTacticsCardKey,
  renderTacticsCard,
  tacticsMatchToPayload,
  tacticsMockPayload,
  type TacticsMatchRow,
} from '@/lib/api/tactics-card';

const Params = z.object({ matchId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/) });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  }
  const { matchId } = parsed.data;

  const identity = {
    openid: req.headers.get('x-openid') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined,
  };
  if (!isFeatureEnabled('feature.tactics_card', identity)) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  if (!USE_DB) {
    // mock 模式：固定 demo 阵型，验流程不验数据
    const png = await renderTacticsCard(tacticsMockPayload(matchId), { homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
    return pngResponse(png);
  }

  const db = getSupabaseAnon();
  if (!db) throw new Error('SUPABASE_ANON_KEY required for tactics card DB load');
  const match = await loadMatch(db, matchId);
  if (!match) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const storage = getCardStorage();
  const key = buildTacticsCardKey(match.id);
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  if (process.env.CARD_PRERENDER_DISABLE !== '1') {
    const storedUrl = await storage.exists(key);
    if (storedUrl) {
      if (!inline) return NextResponse.redirect(storedUrl, 302);
      // inline 命中缓存:走 COS API 读字节(容器内可达),不要 fetch CDN(hairpin 不可达)。
      const cachedBytes = await storage.getBytes?.(key);
      if (cachedBytes) return pngResponse(cachedBytes);
    }
  }

  if (!match.external_id) return noLineups();
  const fixtureId = externalIdToFixtureId(match.external_id);
  if (fixtureId == null) return noLineups();
  let formations: MatchFormations | null;
  try {
    const teams = await fetchFixtureLineups(fixtureId);
    formations = pickFormations(teams, match.stats?.apiFootball?.homeTeamId);
  } catch (err) {
    console.error('[api/card/tactics] lineups fetch fail:', err);
    const status = err instanceof ApiFootballError ? 502 : 500;
    return NextResponse.json({ error: 'LINEUPS_UNAVAILABLE' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!formations) return noLineups();

  try {
    const png = await renderTacticsCard(tacticsMatchToPayload(match), formations);
    // 回填缓存不再受 inline 门控(客户端走 inline):否则 inline 渲染永不落缓存→每次都冷渲染。
    if (process.env.CARD_PRERENDER_DISABLE !== '1') {
      try {
        await storage.put(key, png, 'image/png');
      } catch (err) {
        console.warn('[api/card/tactics] lazy back-fill failed:', (err as Error).message);
      }
    }
    trackServerEvent(getSupabaseService(), {
      eventId: 'E053',
      properties: { report_id: match.id, style: 'tactics', platform: 'xhs', variant: 'tactics', cache_hit: false },
    });
    return pngResponse(png);
  } catch (err) {
    console.error('[api/card/tactics] render fail:', err);
    return NextResponse.json({ error: 'render failed' }, { status: 500 });
  }
}

async function loadMatch(db: NonNullable<ReturnType<typeof getSupabaseAnon>>, matchId: string): Promise<TacticsMatchRow | null> {
  const columns = 'id,external_id,competition,home_team,away_team,home_score,away_score,match_date,short_code,stats';
  if (!UUID_V4.test(matchId)) {
    const { data } = await db.from('matches').select(columns).eq('short_code', matchId).maybeSingle();
    return (data as TacticsMatchRow | null) ?? null;
  }
  const { data: byId } = await db.from('matches').select(columns).eq('id', matchId).maybeSingle();
  if (byId) return byId as TacticsMatchRow;
  // 小程序战报页传来的 UUID 也可能是 report.id（F53 同源教训：id 语义对称）：
  // reports.id → match_id → matches
  const { data: report } = await db.from('reports').select('match_id').eq('id', matchId).maybeSingle();
  const matchIdFromReport = (report as { match_id?: string | null } | null)?.match_id;
  if (!matchIdFromReport) return null;
  const { data: byReport } = await db.from('matches').select(columns).eq('id', matchIdFromReport).maybeSingle();
  return (byReport as TacticsMatchRow | null) ?? null;
}

function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(Buffer.from(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function noLineups(): NextResponse {
  // 赛前阵容未公布属正常态：404 但禁止缓存，开球前小程序可重试
  return NextResponse.json({ error: 'NO_LINEUPS' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
