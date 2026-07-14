import { getSupabaseAnon, USE_DB } from '@/lib/api/mode';
import { mockMatchesToday } from '@/lib/api/mock';
import { internal, ok, requestId, withZod } from '@/lib/api/respond';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { translateTeam } from '@qhs/share-cards';
import { z } from 'zod';

const Query = z.object({}).strict();

/** 已完赛列表长度上限（按时间倒序；组赛打满前覆盖最近 4 个比赛日） */
const FINISHED_LIMIT = 12;

type MatchRow = {
  id: string;
  home_team: string;
  away_team: string;
  home_score?: number | null;
  away_score?: number | null;
  competition?: string | null;
  match_date: string;
  status?: string | null;
  stats?: Record<string, unknown> | null;
};

export async function GET(req: Request) {
  const rid = requestId();
  try {
    const parsed = withZod(Query, Object.fromEntries(new URL(req.url).searchParams));
    if ('error' in parsed) return parsed.error;
    if (!USE_DB) return ok(mockMatchesToday());
    const db = getSupabaseAnon()!;
    const now = new Date();
    // 「今天」按北京时间(UTC+8,无夏令时)的日历日切。开球时间也按北京时间显示(toMatch.kickoff),
    // 日界必须同步用北京时间——否则北京次日凌晨的比赛(UTC 仍属今天)会被错圈进「今天」,
    // 与当天已完赛的场次混排,出现"9点完赛却排在3点/6点未开赛之后"的时序错乱。
    const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
    const startBj = new Date(now.getTime() + BJ_OFFSET_MS); startBj.setUTCHours(0, 0, 0, 0);
    const start = new Date(startBj.getTime() - BJ_OFFSET_MS); // 北京今日 00:00 对应的 UTC 时刻
    const tomorrow = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const week = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
    const columns = 'id,home_team,away_team,home_score,away_score,competition,match_date,status,stats';
    const { data: todayRows } = await db.from('matches').select(columns).gte('match_date', start.toISOString()).lt('match_date', tomorrow.toISOString()).order('match_date');
    const { data: upcomingRows } = await db.from('matches').select(columns).gte('match_date', tomorrow.toISOString()).lt('match_date', week.toISOString()).order('match_date').limit(5);
    // 往期战报只收「北京今日之前」的已完赛——今天的已完赛已在「今天的比赛」呈现,否则两段重复(真机实证 6/16)。
    const { data: finishedRows } = await db.from('matches').select(columns).eq('status', 'finished').lt('match_date', start.toISOString()).order('match_date', { ascending: false }).limit(FINISHED_LIMIT);
    const today = todayRows ?? [];
    const upcoming = upcomingRows ?? [];
    const finished = finishedRows ?? [];
    return ok({
      today: today.map(toMatch),
      // 队名英→中、赛事商标词→国际大赛(translateTeam/sanitizeCompetition 均幂等,已是中文不变)
      upcoming: upcoming.map((m: MatchRow) => ({ id: m.id, home_team: translateTeam(m.home_team), away_team: translateTeam(m.away_team), kickoff_text: kickoffText(m.match_date) })),
      finished: finished.map(toFinished),
    });
  } catch {
    return internal(rid);
  }
}

function toMatch(m: MatchRow) {
  return {
    id: m.id,
    home_team: translateTeam(m.home_team),
    away_team: translateTeam(m.away_team),
    competition: sanitizeCompetition(m.competition),
    kickoff: new Date(m.match_date).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }),
    status: m.status,
    // 今日卡也带比分：live/finished 状态前端可直接展示
    home_score: m.home_score ?? null,
    away_score: m.away_score ?? null,
  };
}

function toFinished(m: MatchRow) {
  return {
    id: m.id,
    home_team: translateTeam(m.home_team),
    away_team: translateTeam(m.away_team),
    home_score: m.home_score ?? 0,
    away_score: m.away_score ?? 0,
    competition: sanitizeCompetition(m.competition),
    date_text: kickoffText(m.match_date),
  };
}

function kickoffText(matchDate: string): string {
  return new Date(matchDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
