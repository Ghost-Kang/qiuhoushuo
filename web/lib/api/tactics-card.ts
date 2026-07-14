/**
 * 战术图解卡:payload 组装 + 存储 key(路由文件只能导出 handler,工具函数集中在此)。
 */

import { renderShareCard, flagUrl, type CardPayload } from '@/lib/share-cards';
import { translateTeam } from '@qhs/share-cards';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import type { MatchFormations } from '@/lib/api-football/lineups';

export type TacticsMatchRow = {
  id: string;
  external_id?: string | null;
  competition?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  match_date?: string | null;
  short_code?: string | null;
  stats?: { apiFootball?: { homeTeamId?: number } } | null;
};

export function buildTacticsCardKey(matchId: string): string {
  const safeId = encodeURIComponent(matchId).replace(/%2F/gi, '');
  // v3(F67h):赛事名商标词合规清洗(→国际大赛),升版失效含商标词的旧 tactics 图。
  // v4(6/14):上下队名行加球队国旗(tactics teamLabel),渲染变,失效 v3 旧无旗战术图。
  // v5(6/15):短链域名 qiu.app→qiuhoushuo.com(印进卡里),失效 v4 旧含死链战术图。
  // v6(6/15):短链用 short_code(原误用 match.id,/m 只认 short_code→404),失效 v5 含错 id 链战术图。
  return `cards/v6/${safeId}/tactics-xhs.png`;
}

export function tacticsMatchToPayload(match: TacticsMatchRow): CardPayload {
  return {
    competition: sanitizeCompetition(match.competition),
    date: String(match.match_date || '').slice(0, 10).replaceAll('-', '.'),
    homeTeam: translateTeam(match.home_team || ''),
    awayTeam: translateTeam(match.away_team || ''),
    homeScore: match.home_score ?? 0,
    awayScore: match.away_score ?? 0,
    // 队名行国旗(复用赛事/战报/一图看懂同一套图):用原始英文队名解析国旗码
    homeFlagUrl: flagUrl(match.home_team),
    awayFlagUrl: flagUrl(match.away_team),
    title: '战术图解',
    shareQuote: '两队首发站位，一眼看懂攻防侧重。',
    brand: '超帧球后说 · 战术图解 · AI 生成',
    shortUrl: `qiuhoushuo.com/m/${match.short_code || match.id}`,
  };
}

export function tacticsMockPayload(matchId: string): CardPayload {
  return {
    ...tacticsMatchToPayload({
      id: matchId,
      competition: '国际大赛小组赛',
      home_team: '巴西',
      away_team: '西班牙',
      home_score: 2,
      away_score: 1,
      match_date: '2026-06-22',
    }),
    date: '2026.06.22',
  };
}

export async function renderTacticsCard(payload: CardPayload, formations: MatchFormations): Promise<Buffer> {
  return renderShareCard('tactics', 'xhs', {
    ...payload,
    tactics: { ...formations, note: 'AI 生成内容，站位基于官方首发阵型整理。' },
  });
}
