/**
 * 射手榜/助攻榜卡:payload 组装 + 存储 key(路由只导 handler,工具函数集中此处)。
 * 赛事级榜单随赛程每日变,key 带日期戳 → 日级不可变缓存(当日命中,次日换新键自动刷新)。
 */

import { renderShareCard, flagUrl, type CardPayload } from '@/lib/share-cards';
import { translateTeam } from '@qhs/share-cards';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { compactName } from '@/lib/api/player-name';
import { lookupPlayerZh } from '@/lib/api-football/player-names-zh';
import { CARD_RENDER_CACHE_VERSION } from '@/lib/api/card-storage';
import type { LeaderEntry } from '@/lib/api-football/leaderboard';

/**
 * 北京时区:返回 { stamp: 'YYYYMMDDHH'(进 key,**小时级**), display: 'YYYY.MM.DD'(印卡上) }。
 * 榜单随赛程一天变多次(每场完赛后),小时级 key → 缓存最多滞后 1 小时刷新(配 max-age=1800 响应头)。
 */
export function beijingDateParts(now: Date = new Date()): { stamp: string; display: string } {
  const iso = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(); // UTC+8
  const stamp = iso.slice(0, 13).replace(/[-T]/g, ''); // 'YYYY-MM-DDTHH' → 'YYYYMMDDHH'
  return { stamp, display: iso.slice(0, 10).replaceAll('-', '.') };
}

export function buildScoreboardCardKey(stamp: string): string {
  const safe = (stamp || '').replace(/[^0-9]/g, '') || 'na';
  return `cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/scoreboard-${safe}-xhs.png`;
}

function toRows(list: LeaderEntry[]) {
  // 名字优先中文译名(lookupPlayerZh,更易懂且更短);查不到回退 compactName(fontSafe 去豆腐块 + 控长)。队名英→中;队旗按英文队名反查(渲染层批量预取 base64)。
  return list.map((e) => ({ name: lookupPlayerZh(e.name) ?? compactName(e.name, 14), team: translateTeam(e.team), count: e.count, apps: e.apps, flag: flagUrl(e.team) }));
}

export function buildScoreboardPayload(
  scorers: LeaderEntry[],
  assists: LeaderEntry[],
  dateDisplay: string,
): CardPayload {
  const comp = sanitizeCompetition('国际大赛'); // 合规:中性赛事名(league.name 恒为该赛事英文名,不外露)
  return {
    competition: comp,
    date: dateDisplay,
    homeTeam: '', awayTeam: '', homeScore: 0, awayScore: 0,
    title: '射手榜 & 助攻榜', shareQuote: '', brand: '超帧球后说 · 射手榜&助攻榜 · AI 生成', shortUrl: '',
    scoreboardCard: {
      title_line: `${comp} · 射手榜 & 助攻榜`,
      asof: `数据截至 ${dateDisplay}`,
      scorers: toRows(scorers),
      assists: toRows(assists),
      note: '数据来源第三方足球数据源 · AI 生成内容整理',
    },
  };
}

export async function renderScoreboardCard(payload: CardPayload): Promise<Buffer> {
  return renderShareCard('scoreboard', 'xhs', payload);
}
