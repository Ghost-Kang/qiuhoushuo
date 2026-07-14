import { z } from 'zod';
import { getSupabaseAnon, USE_DB } from '@/lib/api/mode';
import { mockRecentReports } from '@/lib/api/mock';
import { internal, ok, requestId, withZod } from '@/lib/api/respond';
import { buildRecentReportsGroups, type RawRecentRow } from '@/lib/api/recent-reports';

// limit = 去重后的"比赛场数"(非 reports 行数)。
const Query = z.object({ limit: z.coerce.number().int().min(1).max(20).default(12) }).strict();

export async function GET(req: Request) {
  const rid = requestId();
  try {
    const parsed = withZod(Query, Object.fromEntries(new URL(req.url).searchParams));
    if ('error' in parsed) return parsed.error;
    const limit = parsed.data.limit ?? 12;
    if (!USE_DB) return ok(buildRecentReportsGroups(mockRecentReports(), new Date(), limit));
    // reports 一场 3 风格行,要 limit 场需多取行;按 created_at 倒序取够再去重。
    const { data: rows } = await getSupabaseAnon()!
      .from('reports')
      .select('id,style,share_quote,created_at,is_premium,matches(short_code,competition,home_team,away_team,home_score,away_score,match_date)')
      .eq('is_premium', false)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit * 4, 80));
    return ok(buildRecentReportsGroups((rows ?? []) as RawRecentRow[], new Date(), limit));
  } catch {
    return internal(rid);
  }
}
