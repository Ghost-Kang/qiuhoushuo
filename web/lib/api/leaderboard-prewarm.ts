/**
 * 榜单卡预热:把射手榜/助攻榜 + 12 个小组积分榜在当前小时 key 下预渲落 COS,
 * 消除用户首次访问的冷渲(~1-2s)。配 cron 每小时跑(key 是小时级,见 scoreboard-card.ts)。
 *
 * 直接复用 card-lib(不自调 HTTP),省去逐组各拉一次 standings:standings 一次 fetch 出全部组,
 * 循环渲 12 张。scoreboard 2 次 API(进球+助攻),standings 1 次 API,共 3 次/小时,极省配额。
 */

import { getCardStorage, type CardStorageClient } from './card-storage';
import { fetchLeaderboard } from '@/lib/api-football/leaderboard';
import { fetchStandings } from '@/lib/api-football/standings';
import {
  beijingDateParts,
  buildScoreboardCardKey,
  buildScoreboardPayload,
  renderScoreboardCard,
} from './scoreboard-card';
import {
  buildStandingsCardKey,
  buildStandingsPayload,
  renderStandingsCard,
} from './standings-card';
import { getLeaderboardData, getStandingsData, fetchScoreLeaderboardsFromDb } from './leaderboard-data';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { assembleBracket, type BracketDbRow } from './bracket-data';
import { buildBracketCardKey, buildBracketPayload, renderBracketCard } from './bracket-card';

export interface LeaderboardPrewarmResult {
  stamp: string;
  scoreboard: 'warmed' | 'empty' | 'failed';
  standings: { warmed: number; groups: string[]; failed: number };
  bracket: 'warmed' | 'skipped' | 'failed'; // 淘汰赛对阵图(从 matches 表)
  json: 'warmed' | 'failed'; // 端内页 JSON 缓存(/api/leaderboard、/api/standings)预热
}

/** "Group A" → "A"(进 key);非字母组返空(调用方跳过)。 */
function groupLetterOf(group: string): string {
  const m = /^Group\s+([A-L])$/i.exec((group || '').trim());
  return m ? m[1]!.toUpperCase() : '';
}

export async function prewarmLeaderboards(
  storage: CardStorageClient = getCardStorage(),
  now: Date = new Date(),
): Promise<LeaderboardPrewarmResult> {
  const { stamp, display } = beijingDateParts(now);
  const result: LeaderboardPrewarmResult = {
    stamp,
    scoreboard: 'empty',
    standings: { warmed: 0, groups: [], failed: 0 },
    bracket: 'skipped',
    json: 'failed',
  };

  // 端内页 JSON 缓存预热(force 刷新进程内缓存)→ 用户进射手榜/积分榜页命中缓存秒出
  try {
    await Promise.all([getLeaderboardData(true), getStandingsData(true)]);
    result.json = 'warmed';
  } catch (err) {
    console.warn('[leaderboard-prewarm] json fail:', (err as Error).message);
  }

  // 射手榜/助攻榜:优先从 matches.events 算(即时准确·不滞后);无 DB 回退第三方聚合接口。
  try {
    const fromDb = await fetchScoreLeaderboardsFromDb(8);
    const { scorers, assists } = fromDb ?? {
      scorers: await fetchLeaderboard('topscorers', {}, {}, 8),
      assists: await fetchLeaderboard('topassists', {}, {}, 8),
    };
    if (scorers.length || assists.length) {
      const png = await renderScoreboardCard(buildScoreboardPayload(scorers, assists, display));
      await storage.put(buildScoreboardCardKey(stamp), png, 'image/png');
      result.scoreboard = 'warmed';
    }
  } catch (err) {
    console.warn('[leaderboard-prewarm] scoreboard fail:', (err as Error).message);
    result.scoreboard = 'failed';
  }

  // 小组积分榜:一次 fetch → 渲全部字母组
  try {
    const groups = await fetchStandings();
    for (const g of groups) {
      const letter = groupLetterOf(g.group);
      if (!letter || g.rows.length === 0) continue;
      try {
        const png = await renderStandingsCard(buildStandingsPayload(g, display));
        await storage.put(buildStandingsCardKey(letter, stamp), png, 'image/png');
        result.standings.warmed += 1;
        result.standings.groups.push(letter);
      } catch (err) {
        result.standings.failed += 1;
        console.warn(`[leaderboard-prewarm] standings ${letter} fail:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[leaderboard-prewarm] standings fetch fail:', (err as Error).message);
  }

  // 淘汰赛对阵图:从 matches 表取数 → 装配 bracket → 预渲(数据随赛程变,小时戳 key)
  try {
    const db = USE_DB ? getSupabaseService() : null;
    if (db) {
      const { data, error } = await db
        .from('matches')
        .select('home_team, away_team, home_score, away_score, status, match_date, events, stats');
      if (error) throw error;
      const rows = (data || []) as unknown as BracketDbRow[];
      const png = await renderBracketCard(buildBracketPayload(assembleBracket(rows)));
      await storage.put(buildBracketCardKey(stamp), png, 'image/png');
      result.bracket = 'warmed';
    }
  } catch (err) {
    console.warn('[leaderboard-prewarm] bracket fail:', (err as Error).message);
    result.bracket = 'failed';
  }

  return result;
}
