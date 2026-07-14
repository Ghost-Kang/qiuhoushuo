/**
 * API-Football /fixtures/events 接入（F63:战报与镜头图的"真实发生"数据源）。
 *
 * fixtures 同步只有比分,没有进球者/分钟——LLM 战报与镜头图 prompt 一直在"无料创作"。
 * 终场后事件已稳定,auto-report 在生成前拉一次并落 matches.events,供 prompts/镜头复用。
 */

import { apiFootballGet, type ApiFootballGetOptions } from './client';
import type { MatchData } from '@/lib/prompts';

export type MatchEvent = MatchData['events'][number];

interface RawEventEntry {
  time?: { elapsed?: number; extra?: number | null };
  team?: { name?: string };
  player?: { name?: string | null };
  assist?: { name?: string | null };
  type?: string;
  detail?: string;
}

/** API-Football 事件 → MatchData.events;不认识/无意义的条目丢弃(VAR 流程等)。 */
export function parseEventsResponse(response: unknown): MatchEvent[] {
  if (!Array.isArray(response)) return [];
  const events: MatchEvent[] = [];
  for (const raw of response as RawEventEntry[]) {
    const mapped = mapEvent(raw);
    if (mapped) events.push(mapped);
  }
  return events;
}

function mapEvent(raw: RawEventEntry): MatchEvent | null {
  const minute = typeof raw?.time?.elapsed === 'number' ? raw.time.elapsed + (raw.time?.extra ?? 0) : null;
  const team = raw?.team?.name ?? '';
  const player = raw?.player?.name ?? '';
  if (minute === null || !team) return null;
  const type = (raw.type ?? '').toLowerCase();
  const detail = (raw.detail ?? '').toLowerCase();

  let mappedType: MatchEvent['type'] | null = null;
  let description: string | undefined;
  if (type === 'goal') {
    // Missed Penalty 保留为「点球射失/被扑」(争议看点);Own Goal 标注乌龙
    if (detail.includes('missed')) mappedType = 'penalty_missed';
    else mappedType = detail.includes('penalty') ? 'penalty' : 'goal';
    if (detail.includes('own goal')) description = '乌龙球';
  } else if (type === 'card') {
    if (detail.includes('yellow')) mappedType = 'yellow_card';
    else if (detail.includes('red')) mappedType = 'red_card';
  } else if (type === 'subst') {
    mappedType = 'substitution';
  } else if (type === 'var') {
    // VAR 改判 = 最有争议/最引人关注的事件,过去整类丢弃,现在保留并中文化
    mappedType = 'var';
    description = varDescription(detail);
  }
  if (!mappedType) return null;

  return {
    minute,
    type: mappedType,
    team,
    player: player || '未知球员',
    ...(raw.assist?.name ? { assist: raw.assist.name } : {}),
    ...(description ? { description } : {}),
  };
}

/** API-Football VAR detail → 中文看点描述。 */
function varDescription(detail: string): string {
  if (detail.includes('disallow') || (detail.includes('goal') && detail.includes('cancel'))) return '进球被 VAR 吹无效';
  if (detail.includes('penalty') && (detail.includes('confirm') || detail.includes('award'))) return 'VAR 改判点球';
  if (detail.includes('penalty') && detail.includes('cancel')) return 'VAR 取消点球';
  if (detail.includes('red') || detail.includes('card')) return 'VAR 改判红牌';
  return 'VAR 介入改判';
}

export async function fetchFixtureEvents(
  fixtureId: string | number,
  opts: ApiFootballGetOptions = {},
): Promise<MatchEvent[]> {
  const { response } = await apiFootballGet<unknown>('/fixtures/events', { fixture: fixtureId }, opts);
  return parseEventsResponse(response);
}
