/**
 * POST /api/report
 *
 * 触发战报生成。终场哨响 + 5 分钟由调度系统调用（非用户直接触发）。
 *
 * 流程：
 * 1. 校验输入 MatchData
 * 2. 并行生成 3 风格
 * 3. 写入 reports 表（每条独立 row）
 * 4. 卡片懒生成（首次访问 /api/card 时按需渲染并缓存）
 * 5. 返回 reportId 与 3 风格摘要
 */

import { NextResponse } from 'next/server';
import { generateAllStyles, generateAllStylesWithPersist } from '@/lib/report';
import type { MatchData } from '@/lib/prompts';
import { getCardStorage } from '@/lib/api/card-storage';
import { prerenderCardsForReport } from '@/lib/api/card-prerender';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { trackServerEvent } from '@/lib/api/tracker';
import { readJsonWithLimit } from '@/lib/api/body-limit';
import { shouldDegradeGracefully } from '@/lib/api/finals-fallback';
import { generateShortCode } from '@/lib/api/shortcode';
import { requireInternalToken } from '@/lib/api/internal-token';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { z } from 'zod';

// 参 tasks/TASK-69 / F36+N1: Vercel free tier caps HTTP work at 60s; report LLM calls use 50s per provider.
export const maxDuration = 60;

const MatchDataSchema = z.object({
  match: z.string(),
  competition: z.string(),
  venue: z.string().optional(),
  date: z.string(),
  final_score: z.string(),
  halftime_score: z.string().optional(),
  events: z
    .array(
      z.object({
        minute: z.number(),
        type: z.enum(['goal', 'yellow_card', 'red_card', 'penalty', 'substitution', 'key_save']),
        team: z.string(),
        player: z.string(),
        assist: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .min(0),
  stats: z
    .object({
      possession: z.object({ home: z.number(), away: z.number() }).optional(),
      shots: z.object({ home: z.number(), away: z.number() }).optional(),
      shots_on_target: z.object({ home: z.number(), away: z.number() }).optional(),
      xg: z.object({ home: z.number(), away: z.number() }).optional(),
      pass_accuracy: z.object({ home: z.number(), away: z.number() }).optional(),
      corners: z.object({ home: z.number(), away: z.number() }).optional(),
    })
    .default({}),
  key_players: z
    .array(
      z.object({
        name: z.string(),
        team: z.string(),
        rating: z.number().optional(),
        highlights: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  /** 服务端 matchId（来自 matches 表） */
  matchId: z.string(),
}).strict();

export async function POST(req: Request) {
  // 内部调用鉴权（防止外部触发 LLM 计费）
  if (!timingSafeTokenEqual(req.headers.get('x-internal-token'), internalToken())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  const body = await readJsonWithLimit<unknown>(req, 64 * 1024);
  if (!body.ok) {
    if (body.error === 'PAYLOAD_TOO_LARGE') return NextResponse.json(body, { status: 413 });
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  payload = body.data;

  const parsed = MatchDataSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'schema fail', issues: parsed.error.issues }, { status: 400 });
  }

  const { matchId, ...matchData } = parsed.data;
  const t0 = Date.now();
  try {
    let reports;
    if (USE_DB) {
      const db = getSupabaseService()!;
      const shortCodeDb = asShortCodeDb(db);
      await ensureMatchShortCode(shortCodeDb, matchId);
      const result = await generateAllStylesWithPersist(db, matchId, matchData as MatchData);
      if (!result.persisted) {
        trackServerEvent(db, { eventId: 'E042', properties: { match_id: matchId, error: result.persistError ?? 'unknown' } });
        if (shouldDegradeGracefully()) {
          trackServerEvent(db, { eventId: 'E047', properties: { match_id: matchId, error: result.persistError ?? 'unknown' } });
          return NextResponse.json({
            ok: true,
            degraded: true,
            persisted: false,
            reports: result.reports,
            warning: 'persist failed but reports generated; user should expect manual recovery within 30min',
          });
        }
        return NextResponse.json({ error: 'persist failed' }, { status: 500 });
      }
      reports = result.reports;
      void prerenderCardsForReport(matchId, reports, getCardStorage());
    } else {
      reports = await generateAllStyles(matchData as MatchData);
      console.log('[api/report] USE_DB=false, skip report persist', { matchId });
    }
    const durationMs = Date.now() - t0;
    if (USE_DB) {
      trackServerEvent(getSupabaseService(), { eventId: 'E040', properties: { match_id: matchId, styles_count: Object.keys(reports).length, duration_ms: durationMs } });
    }
    return NextResponse.json({
      ok: true,
      matchId,
      durationMs,
      reports: Object.fromEntries(
        Object.entries(reports).map(([k, v]) => [
          k,
          {
            title: v.title,
            shareQuote: v.share_quote,
            tags: v.tags,
            provider: v.meta.provider,
            isFallback: v.meta.provider === 'fallback',
          },
        ]),
      ),
    });
  } catch (err) {
    console.error('[api/report] catastrophic fail:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function internalToken() {
  return requireInternalToken();
}

export type ShortCodeDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data?: { short_code?: string | null } | null }>;
      };
    };
    update(row: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error?: { code?: string; message?: string } | null }>;
    };
  };
};

function asShortCodeDb(client: object): ShortCodeDb {
  return client as ShortCodeDb;
}

async function ensureMatchShortCode(db: ShortCodeDb, matchId: string) {
  const { data } = await db.from('matches').select('short_code').eq('id', matchId).maybeSingle();
  if (data?.short_code) return;
  if (!data) throw new Error(`match not found: ${matchId}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await db.from('matches').update({ short_code: generateShortCode() }).eq('id', matchId);
    if (!error) return;
    if (error.code !== '23505' || attempt === 1) throw new Error(error.message ?? 'short_code update failed');
  }
}
