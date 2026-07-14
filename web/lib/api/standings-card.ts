/**
 * 小组积分榜卡:payload 组装 + 存储 key。赛事级随赛程每日变,key 带 组+日期戳 → 日级不可变缓存。
 */

import { renderShareCard, flagUrl, type CardPayload } from '@/lib/share-cards';
import { translateTeam } from '@qhs/share-cards';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { CARD_RENDER_CACHE_VERSION } from '@/lib/api/card-storage';
import type { GroupStanding } from '@/lib/api-football/standings';

/** "Group A" → "A组";已是 "A组" 形态则原样。非法/空 → 原串。 */
export function groupLabel(group: string): string {
  const m = /^Group\s+([A-Z])$/i.exec((group || '').trim());
  return m ? `${m[1]!.toUpperCase()}组` : group || '';
}

/**
 * 数据源官方出线分类 → 是否已出线(只认明确的下一轮分类,空/未定不声称)。
 * 先排除否定/淘汰词("did not qualify"/"eliminated" 含 qualif/out 会误判),再匹配正向晋级词。
 */
export function isQualified(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  if (/\bnot\b|fail|elimin|relegat|\bout\b/.test(d)) return false;
  return /round of \d|knockout|next round|promotion/.test(d);
}

export function buildStandingsCardKey(groupLetter: string, stamp: string): string {
  const safeG = (groupLetter || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 1) || 'x';
  const safeD = (stamp || '').replace(/[^0-9]/g, '') || 'na';
  return `cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/standings-${safeG}-${safeD}-xhs.png`;
}

export function buildStandingsPayload(group: GroupStanding, dateDisplay: string): CardPayload {
  const comp = sanitizeCompetition('国际大赛'); // league.name 恒为该赛事英文名,不外露,用中性名
  const label = groupLabel(group.group);
  return {
    competition: comp,
    date: dateDisplay,
    homeTeam: '', awayTeam: '', homeScore: 0, awayScore: 0,
    title: '积分榜', shareQuote: '', brand: '超帧球后说 · 积分榜 · AI 生成', shortUrl: '',
    standingsCard: {
      title_line: `${comp} · ${label} 积分榜`,
      asof: `数据截至 ${dateDisplay}`,
      rows: group.rows.map((r) => ({
        rank: r.rank,
        team: translateTeam(r.team),
        flag: flagUrl(r.team),
        played: r.played,
        win: r.win,
        draw: r.draw,
        lose: r.lose,
        goalsDiff: r.goalsDiff,
        points: r.points,
        qualified: isQualified(r.description),
      })),
      note: '积分/排名来自第三方足球数据源 · AI 生成内容整理',
    },
  };
}

export async function renderStandingsCard(payload: CardPayload): Promise<Buffer> {
  return renderShareCard('standings', 'xhs', payload);
}
