/**
 * 淘汰赛对阵图卡:RawBracket → CardPayload.bracketCard(中文队名 + 国旗 URL),+ 存储 key。
 * 赛事级随赛程变 → key 带小时戳,30 分钟 must-revalidate(配合 route),不可 immutable。
 */
import { renderShareCard, flagUrl, type CardPayload } from '@/lib/share-cards';
import { translateTeam } from '@qhs/share-cards';
import { CARD_RENDER_CACHE_VERSION } from '@/lib/api/card-storage';
import type { RawBracket, RawMatch } from '@/lib/api/bracket-data';
import type { BracketMatch } from '@qhs/share-cards';

export function buildBracketCardKey(stamp: string): string {
  const safe = (stamp || '').replace(/[^0-9]/g, '') || 'na';
  return `cards/${CARD_RENDER_CACHE_VERSION}/leaderboard/bracket-${safe}-xhs.png`;
}

function toMatch(m: RawMatch): BracketMatch {
  return {
    date: m.date,
    tag: m.tag,
    homeName: m.home ? translateTeam(m.home) : undefined,
    awayName: m.away ? translateTeam(m.away) : undefined,
    homeFlag: m.home ? flagUrl(m.home) : undefined,
    awayFlag: m.away ? flagUrl(m.away) : undefined,
    homeScore: m.homeScore ?? null,
    awayScore: m.awayScore ?? null,
    penHome: m.penHome ?? null,
    penAway: m.penAway ?? null,
    status: m.status,
  };
}
const arr = (ms: RawMatch[]) => ms.map(toMatch);

export function buildBracketPayload(raw: RawBracket): CardPayload {
  return {
    competition: '国际大赛', date: '', homeTeam: '', awayTeam: '', homeScore: 0, awayScore: 0,
    title: '对阵图', shareQuote: '', brand: '超帧球后说 · 淘汰赛对阵图 · AI 生成', shortUrl: '',
    bracketCard: {
      title: '国际大赛淘汰赛对阵图',
      subtitle: '（北京时间）',
      note: '数据随赛程自动更新 · 比分来自第三方足球数据源',
      topR32: arr(raw.topR32), top16: arr(raw.top16), top8: arr(raw.top8), topSF: arr(raw.topSF),
      final: arr(raw.final), third: arr(raw.third),
      botSF: arr(raw.botSF), bot8: arr(raw.bot8), bot16: arr(raw.bot16), botR32: arr(raw.botR32),
    },
  };
}

export async function renderBracketCard(payload: CardPayload): Promise<Buffer> {
  return renderShareCard('bracket', 'xhs', payload);
}
