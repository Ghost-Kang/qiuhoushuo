import type { HighlightMoment } from '@/lib/api/highlight-moments';
import { translateTeam } from '@qhs/share-cards';
import { shortPlayer } from '@/lib/api/player-name';

type TeamScore = {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
};

type StyleBrief = {
  title?: string | null;
  lead?: string | null;
  share_quote?: string | null;
  tags?: string[] | null;
  stats?: Record<string, unknown> | null;
};

export type MatchBriefInput = {
  id: string;
  competition?: string | null;
  date?: string | null;
  match?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  stats?: Record<string, unknown> | null;
  /** 真实赛事事件(matches.events,API-Football /fixtures/events 落库);关键时间线据此生成。 */
  events?: unknown;
};

/** matches.events 单条事件的精简形状(关键时间线只读这几个字段)。 */
type BriefEvent = {
  minute?: number | null;
  type?: string | null;
  team?: string | null;
  player?: string | null;
  assist?: string | null;
  description?: string | null;
};

export type MatchBriefCard = {
  schema_version: 'match_brief_card_v1';
  title: string;
  match_line: string;
  one_sentence_summary: string;
  focus_tags: string[];
  key_reasons: { title: string; evidence: string }[];
  timeline: { minute: string; text: string }[];
  data_points: { label: string; value: string; note: string }[];
  highlight_lens?: { title: string; image_url?: string; caption: string };
  /** 战术阵型(F67g):由 card 路由拉官方首发后注入,缺数据时不设,模板降级。 */
  formation?: { home: string; away: string };
  share_line: string;
  integrity_note: string;
};

export function buildMatchBriefCard(
  match: MatchBriefInput,
  styles: Partial<Record<'hardcore' | 'duanzi' | 'emotion', StyleBrief>>,
  moments: HighlightMoment[],
): MatchBriefCard {
  const score = readScore(match);
  const stats = mergeStats(match.stats, styles);
  const dataPoints = buildDataPoints(stats, score);
  const { keyEvents, shootout } = parseKeyEvents(match.events, score);
  // 常规时间赢家与"晋级方"分开:点球大战场次 winner=互射胜者(标题/摘要/①用),
  // 而效率/走势(②③)按常规时间战平口径叙事——"控球占优却未能取胜"对点球局才成立。
  const regulationWinner = winnerName(score);
  const penWinner = shootout ? (shootout.home > shootout.away ? score.home : score.away) : null;
  const winner = regulationWinner ?? penWinner;
  const coreTitle = clean(styles.hardcore?.title) || clean(styles.duanzi?.title) || `一图看懂：${score.home} vs ${score.away}`;
  const summary = shootout && penWinner
    ? `${scoreLine(score)}，点球大战 ${shootout.home}:${shootout.away}，${penWinner}晋级。`
    : `${scoreLine(score)}，${winner ? '胜负手落在效率和关键回合' : '比赛重点落在节奏、效率和关键回合'}。`;
  const tags = compact([
    shootout ? '点球大战' : winner ? '胜负手' : '拉锯战',
    dataPoints.some((point) => point.label === 'xG') ? '机会质量' : '关键回合',
    moments.some((moment) => moment.image_url) ? '精彩镜头' : null,
  ]);
  const highlight = moments[0];

  return {
    schema_version: 'match_brief_card_v1',
    title: `一图看懂：${coreTitle}`,
    match_line: `${sanitizeCompetition(match.competition) || '赛后战报'} · ${match.date || ''} · ${scoreLine(score)}`.replace(/\s+·\s+·\s+/, ' · '),
    one_sentence_summary: summary,
    focus_tags: tags,
    key_reasons: buildKeyReasons({ score, winner, regulationWinner, shootout, keyEvents, stats, dataPoints, styles, summary }),
    timeline: buildTimeline(keyEvents, moments, shootout, penWinner),
    data_points: dataPoints,
    highlight_lens: highlight ? {
      // 标题按本场特征生成(绝杀/逆转/点球/VAR/大胜/零封/进球者),避免千篇一律「XXX把比分写进镜头」。
      title: highlightLensTitle(keyEvents, score, winner, shootout) || highlight.title,
      image_url: highlight.image_url,
      // 说明优先用「全场最佳」(球员评分数据源 stats.players),无则用镜头描述。
      caption: motmCaption(match.stats) || highlight.description,
    } : undefined,
    share_line: clean(styles.duanzi?.share_quote) || clean(styles.emotion?.share_quote) || '两分钟看懂这场球的重点。',
    integrity_note: 'AI 生成内容，基于比分、战报与可用技术统计整理。',
  };
}

/** 官方战报风卡(ft)数据体,与 packages/share-cards ftCard 同构。 */
export type MatchFtCard = {
  meta_line: string;
  date_line: string;
  progression?: string;
  home_scorers: string[];
  away_scorers: string[];
  potm?: string;
  bars: { label: string; home: string; away: string; home_ratio: number }[];
  timeline: { minute: string; text: string }[];
  quote?: string;
  integrity_note: string;
};

/**
 * 官方战报风卡(ft):国际官方赛后模版结构 × 球后皮肤。
 * 复用 parseKeyEvents 的点球大战归拢/乌龙记分口径(与 brief/对阵图三处一致);
 * 比分进程优先 sync 落的 stats.scoreBreakdown(半场/90'/加时/点球),缺则事件推导兜底。
 * 球场名保留英文(founder 口径 2026-07-04);无镜头图依赖 → 恒可缓存。
 */
export function buildMatchFtCard(
  match: MatchBriefInput,
  opts: { matchDateIso?: string; shareQuote?: string } = {},
): MatchFtCard {
  const score = readScore(match);
  const stats = match.stats && typeof match.stats === 'object' && !Array.isArray(match.stats)
    ? (match.stats as Record<string, unknown>)
    : null;
  const { keyEvents, shootout } = parseKeyEvents(match.events, score);
  const penWinner = shootout ? (shootout.home > shootout.away ? score.home : score.away) : null;

  // meta_line:赛事 · 球场(球场名保留英文)
  const venue = stats?.venue as { name?: string | null; city?: string | null } | null | undefined;
  const venueText = venue && (venue.name || venue.city) ? [venue.name, venue.city].filter(Boolean).join(', ') : '';
  const meta_line = [sanitizeCompetition(match.competition) || '赛后战报', venueText].filter(Boolean).join(' · ');

  // 进球者双栏:常规进球(点球大战逐轮已被 parseKeyEvents 归拢),点球/乌龙标注,官方战报惯例乌龙随受益方列出
  const goals = keyEvents.filter((e): e is Extract<KeyEvent, { kind: 'goal' }> => e.kind === 'goal');
  const scorerText = (g: Extract<KeyEvent, { kind: 'goal' }>): string => {
    const name = shortPlayer(g.player) || g.team;
    const tag = g.penalty ? '(点球)' : g.ownGoal ? '(乌龙)' : '';
    return `${g.minute != null ? `${g.minute}' ` : ''}${name}${tag}`;
  };

  // 数据对比条:控球/射门/射正/xG,存在才上
  const bars: MatchFtCard['bars'] = [];
  const ratioOf = (pair: { home: number; away: number }): number =>
    pair.home + pair.away > 0 ? (pair.home / (pair.home + pair.away)) * 100 : 50;
  const pushBar = (label: string, pair: { home: number; away: number } | null) => {
    if (pair) bars.push({ label, home: formatNumber(pair.home), away: formatNumber(pair.away), home_ratio: ratioOf(pair) });
  };
  pushBar('控球 %', readPair(stats, 'possession'));
  pushBar('射门', readPair(stats, 'shots'));
  pushBar('射正', readPair(stats, 'shots_on_target') ?? readPair(stats, 'shots_on'));
  pushBar('xG 机会质量', readPair(stats, 'xg'));

  const quote = clean(opts.shareQuote);
  return {
    meta_line,
    date_line: `${beijingDateText(opts.matchDateIso || match.date || '')} · 北京`,
    progression: buildProgression(score, stats, shootout),
    home_scorers: goals.filter((g) => g.side === 'home').map(scorerText),
    away_scorers: goals.filter((g) => g.side === 'away').map(scorerText),
    potm: motmCaption(match.stats) || undefined,
    bars,
    // 分钟列用官方战报紧凑记法「59'」(「第59分钟」在 ft 卡窄列会折行);「点球大战」等非分钟标签保留
    timeline: buildTimeline(keyEvents, [], shootout, penWinner)
      .map((row) => ({ ...row, minute: row.minute.replace(/^第(\d+)分钟$/, "$1'") })),
    quote: quote || undefined,
    integrity_note: 'AI 生成内容，基于比分、战报与可用技术统计整理。',
  };
}

/** match_date(ISO/日期串)→ 北京日期 "YYYY.MM.DD";解析失败原样截日期。 */
function beijingDateText(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return (iso || '').slice(0, 10).replaceAll('-', '.');
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${bj.getUTCFullYear()}.${String(bj.getUTCMonth() + 1).padStart(2, '0')}.${String(bj.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 比分进程行:优先 stats.scoreBreakdown(sync 落库:半场/90'/加时净分/点球);缺则事件推导兜底。
 * 展示规则:半场恒展示;90分钟只在有加时/点球时展示(否则与终场比分重复);
 * 「加时 X:Y」展示**累计终局比分**(非净分);点球取 breakdown.penalty,缺则 events 推导(shootout)。
 */
function buildProgression(score: TeamScore, stats: Record<string, unknown> | null, shootout: Shootout | null): string | undefined {
  type SB = { halftime?: { home: number; away: number } | null; fulltime?: { home: number; away: number } | null; extratime?: { home: number; away: number } | null; penalty?: { home: number; away: number } | null };
  const sb = (stats?.scoreBreakdown ?? null) as SB | null;
  const pen = sb?.penalty ?? shootout;
  const fmt = (p: { home: number; away: number }) => `${p.home}:${p.away}`;
  const wentBeyond90 = Boolean(sb?.extratime) || Boolean(pen);
  const parts: string[] = [];
  if (sb?.halftime) parts.push(`半场 ${fmt(sb.halftime)}`);
  if (sb?.fulltime && wentBeyond90) parts.push(`90分钟 ${fmt(sb.fulltime)}`);
  if (score.homeScore != null && score.awayScore != null) {
    if (sb?.extratime) parts.push(`加时 ${score.homeScore}:${score.awayScore}`);
    else if (!sb && pen) parts.push(`120分钟 ${score.homeScore}:${score.awayScore}`);
  }
  if (pen) parts.push(`点球 ${fmt(pen)}`);
  return parts.length ? parts.join(' · ') : undefined;
}

function readScore(match: MatchBriefInput): TeamScore {
  if (match.home_team || match.away_team) {
    return {
      home: teamName(match.home_team, '主队'),
      away: teamName(match.away_team, '客队'),
      homeScore: numberOrNull(match.home_score),
      awayScore: numberOrNull(match.away_score),
    };
  }
  const parsed = (match.match || '').match(/^\s*(.+?)\s+(\d+)\s*[:：-]\s*(\d+)\s+(.+?)\s*$/);
  if (!parsed) return { home: '主队', away: '客队', homeScore: null, awayScore: null };
  return { home: teamName(parsed[1], '主队'), homeScore: Number(parsed[2]), awayScore: Number(parsed[3]), away: teamName(parsed[4], '客队') };
}

function winnerName(score: TeamScore): string | null {
  if (score.homeScore === null || score.awayScore === null || score.homeScore === score.awayScore) return null;
  return score.homeScore > score.awayScore ? score.home : score.away;
}

function scoreLine(score: TeamScore): string {
  if (score.homeScore === null || score.awayScore === null) return `${score.home} vs ${score.away}`;
  return `${score.home} ${score.homeScore}:${score.awayScore} ${score.away}`;
}

function mergeStats(matchStats: Record<string, unknown> | null | undefined, styles: Partial<Record<'hardcore' | 'duanzi' | 'emotion', StyleBrief>>) {
  return matchStats ?? styles.hardcore?.stats ?? styles.duanzi?.stats ?? styles.emotion?.stats ?? null;
}

function buildDataPoints(stats: Record<string, unknown> | null, score: TeamScore): MatchBriefCard['data_points'] {
  const points: MatchBriefCard['data_points'] = [];
  const xg = readPair(stats, 'xg');
  const shots = readPair(stats, 'shots');
  const shotsOn = readPair(stats, 'shots_on_target') ?? readPair(stats, 'shots_on');
  const possession = readPair(stats, 'possession');
  // 扩充统计(/fixtures/statistics 富集后才有);xG/射门/射正/控球 优先占满 4 格,缺项时这些补位。
  const corners = readPair(stats, 'corners');
  const passAcc = readPair(stats, 'pass_accuracy');
  const fouls = readPair(stats, 'fouls');
  const offsides = readPair(stats, 'offsides');
  const saves = readPair(stats, 'saves');
  if (xg) points.push({ label: 'xG', value: pairText(xg), note: xg.home === xg.away ? '机会质量接近' : `${xg.home > xg.away ? score.home : score.away}更接近高质量机会` });
  if (shots) points.push({ label: '射门', value: pairText(shots), note: shots.home === shots.away ? '出手机会接近' : `${shots.home > shots.away ? score.home : score.away}制造了更多尝试` });
  if (shotsOn) points.push({ label: '射正', value: pairText(shotsOn), note: shotsOn.home === shotsOn.away ? '门前效率接近' : `${shotsOn.home > shotsOn.away ? score.home : score.away}更常打到门框范围` });
  if (possession) points.push({ label: '控球', value: `${possession.home}:${possession.away}`, note: possession.home === possession.away ? '控球基本均衡' : `${possession.home > possession.away ? score.home : score.away}掌握更多球权` });
  if (corners) points.push({ label: '角球', value: pairText(corners), note: leadNote(corners, score, '更多', '接近') });
  if (passAcc) points.push({ label: '传球%', value: pairText(passAcc), note: leadNote(passAcc, score, '更稳', '接近') });
  if (fouls) points.push({ label: '犯规', value: pairText(fouls), note: leadNote(fouls, score, '更多', '接近') });
  if (offsides) points.push({ label: '越位', value: pairText(offsides), note: leadNote(offsides, score, '更多', '接近') });
  if (saves) points.push({ label: '扑救', value: pairText(saves), note: leadNote(saves, score, '更多', '接近') });
  if (!points.length) points.push({ label: '比分', value: score.homeScore === null ? '待补充' : `${score.homeScore}:${score.awayScore}`, note: '先用比分和战报结论解释重点' });
  return points.slice(0, 4);
}

/** 短注释:领先方 + 一词(适配数据盒 6 字版面);持平给 even。 */
function leadNote(pair: { home: number; away: number }, score: TeamScore, more: string, even: string): string {
  if (pair.home === pair.away) return even;
  return `${pair.home > pair.away ? score.home : score.away}${more}`;
}

/** matches.events → 统一的关键事件序列,供「关键时间线」与「胜负关键」复用。
 * 含进球(带累计比分)、红牌,以及争议看点:VAR 改判 / 点球射失被扑(用户要求加冲突/争议事件)。 */
type KeyEvent =
  | { kind: 'goal'; minute: number | null; side: 'home' | 'away'; team: string; player: string; assist: string; goalNum: number; penalty: boolean; ownGoal: boolean; homeAfter: number; awayAfter: number }
  | { kind: 'red'; minute: number | null; side: 'home' | 'away'; team: string; player: string }
  | { kind: 'var'; minute: number | null; team: string; text: string }
  | { kind: 'miss'; minute: number | null; side: 'home' | 'away'; team: string; player: string };

const KEY_EVENT_TYPES = new Set(['goal', 'penalty', 'red_card', 'var', 'penalty_missed']);

/** 点球大战比分(战平场次 120' 后的 penalty 事件),与 bracket-data penScore 同规则。无点球大战为 null。 */
type Shootout = { home: number; away: number };

function parseKeyEvents(events: unknown, score: TeamScore): { keyEvents: KeyEvent[]; shootout: Shootout | null } {
  const raw = (Array.isArray(events) ? (events as BriefEvent[]) : [])
    .filter((e) => e && typeof e.type === 'string' && KEY_EVENT_TYPES.has(e.type))
    .map((e) => ({
      minute: numberOrNull(e.minute),
      type: String(e.type),
      team: clean(e.team),
      player: clean(e.player),
      assist: clean(e.assist),
      ownGoal: /乌龙|own\s*goal/i.test(e.description || ''),
      description: clean(e.description),
    }))
    .filter((e) => e.team)
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  // 点球大战逐轮(战平场次 minute>120 的 penalty/penalty_missed)单独归拢:
  // 不进常规时间线/累计比分,只汇成互射比分——与对阵图 penScore 同口径(2026-07-03 对阵图同类 bug 先修,本卡漏改)。
  const drawn = score.homeScore !== null && score.homeScore === score.awayScore;
  const isShootoutKick = (e: { minute: number | null; type: string }) =>
    drawn && e.minute !== null && e.minute > 120 && (e.type === 'penalty' || e.type === 'penalty_missed');
  let shootout: Shootout | null = null;
  if (drawn) {
    let sh = 0;
    let sa = 0;
    let any = false;
    for (const e of raw) {
      if (!isShootoutKick(e)) continue;
      any = true;
      if (e.type !== 'penalty') continue; // 射失不计分
      if (translateTeam(e.team) === score.home) sh += 1;
      else sa += 1;
    }
    if (any) shootout = { home: sh, away: sa };
  }

  // 累计比分遍历全部进球算;VAR/射失不计分。同球员进球数 → 梅开二度/帽子戏法。
  let home = 0;
  let away = 0;
  const goalCount = new Map<string, number>();
  const out: KeyEvent[] = [];
  for (const e of raw) {
    if (isShootoutKick(e)) continue;
    const teamZh = translateTeam(e.team);
    const eventIsHome = teamZh === score.home;
    if (e.type === 'red_card') {
      out.push({ kind: 'red', minute: e.minute, side: eventIsHome ? 'home' : 'away', team: teamZh, player: e.player });
      continue;
    }
    if (e.type === 'var') {
      out.push({ kind: 'var', minute: e.minute, team: teamZh, text: e.description || 'VAR 介入改判' });
      continue;
    }
    if (e.type === 'penalty_missed') {
      out.push({ kind: 'miss', minute: e.minute, side: eventIsHome ? 'home' : 'away', team: teamZh, player: e.player });
      continue;
    }
    // 乌龙球事件上游(API-Football)team=受益方(实测 fixture 1565178:team=Australia,player=埃及后卫 M. Hany),
    // 直接按事件 team 记分;此前按"记给对方"再翻转一次 → 双重翻转,55' 乌龙误显 0:2(应为 1:1)。
    if (eventIsHome) home += 1;
    else away += 1;
    // 乌龙球不计入射手的"第几球"(受益方名义,不该让本人背帽子戏法)
    const goalNum = e.ownGoal || !e.player ? 0 : (goalCount.set(`${teamZh}|${e.player}`, (goalCount.get(`${teamZh}|${e.player}`) ?? 0) + 1), goalCount.get(`${teamZh}|${e.player}`)!);
    out.push({ kind: 'goal', minute: e.minute, side: eventIsHome ? 'home' : 'away', team: teamZh, player: e.player, assist: e.assist, goalNum, penalty: e.type === 'penalty', ownGoal: e.ownGoal, homeAfter: home, awayAfter: away });
  }
  return { keyEvents: out, shootout };
}

/**
 * 关键时间线:用真实事件(进球带累计比分、红牌),旧版只塞 1 个合成镜头致单行(用户报修)。
 * 无事件退回镜头兜底,绝不空行。渲染上限 4 行:超 4 个时红牌/点球必留 + 取较晚进球补满,再按时间排序。
 */
function buildTimeline(
  keyEvents: KeyEvent[],
  fallbackMoments: HighlightMoment[],
  shootout: Shootout | null = null,
  penWinner: string | null = null,
): MatchBriefCard['timeline'] {
  // 点球大战汇成一行收尾(逐轮不进时间线),常规事件让出一个位。
  const shootoutRow = shootout && penWinner
    ? { minute: '点球大战', text: `互射 ${shootout.home}:${shootout.away}，${penWinner}晋级` }
    : null;
  const cap = shootoutRow ? 3 : 4;
  if (!keyEvents.length) {
    const fallback = fallbackMoments.slice(0, cap).map((moment) => ({ minute: moment.minute, text: moment.title }));
    if (shootoutRow) return [...fallback, shootoutRow];
    return fallback.length ? fallback : [{ minute: '赛后', text: '等待补充关键事件后生成完整时间线' }];
  }
  // kind=key 的是争议/冲突看点(红牌/点球/VAR/射失),超限时必留;开放进球(goal)填剩余位。
  const rows = keyEvents.map((e) => {
    const minute = e.minute != null ? `第${e.minute}分钟` : '关键时刻';
    if (e.kind === 'red') return { minute, text: formatRedCard(e.team, e.player), kind: 'key' as const, order: e.minute ?? 999 };
    if (e.kind === 'var') return { minute, text: `${e.team} · ${e.text}`, kind: 'key' as const, order: e.minute ?? 999 };
    if (e.kind === 'miss') return { minute, text: formatMissedPenalty(e.team, e.player), kind: 'key' as const, order: e.minute ?? 999 };
    return { minute, text: formatGoal(e.team, e.player, e.assist, e.goalNum, e.penalty, e.ownGoal, `${e.homeAfter}:${e.awayAfter}`), kind: e.penalty ? 'key' as const : 'goal' as const, order: e.minute ?? 999 };
  });
  const picked = rows.length <= cap
    ? rows
    : (() => {
        const mustKeep = rows.filter((r) => r.kind === 'key');
        const goals = rows.filter((r) => r.kind === 'goal');
        const fill = Math.max(0, cap - mustKeep.length);
        return [...mustKeep, ...goals.slice(-fill)].sort((a, b) => a.order - b.order).slice(0, cap);
      })();
  const trimmed = picked.map(({ minute, text }) => ({ minute, text }));
  return shootoutRow ? [...trimmed, shootoutRow] : trimmed;
}

// 不用 emoji:渲染器只装了 NotoSansSC(无 emoji 字体),⚽/🟥 会渲成豆腐块。
// 进球靠「队·人 + 累计比分」自明,点球/乌龙/红牌用中文词区分。
// 球员只取姓(末段)+ 字体安全转写,见 player-name.ts(时间线行宽有限,全名会被拦腰切断)。

/** 同球员多球的关键球员看点。 */
function goalFeat(goalNum: number): string {
  if (goalNum === 2) return '梅开二度';
  if (goalNum === 3) return '帽子戏法';
  if (goalNum >= 4) return '大四喜';
  return '';
}

/** 时间线行宽按字符数算(渲染截断 22 字,Latin 不算半宽),故助攻"放得下才带"。 */
function fits(text: string): boolean {
  return [...text].length <= 22;
}

function formatGoal(team: string, player: string, assist: string, goalNum: number, penalty: boolean, ownGoal: boolean, scoreText: string): string {
  const name = shortPlayer(player);
  // ① 梅开二度/帽子戏法:球员主视角高亮(关键球员的关键事)
  const feat = goalFeat(goalNum);
  if (feat && name) return `${name} ${feat} ${scoreText}`;
  // ② 助攻者(关键球员):优先带队名,放不下退回球员主视角,再放不下退回基础——始终保比分完整
  const assistName = !penalty && !ownGoal ? shortPlayer(assist) : '';
  if (assistName && name) {
    const withTeam = `${team} · ${name}（${assistName} 助）${scoreText}`;
    if (fits(withTeam)) return withTeam;
    const noTeam = `${name}（${assistName} 助）${scoreText}`;
    if (fits(noTeam)) return noTeam;
  }
  // ③ 基础:队名 · 进球者(点球/乌龙标注)
  const who = name ? ` · ${name}` : '';
  const tag = penalty ? ' 点球' : ownGoal ? ' 乌龙' : '';
  return `${team}${who}${tag} ${scoreText}`.replace(/\s+/g, ' ').trim();
}

function formatRedCard(team: string, player: string): string {
  const name = shortPlayer(player);
  const who = name ? ` · ${name}` : '';
  return `${team}${who} 红牌`;
}

function formatMissedPenalty(team: string, player: string): string {
  const name = shortPlayer(player);
  const who = name ? ` · ${name}` : '';
  return `${team}${who} 点球射失`;
}

/** 全场最佳(MOTM)说明行,读 stats.players.motm(球员评分数据源)。无则空串。 */
function motmCaption(stats: Record<string, unknown> | null | undefined): string {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return '';
  const motm = (stats as { players?: { motm?: { name?: string; team?: string; rating?: number | null } } }).players?.motm;
  if (!motm || !motm.name || motm.rating == null) return '';
  const name = shortPlayer(motm.name);
  const team = motm.team ? translateTeam(motm.team) : '';
  const rating = Number(motm.rating).toFixed(1); // 统一一位小数(7→7.0),与卡内其它数值风格一致
  return `全场最佳 ${name} · ${rating}${team ? `（${team}）` : ''}`;
}

/**
 * 代表镜头标题:按本场特征生成,突出各自看点(避免全是「XXX把比分写进镜头」)。
 * 优先级:点球大战 > 读秒绝杀 > 落后逆转 > 点球制胜 > VAR 改写 > 大胜 > 零封 > 进球者制胜 > 锁定胜局。
 * 控制 ≤14 字以适配镜头面板;无进球(0:0)或纯平局返回 null 走兜底。
 */
function highlightLensTitle(keyEvents: KeyEvent[], score: TeamScore, winner: string | null, shootout: Shootout | null = null): string | null {
  // 点球大战场次:常规时间战平,「制胜球/锁定胜局」全不成立,直接定调。
  if (shootout) return '点球大战一锤定音';
  const goals = keyEvents.filter((e): e is Extract<KeyEvent, { kind: 'goal' }> => e.kind === 'goal');
  if (!goals.length) return null;
  const winnerSide = sideOf(winner, score);
  // 平局(无点球大战)没有"制胜球"可言 → 走兜底镜头标题(此前把最后一个进球者安成制胜球,1:1 乌龙也中招)。
  if (!winnerSide) return keyEvents.some((e) => e.kind === 'var') ? 'VAR 介入的一战' : null;
  const margin = score.homeScore != null && score.awayScore != null ? Math.abs(score.homeScore - score.awayScore) : 0;
  const lead = (g: Extract<KeyEvent, { kind: 'goal' }>) => (winnerSide === 'home' ? g.homeAfter - g.awayAfter : g.awayAfter - g.homeAfter);
  const decisive = [...goals].reverse().find((g) => g.side === winnerSide) ?? goals[goals.length - 1]!;
  const scorer = shortPlayer(decisive.player);

  if (margin === 1 && decisive.minute != null && decisive.minute >= 85) return `第${decisive.minute}分钟读秒绝杀`;
  if (goals.some((g) => lead(g) < 0)) return '落后逆转的制胜球';
  if (margin === 1 && decisive.penalty) return '点球一锤定音';
  if (margin >= 3) return `${winner} ${margin} 球大胜`; // 大胜优先于 VAR:VAR 改写不了一场大胜
  if (keyEvents.some((e) => e.kind === 'var')) return 'VAR 介入的一战';
  if (score.homeScore === 0 || score.awayScore === 0) return '零封对手的一击';
  if (scorer) return `${scorer} 的制胜球`;
  return `${decisive.team}锁定胜局`;
}

type KeyReason = { title: string; evidence: string };
type GoalEvent = Extract<KeyEvent, { kind: 'goal' }>;

/**
 * 胜负关键:三条都讲"为什么赢"——① 决定性事件(events)② 效率胜负手(stats,与「数据证据」不重复,讲反差/转化)
 * ③ 过程走势(running score)。标题即结论、随每场比赛变。数据不足时各自降级到模板 why,**不放情绪**
 * (情绪在「一句话摘要」与「分享金句」里已有承载)。
 */
function buildKeyReasons(input: {
  score: TeamScore;
  winner: string | null;
  regulationWinner: string | null;
  shootout: Shootout | null;
  keyEvents: KeyEvent[];
  stats: Record<string, unknown> | null;
  dataPoints: MatchBriefCard['data_points'];
  styles: Partial<Record<'hardcore' | 'duanzi' | 'emotion', StyleBrief>>;
  summary: string;
}): KeyReason[] {
  const { score, winner, regulationWinner, shootout, keyEvents, stats, dataPoints, styles, summary } = input;
  const hardcoreLead = clean(styles.hardcore?.lead);
  const hasStat = Boolean(dataPoints[0] && dataPoints[0].label !== '比分');
  // ① 点球大战本身就是决定性事件;②③ 按常规时间战平口径叙事(控球占优却未能取胜/反复扳平),
  // 不能把互射胜者当"比分优势守到终场"的赢家。
  const shootoutReason: KeyReason | null = shootout && winner
    ? { title: `点球大战 ${shootout.home}:${shootout.away}，${winner}晋级`, evidence: `${scoreLine(score)}拉锯到 120 分钟，互射分出晋级名额。` }
    : null;
  return [
    shootoutReason ?? decisiveEventReason(keyEvents, score, winner) ?? {
      title: winner ? `${winner}把比分优势守到终场` : '双方把悬念留到终场前后',
      evidence: clean(styles.duanzi?.share_quote) || summary,
    },
    efficiencyReason(stats, score, shootout ? regulationWinner : winner) ?? {
      title: hasStat ? '数据上分出高下' : '战术执行决定走势',
      evidence: hasStat
        ? `${dataPoints[0]!.label} ${dataPoints[0]!.value}，${dataPoints[0]!.note}`
        : hardcoreLead || '把回合质量转化成结果的一方掌握了主动。',
    },
    processReason(keyEvents, score, shootout ? regulationWinner : winner) ?? {
      title: '临场与节奏决定走势',
      evidence: hardcoreLead || '谁先把节奏、效率和关键回合串起来，谁就掌握了胜负。',
    },
  ];
}

function sideOf(name: string | null, score: TeamScore): 'home' | 'away' | null {
  if (!name) return null;
  return name === score.home ? 'home' : name === score.away ? 'away' : null;
}

/** ① 决定性事件:红牌(优先输球方) > 读秒绝杀 > 点球决胜 > 半场前锁定。全部基于真实事件,不编造。 */
function decisiveEventReason(keyEvents: KeyEvent[], score: TeamScore, winner: string | null): KeyReason | null {
  if (!keyEvents.length) return null;
  const goals = keyEvents.filter((e): e is GoalEvent => e.kind === 'goal');
  const reds = keyEvents.filter((e): e is Extract<KeyEvent, { kind: 'red' }> => e.kind === 'red');
  const winnerSide = sideOf(winner, score);
  const loserSide = winnerSide ? (winnerSide === 'home' ? 'away' : 'home') : null;
  const margin = score.homeScore != null && score.awayScore != null ? Math.abs(score.homeScore - score.awayScore) : null;
  const minLabel = (m: number | null) => (m != null ? `第${m}分钟` : '');

  const red = (loserSide && reds.find((r) => r.side === loserSide)) || reds[0];
  if (red) {
    if (loserSide && red.side === loserSide) {
      return { title: `${red.team}${minLabel(red.minute)}染红，少打一人失势`, evidence: `${red.team}少一人后被针对，攻防失衡，最终告负。` };
    }
    if (winnerSide && red.side === winnerSide) {
      return { title: `${red.team}少打一人仍守住胜果`, evidence: `${red.team}染红后顶住压力拿下比赛，含金量更高。` };
    }
  }

  const last = goals[goals.length - 1];
  if (winnerSide && margin === 1 && last && last.side === winnerSide && last.minute != null && last.minute >= 85) {
    return { title: `${last.team}第${last.minute}分钟读秒绝杀`, evidence: '末段一击致命，把三分硬生生抢了下来。' };
  }

  const winnerPen = winnerSide ? goals.find((g) => g.penalty && g.side === winnerSide) : undefined;
  if (winner && margin === 1 && winnerPen) {
    return { title: `${minLabel(winnerPen.minute)}点球成胜负手`, evidence: '一粒点球，决定了一球小胜的分量。' };
  }

  if (winnerSide) {
    const half = goals.filter((g) => g.minute != null && g.minute <= 45);
    const lastHalf = half[half.length - 1];
    if (lastHalf) {
      const lead = winnerSide === 'home' ? lastHalf.homeAfter - lastHalf.awayAfter : lastHalf.awayAfter - lastHalf.homeAfter;
      if (lead >= 2) return { title: `${winner}半场前就锁定胜局`, evidence: '上半场拉开两球差距，全场掌握主动。' };
    }
  }
  return null;
}

/** ② 效率胜负手:讲"控球/机会质量与结果的反差",与「数据证据」堆原始数据不重复。 */
function efficiencyReason(stats: Record<string, unknown> | null, score: TeamScore, winner: string | null): KeyReason | null {
  const possession = readPair(stats, 'possession');
  const shotsOn = readPair(stats, 'shots_on_target') ?? readPair(stats, 'shots_on');
  const xg = readPair(stats, 'xg');
  const winnerSide = sideOf(winner, score);
  const pick = (p: { home: number; away: number }, side: 'home' | 'away') => (side === 'home' ? p.home : p.away);

  if (!winner) {
    if (possession && possession.home !== possession.away) {
      const more = possession.home > possession.away ? score.home : score.away;
      return { title: `${more}掌控球权却未能取胜`, evidence: `控球 ${possession.home}:${possession.away}，优势没能转化成胜势。` };
    }
    return null;
  }
  if (!winnerSide) return null;
  const loserSide = winnerSide === 'home' ? 'away' : 'home';
  const loser = loserSide === 'home' ? score.home : score.away;

  if (possession && pick(possession, loserSide) > pick(possession, winnerSide)) {
    const extra = shotsOn ? `，射正 ${shotsOn.home}:${shotsOn.away}` : '';
    return { title: `${loser}控球占优却效率告负`, evidence: `${loser}控球 ${pick(possession, loserSide)}%${extra}，机会质量被${winner}反超。` };
  }
  if (xg && pick(xg, winnerSide) < pick(xg, loserSide)) {
    return { title: `${winner}机会质量不占优却赢球`, evidence: `xG ${xg.home}:${xg.away}，${winner}把握机会更狠。` };
  }
  if (shotsOn && pick(shotsOn, winnerSide) > pick(shotsOn, loserSide)) {
    return { title: `${winner}门前效率更高拿下比赛`, evidence: `射正 ${shotsOn.home}:${shotsOn.away}，${winner}打门更致命。` };
  }
  return null;
}

/** ③ 过程走势:逆转 / 先发制人守住 / 平局拉锯,从累计比分轨迹判定。 */
function processReason(keyEvents: KeyEvent[], score: TeamScore, winner: string | null): KeyReason | null {
  const goals = keyEvents.filter((e): e is GoalEvent => e.kind === 'goal');
  if (goals.length < 2) return null;
  const winnerSide = sideOf(winner, score);
  if (winner && winnerSide) {
    const loser = winnerSide === 'home' ? score.away : score.home;
    const lead = (g: GoalEvent) => (winnerSide === 'home' ? g.homeAfter - g.awayAfter : g.awayAfter - g.homeAfter);
    if (goals.some((g) => lead(g) < 0)) {
      return { title: `${winner}落后后完成逆转`, evidence: `一度被${loser}带着走，终场前把比分扳回并反超。` };
    }
    // 先发制人:率先破门后领先从未被抹平(全程 lead ≥1)。被扳平又赢下的情形交给 ①(读秒绝杀),此处不重复。
    if (goals.every((g) => lead(g) >= 1)) {
      return { title: `${winner}先发制人守住胜果`, evidence: '率先破门后始终掌握主动，守住领先到终场。' };
    }
    return null;
  }
  return { title: '双方你来我往战成平局', evidence: '比分被反复扳平，谁都没能把优势变成胜势。' };
}

function readPair(stats: Record<string, unknown> | null, key: string): { home: number; away: number } | null {
  const value = stats?.[key];
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/([\d.]+)\s*[:：-]\s*([\d.]+)/);
    return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const home = numberOrNull(record.home);
  const away = numberOrNull(record.away);
  if (home === null || away === null) return null;
  return { home, away };
}

function pairText(pair: { home: number; away: number }): string {
  return `${formatNumber(pair.home)}:${formatNumber(pair.away)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value: string | null | undefined): string {
  return (value || '').trim();
}

/**
 * 合规:把 DB 赛事名里的境外赛事商标词替换为中性"国际大赛"(F67h)。
 * check:trademark 只扫代码,DB 原值(API-Football 来源)含商标词会绕过检查、渲进用户卡片。
 * 在数据层统一清洗,所有卡片(brief/tactics/分享卡)赛事名一致合规。
 */
export function sanitizeCompetition(raw: string | null | undefined): string {
  return (raw || '')
    // 带限定词的赛事全名先整体脱敏(否则下面通用赛事名规则只换中间词,留下 "Club"/"Women's" 孤儿)
    .replace(/\b(?:fifa\s+)?(?:club|women'?s|men'?s|youth|u-?\d+)\s+world\s*cup\b/gi, '国际大赛') // trademark-allowed
    .replace(/world\s*cup/gi, '国际大赛') // trademark-allowed
    .replace(/\bfifa\b/gi, '') // trademark-allowed
    .replace(/世界杯/g, '国际大赛') // trademark-allowed
    // 赛段/轮次英文→中文(数据源给的是 "Group Stage - 3" / "Round of 32" 等);具名组合先于裸词
    .replace(/group\s*stage\s*[-–]\s*(\d+)/gi, '小组赛第$1轮')
    .replace(/group\s*(?:stage|phase)/gi, '小组赛')
    .replace(/\bgroup\s+([a-l])\b/gi, '$1组') // 裸组字母 "Group A" → "A组"(stage/phase 已在上面消化,不会误吃)
    .replace(/matchday\s*(\d+)/gi, '第$1轮') // "Matchday 3" → "第3轮"
    .replace(/qualif(?:ication|ier|iers|ying|y)/gi, '预选赛') // Qualification/Qualifier(s)/Qualifying
    .replace(/round\s*of\s*32/gi, '32强赛')
    .replace(/round\s*of\s*16/gi, '16强赛')
    .replace(/quarter[-\s]*finals?/gi, '1/4决赛')
    .replace(/semi[-\s]*finals?/gi, '半决赛')
    .replace(/(?:3rd|third)[-\s]*place(?:\s*(?:play[-\s]*off|final))?/gi, '三四名决赛')
    .replace(/final\s+round/gi, '决赛轮') // 具名组合,先于裸 final,避免 "Final Round" 被吃成 "决赛 Round"
    // 裸词只译**单数** "Final"(数据源轮次词);不译复数 "Finals",否则会把赛事名 "Global/Nations League Finals" 误译。
    .replace(/\bfinal\b/gi, '决赛')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s[-–]\s/g, ' · ') // 残留的 " - " 分隔统一成 " · "
    .replace(/^[\s·•\-—]+|[\s·•\-—]+$/g, '')
    .trim();
}

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function teamName(value: string | null | undefined, fallback: string): string {
  const raw = (value || '').trim();
  return raw ? translateTeam(raw) : fallback;
}
