import { translateTeam } from '@qhs/share-cards';

export type HighlightMomentKind = 'goal' | 'pressure' | 'turning_point';

export interface HighlightMoment {
  id: string;
  kind: HighlightMomentKind;
  minute: string;
  title: string;
  description: string;
  image_alt: string;
  image_prompt: string;
  image_url?: string;
}

type MatchLike = {
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
};

type StatsLike = {
  shots?: { home?: number | null; away?: number | null } | null;
  shots_on_target?: { home?: number | null; away?: number | null } | null;
  xg?: { home?: number | string | null; away?: number | string | null } | null;
  /** fixtures 同步写入的真实球场信息(F63:生图 prompt 锚定真实发生地) */
  venue?: { name?: string | null; city?: string | null } | null;
};

export type MomentEventLike = {
  minute?: number | null;
  type?: string | null;
  team?: string | null;
  player?: string | null;
};

function n(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function teamOrFallback(value: string | null | undefined, fallback: string): string {
  const team = value?.trim();
  return team ? translateTeam(team) : fallback;
}

function leadingTeam(match: MatchLike): string {
  const home = teamOrFallback(match.home_team, '主队');
  const away = teamOrFallback(match.away_team, '客队');
  const homeScore = n(match.home_score) ?? 0;
  const awayScore = n(match.away_score) ?? 0;
  if (homeScore === awayScore) return home;
  return homeScore > awayScore ? home : away;
}

function pressureTeam(match: MatchLike, stats: StatsLike | null | undefined): string {
  const home = teamOrFallback(match.home_team, '主队');
  const away = teamOrFallback(match.away_team, '客队');
  const homeXg = n(stats?.xg?.home);
  const awayXg = n(stats?.xg?.away);
  if (homeXg !== null && awayXg !== null && homeXg !== awayXg) return homeXg > awayXg ? home : away;
  const homeShots = n(stats?.shots?.home);
  const awayShots = n(stats?.shots?.away);
  if (homeShots !== null && awayShots !== null && homeShots !== awayShots) return homeShots > awayShots ? home : away;
  return leadingTeam(match);
}

export function buildHighlightMoments(
  match: MatchLike,
  stats: StatsLike | null | undefined,
  events: MomentEventLike[] | null | undefined = null,
): HighlightMoment[] {
  const home = teamOrFallback(match.home_team, '主队');
  const away = teamOrFallback(match.away_team, '客队');
  const winner = leadingTeam(match);
  const pressure = pressureTeam(match, stats);
  const homeScore = n(match.home_score) ?? 0;
  const awayScore = n(match.away_score) ?? 0;
  const shotText = stats?.shots?.home != null && stats?.shots?.away != null
    ? `射门 ${stats.shots.home}:${stats.shots.away}`
    : '高压回合';
  const xgText = stats?.xg?.home != null && stats?.xg?.away != null
    ? `xG ${stats.xg.home}:${stats.xg.away}`
    : '禁区前沿的选择';

  // F63:prompt 锚定真实发生——球场/城市 + 真实进球(分钟/球队)。
  // 合规边界不动:始终"非真实球员肖像、无可辨识人脸与队徽",只真实化场景,不真实化人。
  const venueText = venuePromptPart(stats);
  const goals = (events ?? []).filter((e) => e?.type === 'goal' || e?.type === 'penalty');
  const keyGoal = goals.length ? goals[goals.length - 1]! : null;
  const keyGoalMinute = keyGoal?.minute != null ? `第${keyGoal.minute}分钟` : null;
  const keyGoalTeam = keyGoal?.team ? translateTeam(keyGoal.team) : winner;

  return [
    {
      id: 'score-turn',
      kind: 'goal',
      minute: keyGoalMinute ?? (homeScore + awayScore > 0 ? '关键进球' : '关键回合'),
      title: `${keyGoalTeam}把比分写进镜头`,
      description: keyGoal
        ? `${keyGoalMinute},${keyGoalTeam}锁定 ${homeScore}:${awayScore},这一下是整篇战报的主画面。`
        : `${home} ${homeScore}:${awayScore} ${away}，这一下是整篇战报的主画面。`,
      image_alt: `${home} 对 ${away} 的比分关键镜头示意图`,
      image_prompt: `${venueText}足球比赛${keyGoalMinute ?? '关键'}进球瞬间，${keyGoalTeam}球员完成决定性一脚，比分 ${homeScore}:${awayScore}，球场灯光、禁区、观众席，电影感运动摄影，非真实球员肖像，无可辨识人脸与队徽`,
    },
    {
      id: 'pressure-wave',
      kind: 'pressure',
      minute: '压迫时刻',
      title: `${pressure}的连续冲击`,
      description: `${shotText}，${xgText}，镜头应该落在禁区前沿和二点球争夺。`,
      image_alt: `${pressure}连续压迫的战术镜头示意图`,
      image_prompt: `${venueText}足球比赛连续压迫镜头，禁区前沿多人冲刺、防守线后退、球在脚下高速移动，战术分析风格，非真实照片，无可辨识人脸与队徽`,
    },
    {
      id: 'final-whistle',
      kind: 'turning_point',
      minute: '终场前后',
      title: '终场哨响后的表情',
      description: '这是适合放在结尾的情绪镜头：有人摊手，有人低头，有人已经开始复盘下一脚。',
      image_alt: `${home} 对 ${away} 终场后的情绪镜头示意图`,
      image_prompt: `${venueText}足球比赛终场哨响后，比分牌定格 ${homeScore}:${awayScore}，球员背影与表情、草皮、夜场灯光，克制的纪实摄影感，非真实球员肖像，无可辨识人脸与队徽`,
    },
  ];
}

function venuePromptPart(stats: StatsLike | null | undefined): string {
  const name = stats?.venue?.name?.trim();
  const city = stats?.venue?.city?.trim();
  if (!name && !city) return '';
  return `${[name, city].filter(Boolean).join('，')}，`;
}

export function firstHighlightMoment(
  match: MatchLike,
  stats: StatsLike | null | undefined,
  events: MomentEventLike[] | null | undefined = null,
): HighlightMoment {
  return buildHighlightMoments(match, stats, events)[0]!;
}
