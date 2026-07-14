/**
 * GET /api/cron/match-reminders — 开赛前提醒 cron(ADMIN_API_SECRET 鉴权,建议每 5-10 min 跑)。
 * 取 match_date 在 [now, now+35min] 的场(已开赛的不取),对订阅了 match_start 且未推过的用户推「比赛开始提醒」。
 * pushPendingForMatch 推完标 sent_at,重复跑不重推。战报就绪提醒在 auto-report 出战报后推(不在这里)。
 */
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { TMPL_MATCH_START, buildMatchStartData, pageForKind, pushPendingForMatch, type SubsDb } from '@/lib/api/wx-subscribe';

export const maxDuration = 60;

interface MatchRow {
  id: string;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
  match_date: string;
}
interface MatchesDb {
  from(table: 'matches'): {
    select(columns: string): {
      gte(column: 'match_date', value: string): {
        lt(column: 'match_date', value: string): PromiseLike<{ data: MatchRow[] | null }>;
      };
    };
  };
}

const WINDOW_MS = 35 * 60 * 1000; // 开赛前 ~30min 提醒;窗口略宽防 cron 间隔漏。已开赛(match_date<now)不取。

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return new Response('ADMIN_API_SECRET 未配置', { status: 503 });
  if (!timingSafeTokenEqual(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!USE_DB) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_MS);
  const { data: rows } = await (db as unknown as MatchesDb)
    .from('matches')
    .select('id,home_team,away_team,competition,match_date')
    .gte('match_date', now.toISOString())
    .lt('match_date', until.toISOString());
  const matches = rows ?? [];

  let sent = 0;
  let total = 0;
  for (const m of matches) {
    const r = await pushPendingForMatch(db as unknown as SubsDb, {
      matchId: m.id,
      kind: 'match_start',
      templateId: TMPL_MATCH_START,
      page: pageForKind('match_start', m.id),
      data: buildMatchStartData(m),
    });
    sent += r.sent;
    total += r.total;
  }
  return Response.json({ ok: true, matches: matches.length, pushed: sent, pending_seen: total });
}
