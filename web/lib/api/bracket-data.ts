/**
 * 淘汰赛对阵图数据装配:固定 bracket 骨架(32 队·新华社双向树结构 + 排期日期)+ matches 表实时结果覆盖
 * + 晋级方自动上浮(已完赛 R32 的胜者填进对应 16 强槽,逐层向决赛传播)。
 *
 * 为什么 bracket 结构要写死:matches 表无「轮次槽位/种子位」字段,无法从数据推出谁在树的哪个位置;
 * R32 对阵在抽签后即固定(本结构 = 当前赛事 R32 抽签结果),后续轮次靠拓扑(下方 FEED)从胜者推。
 * 比分/状态/点球全部来自 matches 表(实时);抽签若变,改 R32_SLOTS 即可。
 */

export interface RawMatch {
  date: string;
  tag: string;
  home?: string; // 英文原名;undefined = 待定
  away?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  penHome?: number | null;
  penAway?: number | null;
  status: 'finished' | 'scheduled' | 'tbd' | 'half';
}
export interface RawBracket {
  topR32: RawMatch[]; top16: RawMatch[]; top8: RawMatch[]; topSF: RawMatch[];
  final: RawMatch[]; third: RawMatch[];
  botSF: RawMatch[]; bot8: RawMatch[]; bot16: RawMatch[]; botR32: RawMatch[];
}

/** R32 槽位(渲染顺序:topR32[0..7] 上半区 col0-3 上排 + col0-3 下排;botR32[0..7] 下半区)。英文队名对来自抽签。
 *  date 仅作兜底(DB 缺该场时用);正常每场都从 matches.match_date 取北京时间,故此处也按北京时间填。 */
const R32_SLOTS: { home: string; away: string; date: string }[] = [
  { home: 'Germany', away: 'Paraguay', date: '6/30 04:30' },
  { home: 'South Africa', away: 'Canada', date: '6/29 03:00' },
  { home: 'Portugal', away: 'Croatia', date: '7/3 07:00' },
  { home: 'USA', away: 'Bosnia & Herzegovina', date: '7/2 08:00' },
  { home: 'France', away: 'Sweden', date: '7/1 05:00' },
  { home: 'Netherlands', away: 'Morocco', date: '6/30 09:00' },
  { home: 'Spain', away: 'Austria', date: '7/3 03:00' },
  { home: 'Belgium', away: 'Senegal', date: '7/2 04:00' },
  { home: 'Brazil', away: 'Japan', date: '6/30 01:00' },
  { home: 'Mexico', away: 'Ecuador', date: '7/1 09:00' },
  { home: 'Argentina', away: 'Cape Verde Islands', date: '7/4 06:00' },
  { home: 'Switzerland', away: 'Algeria', date: '7/3 11:00' },
  { home: 'Ivory Coast', away: 'Norway', date: '7/1 01:00' },
  { home: 'England', away: 'Congo DR', date: '7/2 00:00' },
  { home: 'Australia', away: 'Egypt', date: '7/4 02:00' },
  { home: 'Colombia', away: 'Ghana', date: '7/4 09:30' },
];
// 后续轮次排期(槽位 → 日期),队伍靠胜者上浮 / DB 覆盖
const D16 = ['7/5 05:00', '7/5 01:00', '7/7 03:00', '7/7 08:00', '7/6 04:00', '7/6 08:00', '7/8 00:00', '7/8 04:00']; // top0-3, bot0-3
const D8 = ['7/10 04:00', '7/11 03:00', '7/12 05:00', '7/12 09:00']; // topQF0-1, botQF0-1
const DSF = ['7/15 03:00', '7/16 03:00']; // topSF, botSF
const DFINAL = '7/20 03:00', DTHIRD = '7/19 05:00';

/** matches 表行(只取对阵图需要的列) */
export interface BracketDbRow {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  match_date: string | null; // timestamptz(UTC)→ 北京时间 = +8h
  events: { type?: string | null; team?: string | null; minute?: number | null }[] | null;
  stats?: { apiFootball?: { round?: string | null } | null } | null;
}

const norm = (s: string) => s.trim().toLowerCase();
const pairKey = (a: string, b: string) => [norm(a), norm(b)].sort().join('|');

/** matches.match_date(UTC timestamptz)→ 北京时间 "M/D HH:MM";无效返空。 */
export function beijingShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000); // 下用 getUTC* 取北京墙钟
  return `${bj.getUTCMonth() + 1}/${bj.getUTCDate()} ${String(bj.getUTCHours()).padStart(2, '0')}:${String(bj.getUTCMinutes()).padStart(2, '0')}`;
}

/** 从 events 数**点球大战**比分(type==='penalty' 且 120' 后)分主客。无点球大战返回 [null,null]。
 *  ⚠️只有常规+加时战平的场次才计(战平必然进点球大战):运动战点球(68' 判点、加时补时 125' 点球)
 *  也记作 type='penalty',不过滤会把 2:1 的场次误显示成"2(1)/1(0)",且 winner 判定(peh??hs)可能上浮错队
 *  ——2026-07-03 用户在对阵图上发现(葡萄牙/比利时两格)。分钟过滤挡"战平场里的运动战点球"边角。 */
function penScore(row: BracketDbRow): [number | null, number | null] {
  if (row.home_score == null || row.away_score == null || row.home_score !== row.away_score) return [null, null];
  const evs = Array.isArray(row.events) ? row.events : [];
  const pens = evs.filter((e) => e?.type === 'penalty' && typeof e.minute === 'number' && e.minute > 120);
  if (pens.length === 0) return [null, null];
  let h = 0, a = 0;
  for (const e of pens) { if (norm(e.team || '') === norm(row.home_team)) h++; else if (norm(e.team || '') === norm(row.away_team)) a++; }
  return [h, a];
}

interface Result { homeScore: number | null; awayScore: number | null; penHome: number | null; penAway: number | null; status: 'finished' | 'scheduled'; winner?: string; loser?: string; date: string }
/** 查某对阵的结果(队序无关);finished 时给出胜者英文名;date=该场北京时间。无 DB 记录 → undefined。 */
function lookup(map: Map<string, BracketDbRow>, home: string, away: string): Result | undefined {
  const row = map.get(pairKey(home, away));
  if (!row) return undefined;
  const finished = (row.status || '') === 'finished';
  const homeOrient = norm(row.home_team) === norm(home); // DB 主客是否与槽位同序
  const [ph, pa] = penScore(row);
  // 以槽位的 home/away 视角对齐比分
  const hs = homeOrient ? row.home_score : row.away_score;
  const as = homeOrient ? row.away_score : row.home_score;
  const peh = homeOrient ? ph : pa;
  const pea = homeOrient ? pa : ph;
  let winner: string | undefined, loser: string | undefined;
  if (finished) {
    const hv = (peh ?? hs ?? 0), av = (pea ?? as ?? 0);
    winner = hv > av ? home : away; loser = hv > av ? away : home;
  }
  return { homeScore: hs ?? null, awayScore: as ?? null, penHome: peh, penAway: pea, status: finished ? 'finished' : 'scheduled', winner, loser, date: beijingShort(row.match_date) };
}

/** 组一场:给定 home/away(可 undefined)+ 兜底 date + tag,叠加 DB 结果(日期优先取 DB 的真实北京时间)。 */
function build(map: Map<string, BracketDbRow>, home: string | undefined, away: string | undefined, date: string, tag: string): RawMatch {
  if (!home && !away) return { date, tag, status: 'tbd' };
  if (home && away) {
    const r = lookup(map, home, away);
    if (r) return { date: r.date || date, tag, home, away, homeScore: r.homeScore, awayScore: r.awayScore, penHome: r.penHome, penAway: r.penAway, status: r.status };
    return { date, tag, home, away, status: 'scheduled' };
  }
  return { date, tag, home, away, status: 'half' }; // 只有一方已定
}

/** 取某对阵的胜者(已完赛)用于上浮;未完赛 → undefined。 */
function winnerOf(map: Map<string, BracketDbRow>, home?: string, away?: string): string | undefined {
  if (!home || !away) return undefined;
  return lookup(map, home, away)?.winner;
}

export function assembleBracket(rows: BracketDbRow[]): RawBracket {
  const map = new Map<string, BracketDbRow>();
  for (const r of rows) if (r.home_team && r.away_team) map.set(pairKey(r.home_team, r.away_team), r);

  // R32(16 槽)
  const r32 = R32_SLOTS.map((s) => build(map, s.home, s.away, s.date, '1/16决赛'));
  const winR32 = R32_SLOTS.map((s) => winnerOf(map, s.home, s.away));
  // R16(8 槽):top col c = winR32[c] vs winR32[c+4];bot col c = winR32[8+c] vs winR32[12+c]
  const r16home: (string | undefined)[] = [winR32[0], winR32[1], winR32[2], winR32[3], winR32[8], winR32[9], winR32[10], winR32[11]];
  const r16away: (string | undefined)[] = [winR32[4], winR32[5], winR32[6], winR32[7], winR32[12], winR32[13], winR32[14], winR32[15]];
  const r16 = r16home.map((h, i) => build(map, h, r16away[i], D16[i]!, '1/8决赛'));
  const winR16 = r16home.map((h, i) => winnerOf(map, h, r16away[i]));
  // QF(4 槽):top0 = winR16[0] vs winR16[1]; top1 = winR16[2] vs winR16[3]; bot0 = [4]vs[5]; bot1 = [6]vs[7]
  const qfh = [winR16[0], winR16[2], winR16[4], winR16[6]], qfa = [winR16[1], winR16[3], winR16[5], winR16[7]];
  const qf = qfh.map((h, i) => build(map, h, qfa[i], D8[i]!, '1/4决赛'));
  const winQF = qfh.map((h, i) => winnerOf(map, h, qfa[i]));
  // SF(2 槽):top = winQF[0] vs winQF[1]; bot = winQF[2] vs winQF[3]
  const sfh = [winQF[0], winQF[2]], sfa = [winQF[1], winQF[3]];
  const sf = sfh.map((h, i) => build(map, h, sfa[i], DSF[i]!, '半决赛'));
  const winSF = sfh.map((h, i) => winnerOf(map, h, sfa[i]));
  const loseSF = sfh.map((h, i) => { const r = lookup(map, h || '', sfa[i] || ''); return r?.loser; });
  // 决赛 / 季军赛
  const final = build(map, winSF[0], winSF[1], DFINAL, '决赛');
  const third = build(map, loseSF[0], loseSF[1], DTHIRD, '季军赛');

  return {
    topR32: r32.slice(0, 8), botR32: r32.slice(8, 16),
    top16: r16.slice(0, 4), bot16: r16.slice(4, 8),
    top8: qf.slice(0, 2), bot8: qf.slice(2, 4),
    topSF: [sf[0]!], botSF: [sf[1]!],
    final: [final], third: [third],
  };
}
