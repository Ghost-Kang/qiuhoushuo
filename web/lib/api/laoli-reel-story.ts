/**
 * 老李 reel 旁白「讲故事」升级(2026-07-06 founder 反馈:每场解说骨架雷同、口头禅堆砌,
 * 罚丢点球/双响这类戏剧点反而被 38 字 clamp 剪没了)。
 *
 * 流程:确定性抽「戏剧点」(罚丢点球/梅开二度/绝杀/红牌/VAR/数据反差/MOTM)→ 已备案 LLM
 * 按老李人设把 1-2 个戏剧点讲成有起伏的 4 段口播(JSON)→ 红线清洗 + 数字防编造校验
 * (旁白里出现的每个数字必须来自事实清单)→ 任一环节失败返回 null,调用方回退确定性
 * 模板(buildLaoliReelScript),管线永不因 LLM 断片。
 *
 * 2026-07-08「赛后判卷」改版(GROWTH-ROOTCAUSE §2 RC5/§4 D2):12-15s、判卷四拍——
 * ①爆点结果(intro)②转折+老李态度(event)③一个核心数据(data)④确定性结尾钩子(outro,
 * buildEndingHook:有真实下一场对阵=预测悬念「老李押XX,明晚见分晓」/无=关注承诺)。
 */
import { z } from 'zod';
import { backupProvidersFor, callLLM, defaultProvider } from '../llm';
import { lookupPlayerZh } from '../api-football/player-names-zh';
import {
  sanitizeLaoliVideoText,
  clampBannerHook,
  parseTeams,
  containsExtremeTerm,
  validateSpokenScene,
  LAOLI_SPOKEN_TEXT_RE,
  type LaoliReelScript,
  type LaoliReelScene,
  type LaoliReelFourBeatKind,
  type LaoliReelArcKind,
  type LaoliReelImage,
  type LaoliVideoReport,
} from './laoli-video-script';
import {
  classifyMatchClock,
  detectOvertime,
  toChineseInteger,
  arabicNumberToSpoken,
  percentToSpoken,
  ratioToSpoken,
} from './laoli-reel-clock';
import type { MatchData, MatchPlayerLine, ReportStyle } from '../prompts';

/** 每段口播的字数预算(字幕条自适应字号后放得下)。
 *  2026-07-06 founder「更深入更有戏剧性」→ event 62→72;
 *  2026-07-08 抖音完播复盘(5s完播40%·平均只看1/3·2s跳出28.5%)→ 压时长求完播:总量 ~206→~154 字 ≈ ~21s;
 *  2026-07-08 二轮(GROWTH-ROOTCAUSE §2 RC5/§4 D2)「赛后判卷」:完播 6.2% 卡分发、粉丝 0 卡关注理由 →
 *  再压到 **12-15s、一条只讲一个判断**。字数推算沿用实测口径 154字≈21s(≈7.3字/s)→ 12-15s ≈ 88-110 字:
 *  intro18 + event34 + data30 + outro18(确定性结尾钩子 11-17 字)= 上限 100 字 ≈ 13.6s。
 *  「前3秒炸开」纪律保留(intro 第一拍直接砸爆点);outro 不再吃 LLM 余味,走 buildEndingHook 固定钩子。 */
export const SCENE_BUDGET: Record<LaoliReelFourBeatKind, number> = { intro: 18, event: 34, data: 30, outro: 18 };
/** 话题模式(跨场专题)沿用改版前预算,不受单场 12-15s 判卷压缩影响。 */
const TOPIC_SCENE_BUDGET: Record<LaoliReelFourBeatKind, number> = { intro: 34, event: 50, data: 36, outro: 34 };
const SCENE_IMAGE: Record<LaoliReelFourBeatKind, LaoliReelImage> = { intro: 'brief', event: 'highlight', data: 'ratings', outro: 'brief' };
// 🔴 2026-07-08:抖音判定「微信搜超帧球后说」= 引导脱离平台至风险不可控渠道(减少推荐处罚)。
//    站外视频(抖音/视频号)旁白**一律不出现微信/搜/小程序/外链导流**,改成站内 CTA(关注)。
//    视频号的小程序导流走平台自带「挂载」功能,不靠旁白;抖音靠关注。见 memory project_share_card_qr。
const OUTRO_CTA = '关注老李';
/** 结尾钩子 b 分支:无真实下一场信息 → 关注承诺(RC5:粉丝 0 卡「关注理由」,给出不关注=错过下一集的理由)。
 *  2026-07-13 §25b 复盘落地:抖音押球=涨粉发动机,默认 CTA 从泛泛追更升级成「连载兑现钩」——
 *  把关注理由(押球/评分每场兑现)嵌进每条高曝光战报/前瞻/金靴片,不只放在低曝光的连载条。 */
const FOLLOW_HOOK = `${OUTRO_CTA},押球评分每场兑现,别错过`;

/** 下一场对阵信息(结尾预测悬念钩子的唯一事实来源——必须来自真实赛程/晋级形势,严禁猜测)。 */
export interface LaoliNextMatch {
  home: string;
  away: string;
  /** 老李押的一方(可选);必须是 home/away 之一,否则视为编造被忽略 */
  pick?: string;
  /** 开赛时间口语词(缺省「明晚」——淘汰赛日更节奏;非次日场次由调用方传真实口径如「周六晚」) */
  when?: string;
}

/**
 * 结尾固定钩子(判卷第四拍·确定性生成,不走 LLM):
 * a) 有真实下一场对阵且押得出人 → 预测悬念「老李押XX,明晚见分晓」。押的一方只能来自传入对阵:
 *    显式 pick(且必须在对阵双方内)优先,否则取本场胜者(恰好晋级到该对阵时才押);
 * b) 其余(无下一场/平局且无 pick/胜者与下一场无关)→ 关注承诺「关注老李,淘汰赛每场判一张卷」。
 * 没有真实依据绝不硬押——禁止编造对阵是红线。
 */
export function buildEndingHook(match: MatchData, next?: LaoliNextMatch): string {
  const home = sanitizeLaoliVideoText(next?.home || '');
  const away = sanitizeLaoliVideoText(next?.away || '');
  if (home && away) {
    const pickRaw = sanitizeLaoliVideoText(next?.pick || '');
    const winner = resolveWinner(match);
    const pick = [home, away].includes(pickRaw) ? pickRaw : [home, away].includes(winner) ? winner : '';
    if (pick) return `老李押${pick},${sanitizeLaoliVideoText(next?.when || '') || '明晚'}见分晓`;
  }
  return FOLLOW_HOOK;
}

/**
 * 结尾 CTA 文本:默认站内关注 FOLLOW_HOOK;可被 ctaOverride 覆写(跨promo钩子·如押球导流)。
 * 覆写只过**轻校验**:sanitizeLaoliVideoText + 纯 CJK 字符集(LAOLI_SPOKEN_TEXT_RE)+ 无极限词 + 无平台红线。
 * 刻意**不过数字白名单/证据门**——CTA 是营销句不是事实句(founder 2026-07-12)。任一不过 → 回退 FOLLOW_HOOK。
 */
export function resolveCtaText(ctaOverride?: string): string {
  if (!ctaOverride) return FOLLOW_HOOK;
  const cleaned = sanitizeLaoliVideoText(ctaOverride).trim();
  if (
    cleaned.length > 0 &&
    LAOLI_SPOKEN_TEXT_RE.test(cleaned) &&
    !containsExtremeTerm(cleaned) &&
    !violatesPlatformRedline(cleaned)
  ) {
    return cleaned;
  }
  return FOLLOW_HOOK;
}

/** 本场胜者队名(平局/解析失败返回空——押注依据只认赢下来的事实)。 */
function resolveWinner(match: MatchData): string {
  const m = (match.final_score || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!m) return '';
  const [hs, as] = [Number(m[1]), Number(m[2])];
  if (hs === as) return '';
  const teams = parseTeams(match.match);
  return hs > as ? teams.home : teams.away;
}

const StorySchema = z.object({
  hook: z.string().optional(), // 顶部大标题钩子(抖音版式);缺省时由 title/比分兜底
  intro: z.string().min(6),
  event: z.string().min(10),
  data: z.string().min(8),
  outro: z.string().min(6).optional(), // 判卷四拍后单场不再要 LLM 写结尾;话题模式仍会给
});

const zhName = (raw: string): string => lookupPlayerZh(raw) || raw;
const fmtMinute = (minute: number): string => (minute > 90 ? `90+${minute - 90}分钟` : `${minute}分钟`);

/**
 * 从库事实里抽「戏剧点」清单(按张力排序),中文译名、90+X 分钟口径。
 * 只描述已发生的事实,供 LLM 选材;同时并入数字校验语料。
 */
export function extractDramaBeats(match: MatchData): string[] {
  const beats: string[] = [];
  const events = match.events || [];

  for (const e of events) {
    if (e.type === 'penalty_missed') beats.push(`${fmtMinute(e.minute)},${zhName(e.player)}(${e.team})罚丢点球`);
  }
  // 双响/帽子戏法(goal+penalty 同算进球)
  const goalsByPlayer = new Map<string, { minutes: number[]; team: string; hasPenalty: boolean }>();
  for (const e of events) {
    if (e.type !== 'goal' && e.type !== 'penalty') continue;
    const acc = goalsByPlayer.get(e.player) || { minutes: [], team: e.team, hasPenalty: false };
    acc.minutes.push(e.minute);
    if (e.type === 'penalty') acc.hasPenalty = true;
    goalsByPlayer.set(e.player, acc);
  }
  for (const [player, g] of goalsByPlayer) {
    const mins = g.minutes.map(fmtMinute).join('、');
    if (g.minutes.length >= 3) beats.push(`${zhName(player)}(${g.team})上演帽子戏法(${mins})`);
    else if (g.minutes.length === 2) beats.push(`${zhName(player)}(${g.team})梅开二度(${mins})`);
    else if (g.minutes[0]! > 85) beats.push(`${fmtMinute(g.minutes[0]!)},${zhName(player)}(${g.team})进球,几乎终场才分胜负`);
    else if (g.hasPenalty) beats.push(`${fmtMinute(g.minutes[0]!)},${zhName(player)}(${g.team})点球命中`);
  }
  for (const e of events) {
    if (e.type === 'red_card') beats.push(`${fmtMinute(e.minute)},${zhName(e.player)}(${e.team})被红牌罚下`);
    if (e.type === 'var') beats.push(`${fmtMinute(e.minute)},VAR 介入判罚`);
  }
  // 数据反差:占优一方没赢(争议/戏剧的数据面)
  const scoreMatch = (match.final_score || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (scoreMatch) {
    const [hs, as] = [Number(scoreMatch[1]), Number(scoreMatch[2])];
    const winner = hs > as ? 'home' : as > hs ? 'away' : null;
    const edges: string[] = [];
    const check = (label: string, pair?: { home: number; away: number }) => {
      if (!pair || !winner) return;
      const loserSide = winner === 'home' ? 'away' : 'home';
      if (pair[loserSide] > pair[winner]) edges.push(label);
    };
    check('控球', match.stats.possession);
    check('射门', match.stats.shots);
    check('xG机会质量', match.stats.xg);
    if (edges.length) beats.push(`数据反差:输球一方反而${edges.join('、')}占优——效率决定了胜负`);
  }
  const motm = resolveMotm(match); // 显式求最高评分(修「取第一个有评分的球员」旧 bug),优先 stats.players.motm
  if (motm) beats.push(`全场MOTM:${zhName(motm.name)}(${motm.team}),评分${motm.rating}`);
  beats.push(...extractNarrativeThreads(match));
  return beats;
}

/**
 * MOTM 解析（显式求最高评分，非「第一个有评分的球员」）：
 * 优先 stats.players.motm（player-stats.ts 已按出场时长挑最高评分）→ 次 stats.players.home/away 最高评分
 * → 兜底 key_players 最高评分。生产 matchRowToMatchData 不填 key_players，MOTM 权威源在 stats.players。
 */
export function resolveMotm(match: MatchData): { name: string; team: string; rating: number } | null {
  const players = match.stats.players;
  if (players?.motm && players.motm.rating != null && players.motm.name) {
    return { name: players.motm.name, team: players.motm.team ?? '', rating: players.motm.rating };
  }
  const teams = parseTeams(match.match);
  const pooled = [
    ...(players?.home ?? []).map((p) => ({ p, team: teams.home })),
    ...(players?.away ?? []).map((p) => ({ p, team: teams.away })),
  ].filter((x) => x.p.rating != null);
  if (pooled.length) {
    const top = pooled.sort((a, b) => (b.p.rating ?? 0) - (a.p.rating ?? 0))[0]!;
    return { name: top.p.name, team: top.p.team ?? top.team, rating: top.p.rating! };
  }
  const kp = (match.key_players ?? [])
    .filter((p) => p.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  return kp?.rating != null ? { name: kp.name, team: kp.team, rating: kp.rating } : null;
}

/**
 * 叙事线索:把「轮回/反差/讽刺」拼成现成的故事钩子,LLM 优先讲透其中一条
 * (2026-07-06 founder 二轮反馈:旁白要更深入、更有戏剧性,不能蜻蜓点水)。
 */
export function extractNarrativeThreads(match: MatchData): string[] {
  const threads: string[] = [];
  const events = match.events || [];
  const missed = events.filter((e) => e.type === 'penalty_missed');
  const scoredPens = events.filter((e) => e.type === 'penalty');
  if (missed.length && scoredPens.length) {
    const m = missed[0]!;
    const p = scoredPens[scoredPens.length - 1]!;
    const sameTeamLate = m.team === p.team && p.minute >= 88;
    threads.push(
      `叙事线索·点球轮回:${fmtMinute(m.minute)}${zhName(m.player)}罚丢点球,${fmtMinute(p.minute)}${zhName(p.player)}才把点球罚进` +
      (sameTeamLate ? '——同一支队,拖到补时才还上这笔账' : '——这场球被点球开了头,又被点球收了尾'),
    );
  }
  const goalsAll = events
    .filter((e) => e.type === 'goal' || e.type === 'penalty')
    .sort((a, b) => a.minute - b.minute);
  if (goalsAll.length && goalsAll[0]!.minute >= 70) {
    threads.push(`叙事线索·憋局:前${goalsAll[0]!.minute - 1}分钟一球没有,窗户纸到${fmtMinute(goalsAll[0]!.minute)}才被${zhName(goalsAll[0]!.player)}捅破`);
  }
  // 双响且两球同一助攻人:一条线喂出来的
  const byPlayer = new Map<string, Array<(typeof events)[number]>>();
  for (const e of goalsAll) byPlayer.set(e.player, [...(byPlayer.get(e.player) || []), e]);
  for (const [player, list] of byPlayer) {
    if (list.length < 2) continue;
    const assists = [...new Set(list.map((e) => e.assist).filter(Boolean))];
    if (assists.length === 1 && list.every((e) => e.assist)) {
      threads.push(`叙事线索·一条线:${zhName(player)}的${list.length}个球,全是${zhName(assists[0]!)}助攻喂出来的`);
    }
  }
  return threads;
}

/** 事实清单(prompt 输入 + 数字校验语料的同一来源,保证「可说的数字」封闭)。 */
export function buildFactsBlock(match: MatchData, reports: Partial<Record<ReportStyle, LaoliVideoReport>>): string {
  const lines: string[] = [
    `对阵与比分:${match.match},终场 ${match.final_score}${match.halftime_score ? `,半场 ${match.halftime_score}` : ''}`,
  ];
  const beats = extractDramaBeats(match);
  if (beats.length) lines.push(`戏剧点清单(按张力排序):\n- ${beats.join('\n- ')}`);
  const st: string[] = [];
  if (match.stats.possession) st.push(`控球${match.stats.possession.home}%比${match.stats.possession.away}%`);
  if (match.stats.shots) st.push(`射门${match.stats.shots.home}比${match.stats.shots.away}`);
  if (match.stats.shots_on_target) st.push(`射正${match.stats.shots_on_target.home}比${match.stats.shots_on_target.away}`);
  if (match.stats.xg) st.push(`xG ${match.stats.xg.home}比${match.stats.xg.away}`);
  if (st.length) lines.push(`数据面:${st.join(',')}`);
  const quote = reports.duanzi?.share_quote || reports.hardcore?.share_quote;
  if (quote) lines.push(`战报金句(可化用,不必照抄):${quote}`);
  return lines.join('\n');
}

/** 数字防编造:旁白中的每个数字 token 必须与事实清单里的数字 token 精确匹配
 *  (集合匹配而非子串,防「93」蹭「1.93」、「10」蹭「100」这类漏网)。 */
export function narrationNumbersAllowed(text: string, factsBlob: string): boolean {
  const factTokens = new Set(factsBlob.match(/\d+(?:\.\d+)?/g) || []);
  const nums = text.match(/\d+(?:\.\d+)?/g) || [];
  return nums.every((n) => factTokens.has(n));
}

export interface StoryScriptOptions {
  matchId?: string;
  /** 测试注入;不传用真 callLLM(生产) */
  llm?: typeof callLLM;
  /** 真实下一场对阵(赛程/晋级形势数据)→ 结尾走预测悬念钩子;不传=关注承诺钩子 */
  nextMatch?: LaoliNextMatch;
}

/**
 * LLM 故事化 4 段口播;任何失败(开关关/无key/超时/解析失败/数字越界)→ null,由调用方回退模板。
 */
export async function buildLaoliReelStoryScript(
  match: MatchData,
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>,
  options: StoryScriptOptions = {},
): Promise<LaoliReelScript | null> {
  if (process.env.LAOLI_REEL_STORY === '0') return null;
  const llm = options.llm;
  if (!llm && !process.env.DOUBAO_API_KEY && !process.env.DEEPSEEK_API_KEY) return null; // 测试/本地无 key:秒回退,不打网络

  const facts = buildFactsBlock(match, reports);
  const system = [
    '你是「老李」,北方老球迷大爷,在短视频里做「赛后判卷」——不是念完整战报,是给这场球判一张卷:全片 12-15 秒,一条只讲一个判断。短句、有节奏、有烟火气,可带北方腔(嚯/得嘞/坏了/你猜怎么着),每场开头必须不重样,不许堆口头禅。',
    '判卷四拍(必须严格按拍走,整条片只服务这一个判断):',
    '1. 第一拍·爆点结果(intro):第一句直接砸出那个绝杀/罚失点球/惊天反差的瞬间,前 3 秒必须炸开;禁止铺垫、禁止慢热感叹、禁止用比分或「这场比赛」开头——抖音前 2 秒就走人,开头不炸全片白搭;',
    '2. 第二拍·转折(event):一句话讲清这场球在哪儿拐的弯,并亮出老李的态度(谁被高估了/这锅该谁背/谁的评分冤不冤),一句话点死;观点可以犀利,但禁止辱骂球员、禁止说裁判「黑哨/被操纵」、禁止阴谋论;',
    '3. 第三拍·核心数据(data):只允许一个数据论据(一组数字对比,如一组控球或一组xG),禁止堆第二个数据;这个数字必须佐证第二拍的判断,末尾落一个能让评论区吵起来的短设问;',
    '4. 第四拍·结尾钩子:系统固定接管,你不用写、也不许写任何收尾/导流/关注/预测句;',
    '严禁面面俱到讲全场:进球流水账、双方各项数据、替补表现……凡是跟这一个判断无关的信息全砍掉,宁可少说——完播比信息完整重要。',
    '铁律:只用给定事实,禁止编造任何数字/人名/事件;不预测下一场;不出现「最/第一/绝对/必/史上」;金靴话题禁说「少赛」;不提博彩/赔率。',
    '数字铁律:数字一律照抄事实清单里的阿拉伯数字原样(如「控球33%比67%」「xG 1.93比0.73」),禁止自己换算成「几成/几倍/多几个」这类相对说法;谁多谁少必须与事实一致,拿不准就照抄原句。',
    '严格输出 JSON,四个字段都是文本(不要 outro 字段):',
    `   hook(≤12字·务必短到能一行放下,宁缺毋滥):顶部大标题钩子,短促有冲击力、抓人眼球(如「绝杀!10人翻11人」「点球开局点球收尾」),做视频顶部大字,可不含队名比分,但必须抓人;`,
    `   intro(≤16字):第一拍·爆点一句;`,
    `   event(≤32字):第二拍·转折+老李态度一句;`,
    `   data(≤28字):第三拍·一个数据+短设问;`,
  ].join('\n');

  try {
    const result = await (llm || callLLM)({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `本场事实清单如下,请输出 JSON:\n${facts}` },
      ],
      temperature: 0.85,
      maxTokens: 600,
      responseFormat: 'json',
      caller: 'laoli-reel-story',
      // 豆包 seed 系带思考,45s 曾实测超时被 abort(2026-07-06 巴挪场)→ 90s + 备胎链
      timeoutMs: 90_000,
      fallback: backupProvidersFor(defaultProvider()),
    });
    const parsed = StorySchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) return null;

    const kinds: LaoliReelFourBeatKind[] = ['intro', 'event', 'data', 'outro'];
    const raw = parsed.data;
    const endingHook = buildEndingHook(match, options.nextMatch); // 第四拍:确定性钩子,不吃 LLM 余味
    const scenes: LaoliReelScene[] = [];
    for (const kind of kinds) {
      const text = kind === 'outro'
        ? endingHook
        : clampToBudget(sanitizeLaoliVideoText(raw[kind]), SCENE_BUDGET[kind]);
      if (text.length < 6) return null;
      scenes.push({ kind, image: SCENE_IMAGE[kind], narration: text, subtitle: text, approxSec: Math.max(4, Math.round(text.length / 4.5)) });
    }
    // 数字防编造:比对除 outro CTA 外的全部旁白
    const spoken = scenes.filter((s) => s.kind !== 'outro').map((s) => s.narration).join('');
    if (!narrationNumbersAllowed(spoken, facts)) return null;
    // 中文量词换算(几成/几倍)=模型自己算的相对数,方向易错且逃过数字 token 校验
    // (2026-07-06 实测:「巴西控球多六成」——实际33%,方向全反)→ 一律拒绝回退
    if (/[一二两三四五六七八九十百\d]\s*(成|倍)/.test(spoken)) return null;

    return {
      version: 'laoli-reel-v1',
      width: 1080,
      height: 1920,
      watermark: 'AI生成内容',
      title: sanitizeLaoliVideoText(`${match.match} · 老李赛后说`),
      matchId: options.matchId,
      hook: clampBannerHook(raw.hook || match.match), // LLM 钩子优先;缺省用「队 比分 队」兜底
      scenes,
    };
  } catch {
    return null;
  }
}

// ============================================================
// 六拍变长争议弧(NARRATION-REDESIGN Phase 1·单场默认)
// 「确定性定争议脊柱 + LLM 只填肉」:代码先算好角度/加时/证据,LLM 只把选定角度写成有起伏的叙事。
// ============================================================

/** 争议角度类型谱系(spec §0.4)。 */
export type AngleKind =
  | 'losing_goalkeeper_motm'
  | 'zero_goals_top_rating'
  | 'dominant_but_dragged_to_extra_time'
  | 'red_card_changed_course'
  | 'golden_boot_leader_blank'
  | 'one_man_show'
  | 'brace'
  | 'hat_trick'
  | 'late_winner'
  | 'penalty_cycle'
  | 'data_reversal'
  | 'efficiency';

export interface ReelFact {
  id: string;
  /** 已规范成纯中文口播形式(数字全中文)。 */
  text: string;
  /** 该 fact 允许口播的中文数字词组(逐字复制的白名单来源)。 */
  spokenNumberTokens: string[];
}

export interface ReelTimingLabel {
  eventId: string;
  /** 确定性生成,如「加时一百一十二分钟」。 */
  label: string;
  phase: '常规时间' | '补时' | '加时' | '点球大战';
}

export interface NarrativeAngle {
  id: AngleKind;
  thesis: string;
  openingQuestion: string;
  evidenceIds: string[];
  score: number;
}

export interface ReelFactsEnvelope {
  facts: ReelFact[];
  timingLabels: ReelTimingLabel[];
  selectedAngle: { id: AngleKind; thesis: string; openingQuestion: string; evidenceIds: string[] };
  allowedSpokenNumbers: string[];
  /** 跨场去重状态(phase-2 才持久化;v1 默认空)。 */
  recentAngleIds: AngleKind[];
  recentOpeningFingerprints: string[];
}

/** 赛事上下文(金靴榜等;当前 MatchData 无此数据,缺省则相关角度严禁触发)。 */
export interface TournamentContext {
  goldenBootTable?: Array<{ name: string; goals: number; playedMatchIds?: string[] }>;
}

/** 跨场近期历史(去重惩罚用;v1 默认空)。 */
export interface RecentReelHistory {
  angleIds: AngleKind[];
  openingFingerprints: string[];
}

// ---- 中文数字防编造(canon 中文·不得放松)----

const CJK_NUM_CLASS = '零〇一二两三四五六七八九十百千万';
const CJK_DIGIT_CLASS = '零〇一二两三四五六七八九';
const NUM_CORE_SRC =
  `(?:百分之)?[${CJK_NUM_CLASS}]+(?:点[${CJK_DIGIT_CLASS}]+)?(?:比(?:百分之)?[${CJK_NUM_CLASS}]+(?:点[${CJK_DIGIT_CLASS}]+)?)?`;
// 只对「铁定是数字」的表达做精确匹配:小数/比值/百分数(点/比/百分之),或整数紧跟强统计量词
// (球/助攻/射门/射正)。刻意不收 分/分钟/个/次/人 等——「十分精彩」「一个球」「两次」等成语里的数字字
// 若被当口播数字校验,会把正常口语整句误拒。时间数字由「时间口径」逐字复制单独把关,不靠这里。
const NUM_STRONG_UNIT_SRC = '球|助攻|射门|射正';

const normalizeSpokenNum = (s: string): string => s.replace(/两/g, '二').replace(/〇/g, '零');

/**
 * 提取旁白里可精确校验的中文数字表达核:含 点/比/百分之 = 一定是数字;或整数紧跟强统计量词
 * (球/助攻/射门/射正)。避免「一个/两次/十分/第一时间」等成语里的数字字被误当口播数字而误拒。
 */
export function extractSpokenNumbers(text: string): string[] {
  const re = new RegExp(NUM_CORE_SRC, 'g');
  const strongUnitRe = new RegExp(`^(?:${NUM_STRONG_UNIT_SRC})`);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const core = m[0];
    if (!core) { re.lastIndex += 1; continue; }
    const explicitNumeric = /点|比|百分之/.test(core);
    const rest = text.slice(re.lastIndex);
    if (explicitNumeric || strongUnitRe.test(rest)) out.push(normalizeSpokenNum(core));
  }
  return out;
}

/** 中文数字精确集合匹配:旁白里每个数字表达都必须在白名单里(逐字复制,越界即拒)。 */
export function spokenNumbersAllowed(text: string, allowed: Set<string> | string[]): boolean {
  const set = allowed instanceof Set ? allowed : new Set(allowed.map(normalizeSpokenNum));
  return extractSpokenNumbers(text).every((t) => set.has(normalizeSpokenNum(t)));
}

/** 「成/倍」相对数一律拒(方向易错且逃过 token 校验)。 */
export function containsRelativeMagnitude(text: string): boolean {
  return /[零〇一二两三四五六七八九十百千万几多半]\s*[成倍]/.test(text);
}

/** 平台红线(外链/博彩/黑哨/阴谋):站外视频与 caption 共用。 */
const PLATFORM_REDLINE_RE =
  /微信|搜一搜|搜索|小程序|二维码|链接|网址|公众号|赔率|盘口|大小球|买球|下注|博彩|黑哨|假球|操纵|阴谋/;

export function violatesPlatformRedline(text: string): boolean {
  return PLATFORM_REDLINE_RE.test(text);
}

// ---- 事实信封构造 ----

function parseFinalScore(match: MatchData): { home: number; away: number } | null {
  const m = (match.final_score || match.match || '').match(/(\d+)\s*[:\-：]\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

type Side = 'home' | 'away';
const opposite = (s: Side): Side => (s === 'home' ? 'away' : 'home');

function resolveWinnerSide(match: MatchData): Side | null {
  const s = parseFinalScore(match);
  if (!s) return null;
  if (s.home > s.away) return 'home';
  if (s.away > s.home) return 'away';
  const pen = match.stats.scoreBreakdown?.penalty ?? null;
  if (pen) return pen.home > pen.away ? 'home' : pen.away > pen.home ? 'away' : null;
  return null;
}

interface RatedPlayer {
  name: string;
  side: Side;
  team: string;
  rating: number;
  goals: number;
  assists: number;
  position: string;
}

function ratedPlayers(match: MatchData): RatedPlayer[] {
  const teams = parseTeams(match.match);
  const players = match.stats.players;
  const collect = (list: MatchPlayerLine[] | undefined, side: Side): RatedPlayer[] =>
    (list ?? [])
      .filter((p) => p.rating != null)
      .map((p) => ({
        name: zhName(p.name), // 译名(生产 matchRowToMatchData 已译，这里再兜一道)
        side,
        team: p.team ?? (side === 'home' ? teams.home : teams.away),
        rating: p.rating!,
        goals: p.goals ?? 0,
        assists: p.assists ?? 0,
        position: p.position ?? '',
      }));
  return [...collect(players?.home, 'home'), ...collect(players?.away, 'away')].sort(
    (a, b) => b.rating - a.rating,
  );
}

const isGoalkeeper = (pos: string): boolean => pos === '门将' || pos.toUpperCase() === 'G';

function eventSide(match: MatchData, teamName: string): Side | null {
  const teams = parseTeams(match.match);
  if (teamName === teams.home) return 'home';
  if (teamName === teams.away) return 'away';
  return null;
}

/** 某侧在 [minLt) 之前(或全场)已进球数(goal/penalty 计)。 */
function goalsBy(match: MatchData, side: Side, beforeMinute?: number): number {
  return (match.events || []).filter((e) => {
    if (e.type !== 'goal' && e.type !== 'penalty') return false;
    if (beforeMinute != null && e.minute >= beforeMinute) return false;
    return eventSide(match, e.team) === side;
  }).length;
}

/**
 * 争议角度自动识别(Codex selectNarrativeAngle,读 stats.players 的 position/goals/rating,
 * MOTM 显式求最高评分)。证据不足时 buildSafeResultAngle 兜底,不硬造争议。
 */
export function selectNarrativeAngle(
  match: MatchData,
  tournament?: TournamentContext,
  recent?: RecentReelHistory,
): NarrativeAngle {
  const winner = resolveWinnerSide(match);
  const loser = winner ? opposite(winner) : null;
  const ratings = ratedPlayers(match);
  const topRating = ratings[0]?.rating;
  const topRated = topRating != null ? ratings.filter((p) => p.rating === topRating) : [];
  const score = parseFinalScore(match);
  const candidates: NarrativeAngle[] = [];

  // 一、输球方门将拿评分王
  for (const p of topRated) {
    if (winner && p.side === loser && isGoalkeeper(p.position)) {
      candidates.push({
        id: 'losing_goalkeeper_motm',
        thesis: `${p.name}输了球却拿到全场评分王`,
        openingQuestion: `赢球的没拿评分王,输球的门将凭啥全场头名?`,
        evidenceIds: [],
        score: 100,
      });
    }
  }

  // 二、零进球却拿最高分(唯一或并列最高 + 至少一次助攻)
  for (const p of topRated) {
    if (p.goals === 0 && p.assists >= 1) {
      candidates.push({
        id: 'zero_goals_top_rating',
        thesis: `${p.name}没有进球却拿到全场评分王`,
        openingQuestion: `${p.name}一个球没进,凭啥拿全场头名?`,
        evidenceIds: [],
        score: 98,
      });
    }
  }

  // 三、占优方只险胜,而且被拖进加时
  if (winner && detectOvertime(match) && score && Math.abs(score.home - score.away) === 1) {
    const ft = match.stats.scoreBreakdown?.fulltime ?? null;
    const levelAt90 = ft ? ft.home === ft.away : false;
    if (levelAt90 && isDominant(match, winner)) {
      const teams = parseTeams(match.match);
      candidates.push({
        id: 'dominant_but_dragged_to_extra_time',
        thesis: `${winner === 'home' ? teams.home : teams.away}场面占优却被拖进加时才险胜`,
        openingQuestion: `占着场面的一方,凭啥被拖到加时才分出胜负?`,
        evidenceIds: [],
        score: 92,
      });
    }
  }

  // 四、红牌改变走势
  for (const red of (match.events || []).filter((e) => e.type === 'red_card')) {
    const sentOff = eventSide(match, red.team);
    if (!sentOff) continue;
    const other = opposite(sentOff);
    const beforeLevel = goalsBy(match, sentOff, red.minute) === goalsBy(match, other, red.minute);
    const beforeLeaderSentOff = goalsBy(match, sentOff, red.minute) > goalsBy(match, other, red.minute);
    const otherScoredAfter = goalsBy(match, other) > goalsBy(match, other, red.minute);
    const changedCourse =
      (beforeLevel && winner === other) ||
      (beforeLeaderSentOff && winner !== sentOff) ||
      otherScoredAfter;
    if (changedCourse) {
      candidates.push({
        id: 'red_card_changed_course',
        thesis: '这张红牌是不是比赛转折点',
        openingQuestion: '这张红牌一亮,比赛就变了脸——它到底是不是转折点?',
        evidenceIds: [],
        score: red.description?.includes('视频裁判') ? 96 : 88,
      });
    }
  }

  // 五、金靴领跑者本场没进(缺 tournament 上下文严禁触发)
  if (tournament?.goldenBootTable && tournament.goldenBootTable.length) {
    const leadGoals = Math.max(...tournament.goldenBootTable.map((p) => p.goals));
    for (const p of tournament.goldenBootTable) {
      const appeared = !p.playedMatchIds || p.playedMatchIds.includes(match.match);
      const scoredThisMatch = (match.events || []).some(
        (e) => (e.type === 'goal' || e.type === 'penalty') && zhName(e.player) === zhName(p.name),
      );
      if (p.goals === leadGoals && appeared && !scoredThisMatch) {
        candidates.push({
          id: 'golden_boot_leader_blank',
          thesis: `${zhName(p.name)}领跑射手榜却在这场没有进球`,
          openingQuestion: `${zhName(p.name)}领跑射手榜,这场怎么哑火了?`,
          evidenceIds: [],
          score: 84,
        });
      }
    }
  }

  // 六、常规候选(双响/帽子戏法/绝杀/点球轮回/数据反差)
  candidates.push(...buildConventionalCandidates(match, winner));

  // 跨场去重:近五条同角度扣分,近三条相似开头再扣分。
  const recentIds = recent?.angleIds ?? [];
  const recentFps = recent?.openingFingerprints ?? [];
  for (const c of candidates) {
    c.score -= recentIds.slice(-5).filter((id) => id === c.id).length * 20;
    const fp = c.openingQuestion.slice(0, 6);
    c.score -= recentFps.slice(-3).includes(fp) ? 15 : 0;
  }

  return candidates.sort((a, b) => b.score - a.score)[0] ?? buildSafeResultAngle(match, winner);
}

function isDominant(match: MatchData, winner: Side): boolean {
  const loser = opposite(winner);
  const poss = match.stats.possession;
  const shots = match.stats.shots;
  const xg = match.stats.xg;
  if (poss && poss[winner] >= 55) return true;
  if (shots && shots[winner] - shots[loser] >= 5) return true;
  if (xg && xg[winner] - xg[loser] >= 0.7) return true;
  return false;
}

function buildConventionalCandidates(match: MatchData, winner: Side | null): NarrativeAngle[] {
  const out: NarrativeAngle[] = [];
  const events = match.events || [];
  const goalsByPlayer = new Map<string, { n: number; team: string }>();
  const teamGoals = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'goal' && e.type !== 'penalty') continue;
    const acc = goalsByPlayer.get(e.player) ?? { n: 0, team: e.team };
    acc.n += 1;
    goalsByPlayer.set(e.player, acc);
    teamGoals.set(e.team, (teamGoals.get(e.team) ?? 0) + 1);
  }
  for (const [player, g] of goalsByPlayer) {
    if (g.n >= 3) out.push({ id: 'hat_trick', thesis: `${zhName(player)}上演帽子戏法`, openingQuestion: `${zhName(player)}一人三球,对手的后防线去哪儿了?`, evidenceIds: [], score: 78 });
    else if (g.n === 2) out.push({ id: 'brace', thesis: `${zhName(player)}梅开二度`, openingQuestion: `${zhName(player)}一人两球,这队还有别人吗?`, evidenceIds: [], score: 70 });
    // 一人包办全队进球(≥2 球且=全队全部进球):一人扛队,比 brace/late_winner 更强的争议角度
    if (g.n >= 2 && g.n === teamGoals.get(g.team)) {
      out.push({ id: 'one_man_show', thesis: `${zhName(player)}一个人包办了全队进球`, openingQuestion: `${zhName(player)}一人打进全队所有进球,这队是不是就靠他一个?`, evidenceIds: [], score: 90 });
    }
  }
  const lateGoal = [...events].filter((e) => e.type === 'goal' || e.type === 'penalty').sort((a, b) => b.minute - a.minute)[0];
  if (lateGoal && lateGoal.minute >= 85) out.push({ id: 'late_winner', thesis: `${zhName(lateGoal.player)}末段进球`, openingQuestion: `拖到这个点才进球,谁的心脏受得了?`, evidenceIds: [], score: 74 });
  const missed = events.filter((e) => e.type === 'penalty_missed');
  const scoredPen = events.filter((e) => e.type === 'penalty');
  if (missed.length && scoredPen.length) out.push({ id: 'penalty_cycle', thesis: '点球开了头也收了尾', openingQuestion: '一场球被点球开头又被点球收尾,这算不算轮回?', evidenceIds: [], score: 72 });
  if (winner && dataReversal(match, winner)) out.push({ id: 'data_reversal', thesis: '赢球一方数据反被压', openingQuestion: '数据全落下风的一方,凭啥把三分拿走了?', evidenceIds: [], score: 68 });
  return out;
}

function dataReversal(match: MatchData, winner: Side): boolean {
  const loser = opposite(winner);
  const poss = match.stats.possession;
  const shots = match.stats.shots;
  const xg = match.stats.xg;
  return Boolean(
    (poss && poss[loser] > poss[winner]) ||
    (shots && shots[loser] > shots[winner]) ||
    (xg && xg[loser] > xg[winner]),
  );
}

/** 证据不足兜底:只说赛果效率,不硬造争议。 */
function buildSafeResultAngle(match: MatchData, winner: Side | null): NarrativeAngle {
  const teams = parseTeams(match.match);
  const who = winner ? (winner === 'home' ? teams.home : teams.away) : '';
  return {
    id: 'efficiency',
    thesis: who ? `${who}把握机会赢下这场` : '这场球的胜负藏在效率里',
    openingQuestion: who ? `${who}这场赢在哪儿,是场面还是效率?` : '这场球,场面和比分哪个更值?',
    evidenceIds: [],
    score: 40,
  };
}

/**
 * 构造 ReelFactsEnvelope:确定性把阿拉伯事实转成纯中文口播,并生成 allowedSpokenNumbers。
 * 每个 fact 带 id + 纯中文 text + spokenNumberTokens;时间标签由 classifyMatchClock 确定性生成。
 */
export function buildReelFactsEnvelope(
  match: MatchData,
  options: { tournament?: TournamentContext; recent?: RecentReelHistory } = {},
): ReelFactsEnvelope {
  const teams = parseTeams(match.match);
  const facts: ReelFact[] = [];
  const timingLabels: ReelTimingLabel[] = [];
  const allowed = new Set<string>();
  let fid = 0;
  const addFact = (text: string, tokens: string[]): string => {
    fid += 1;
    const id = `f${fid}`;
    const norm = tokens.map(normalizeSpokenNum);
    facts.push({ id, text, spokenNumberTokens: norm });
    for (const t of norm) allowed.add(t);
    return id;
  };
  const scoreTokens = (a: number, b: number): string[] => [toChineseInteger(a), toChineseInteger(b), ratioToSpoken(a, b)];

  // 比分
  const fs = parseFinalScore(match);
  if (fs) addFact(`终场${teams.home}${ratioToSpoken(fs.home, fs.away)}${teams.away}`, scoreTokens(fs.home, fs.away));

  const wentToExtraTime = detectOvertime(match);
  const timing = { statusRaw: match.stats.statusRaw, wentToExtraTime };

  // 事件(进球/点球/罚丢/红牌/VAR)+ 时间标签
  const events = match.events || [];
  events.forEach((e, i) => {
    const clock = classifyMatchClock({ elapsed: e.minute }, timing);
    const eid = `e${i + 1}`;
    let timePrefix = '';
    if (clock) {
      timingLabels.push({ eventId: eid, label: clock.label, phase: clock.phase });
      timePrefix = `${clock.label},`;
      if (clock.numericValue != null) allowed.add(normalizeSpokenNum(toChineseInteger(clock.numericValue)));
    }
    const who = `${zhName(e.player)}（${zhName(e.team)}）`;
    if (e.type === 'goal' || e.type === 'penalty') addFact(`${timePrefix}${who}${e.type === 'penalty' ? '点球命中' : '进球'}`, []);
    else if (e.type === 'penalty_missed') addFact(`${timePrefix}${who}罚丢点球`, []);
    else if (e.type === 'red_card') addFact(`${timePrefix}${who}被红牌罚下`, []);
    else if (e.type === 'var') addFact(`${timePrefix}视频裁判介入判罚`, []);
  });

  // 数据面
  const st = match.stats;
  if (st.possession) addFact(`控球率${percentToSpoken(st.possession.home)}比${percentToSpoken(st.possession.away)}`, [percentToSpoken(st.possession.home), percentToSpoken(st.possession.away), `${percentToSpoken(st.possession.home)}比${percentToSpoken(st.possession.away)}`]);
  if (st.shots) addFact(`射门${ratioToSpoken(st.shots.home, st.shots.away)}`, scoreTokens(st.shots.home, st.shots.away));
  if (st.shots_on_target) addFact(`射正${ratioToSpoken(st.shots_on_target.home, st.shots_on_target.away)}`, scoreTokens(st.shots_on_target.home, st.shots_on_target.away));
  if (st.xg) addFact(`预期进球${arabicNumberToSpoken(String(st.xg.home))}比${arabicNumberToSpoken(String(st.xg.away))}`, [arabicNumberToSpoken(String(st.xg.home)), arabicNumberToSpoken(String(st.xg.away)), `${arabicNumberToSpoken(String(st.xg.home))}比${arabicNumberToSpoken(String(st.xg.away))}`]);

  // MOTM
  const motm = resolveMotm(match);
  if (motm) addFact(`全场评分王${zhName(motm.name)}（${zhName(motm.team)}），评分${arabicNumberToSpoken(String(motm.rating))}`, [arabicNumberToSpoken(String(motm.rating))]);

  const angle = selectNarrativeAngle(match, options.tournament, options.recent);

  return {
    facts,
    timingLabels,
    selectedAngle: { id: angle.id, thesis: angle.thesis, openingQuestion: angle.openingQuestion, evidenceIds: angle.evidenceIds },
    allowedSpokenNumbers: [...allowed],
    recentAngleIds: options.recent?.angleIds ?? [],
    recentOpeningFingerprints: options.recent?.openingFingerprints ?? [],
  };
}

// ---- 六拍弧 LLM 脚本 ----

const ArcSentenceSchema = z.object({ text: z.string().min(1), evidence_ids: z.array(z.string()).default([]) });
const ArcStorySchema = z.object({
  hook: z.string().optional(),
  question: ArcSentenceSchema,
  drama: z.array(ArcSentenceSchema).min(1),
  answer: z.array(ArcSentenceSchema).min(1),
  debate: ArcSentenceSchema,
});

/** 六拍弧 system prompt(Codex 版全文,spec §6.2)。 */
const ARC_SYSTEM_PROMPT = [
  '你是短视频栏目「老李赛后说」的旁白作者。老李是五十岁北方老球迷,懂球、说人话、观点鲜明,但不靠口头禅撑内容。',
  '',
  '你的任务不是压缩一篇完整战报,而是围绕系统已经选定的一个话题角度,写出一条有因果、有升级、有解答、有评论欲望的赛后口播。默认成片约二十八至四十秒,共七至九句,旁白总长度控制在一百二十至一百七十个汉字。前两秒必须让观众听懂反常识点,后面的每一句都必须推进同一个问题。',
  '',
  '用户消息会提供四个区块:',
  '一、选定角度:系统已经确定的主角、核心问题和判断方向。',
  '二、事实清单:每条事实都有唯一编号。',
  '三、时间口径:每个事件已经由系统确定为常规时间、补时、加时或点球大战,并提供唯一可说的中文时间文本。',
  '四、允许数字口播词:旁白中所有数字只能逐字使用这里列出的中文词组。',
  '',
  '必须按以下六拍写作:',
  '',
  '第一拍,反常识钩子。',
  '第一句直接说出观众最想追问的矛盾,可以是设问,也可以是鲜明判断。禁止用「这场比赛」「今天聊聊」「嚯」单独起头。不得先报完整比分。',
  '',
  '第二拍,局面建立。',
  '用一至两句交代主角当时面对的困难,只保留与选定角度直接相关的事实。',
  '',
  '第三拍,戏剧升级。',
  '用两至三句按因果或时间推进。每句必须比上一句增加新的压力、转折或反差,不能写成互不相关的数据清单。',
  '',
  '第四拍,决定性转折。',
  '指出比赛真正改变方向的事件。事件时间只能逐字复制「时间口径」中的文本。你不得根据分钟数自行判断「补时」或「加时」。',
  '',
  '第五拍,证据解答。',
  '用一至两句回答第一拍的问题。允许使用两到三个相互关联的事实,但每个事实都必须直接支撑核心判断。不能用空泛词语代替证据。',
  '',
  '第六拍,争议回扣。',
  '最后一句把核心问题抛回评论区,要求观众站队、判断或解释。可以问「你服吗」「这锅该谁背」「这张红牌是不是转折点」,但不得指控裁判黑哨、操纵或阴谋。不要写关注、导流、下一场预测,系统会另接站内关注句。',
  '',
  '事实铁律:',
  '',
  '一、只能使用事实清单中的人名、球队、事件、结果、评分和数据。',
  '二、每个输出句必须填写 evidence_ids,列出支撑该句的事实编号。没有事实编号支撑的具体陈述不得写。',
  '三、旁白中的每个数字必须逐字来自「允许数字口播词」。不得自行换算、相减、四舍五入或组合出新数字。',
  '四、禁止任何「成」「倍」相对数字表达,包括「多几成」「翻倍」「高出几倍」。不得把百分数改写成成数。',
  '五、时间说法必须逐字复制「时间口径」。不得把加时写成补时,也不得把补时写成加时。',
  '六、若选定角度写的是「红牌改变走势」,只能讨论红牌前后的比赛变化;除非事实清单明确写有视频裁判改判,否则不得声称判罚错误或存在争议判罚。',
  '七、不得补充事实清单中没有的球员位置、射手榜排名、晋级轮次、伤病、历史纪录或下一场对阵。',
  '',
  '文本铁律:',
  '',
  '一、所有可见和可朗读文本只能包含汉字、姓名间隔点和中文基本标点。',
  '二、不得使用阿拉伯数字、英文字母、百分号、井号、项目符号、表情符号、圈号数字或特殊符号。',
  '三、视频裁判写作「视频裁判」,预期进球写作「预期进球」,全场最佳写作「全场评分王」,不得输出英文缩写。',
  '四、不得出现「最」「第一」「绝对」「必」「史上」等极限词。时间中的序数由系统提前规范,模型不得自行加「第」。',
  '五、不得出现微信、搜索、小程序、二维码、链接、网址或任何站外导流。',
  '六、不得出现博彩、赔率、盘口、大小球、买球、下注。',
  '七、不得辱骂球员,不得出现黑哨、操纵、阴谋论,不评价球员私生活。',
  '八、不要堆叠「嚯」「得嘞」「我跟你说」「你猜怎么着」。整条最多使用一个口头语,也可以完全不用。',
  '九、字幕就是旁白原文,不要另写字幕版本。',
  '十、不要写解释、创作说明或代码块。',
  '',
  '严格输出以下 JSON,不得添加其他字段:',
  '{"hook":"顶部大字钩子,十四个汉字以内","question":{"text":"第一拍旁白,一句","evidence_ids":["事实编号"]},"drama":[{"text":"第二至第四拍旁白,每项一句,共三至五项","evidence_ids":["事实编号"]}],"answer":[{"text":"第五拍旁白,每项一句,共一至两项","evidence_ids":["事实编号"]}],"debate":{"text":"第六拍旁白,一句中文问句","evidence_ids":["事实编号"]}}',
].join('\n');

const ARC_IMAGE: Record<LaoliReelArcKind, LaoliReelImage> = {
  question: 'brief',
  setup: 'highlight',
  escalation: 'highlight',
  turn: 'highlight',
  answer: 'ratings',
  debate: 'brief',
  cta: 'brief',
};
/** 每拍口播字数硬上限(超上限=拒→回退,深版不做静默截断)。 */
const ARC_MAX: Record<LaoliReelArcKind, number> = {
  question: 34,
  setup: 40,
  escalation: 40,
  turn: 34,
  answer: 55,
  debate: 30,
  cta: 20,
};

export interface ArcScriptOptions extends StoryScriptOptions {
  tournament?: TournamentContext;
  recent?: RecentReelHistory;
  /** 结尾 CTA 覆写(跨promo钩子·如押球导流):过轻校验(纯CJK+无极限词+无平台红线)才用,否则回退 FOLLOW_HOOK。
   *  轻校验刻意不过数字白名单/证据门——CTA 是营销句非事实句。见 resolveCtaText。 */
  ctaOverride?: string;
}

/** drama 数组 → scene kinds:首=setup,末=turn,中=escalation(仅一项=turn)。 */
function dramaKinds(n: number): LaoliReelArcKind[] {
  if (n <= 1) return ['turn'];
  return ['setup', ...Array(n - 2).fill('escalation') as LaoliReelArcKind[], 'turn'];
}

/**
 * 六拍变长争议弧(单场默认)。确定性定角度/加时/证据白名单,LLM 只把选定角度写成叙事;
 * 任一硬校验失败(证据越界/数字编造/极限词/字符集/加时口径/平台红线/超长/非法 JSON)→ null,由调用方回退四拍/模板。
 */
export async function buildLaoliReelArcScript(
  match: MatchData,
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>,
  options: ArcScriptOptions = {},
): Promise<LaoliReelScript | null> {
  void reports; // 事实源改走 envelope;reports 仅保留签名兼容(hook 兜底可用)
  if (process.env.LAOLI_REEL_STORY === '0' || process.env.LAOLI_REEL_ARC === '0') return null;
  const llm = options.llm;
  if (!llm && !process.env.DOUBAO_API_KEY && !process.env.DEEPSEEK_API_KEY) return null;

  const envelope = buildReelFactsEnvelope(match, { tournament: options.tournament, recent: options.recent });
  if (!envelope.facts.length) return null;
  const factIds = new Set(envelope.facts.map((f) => f.id));
  const allowed = new Set(envelope.allowedSpokenNumbers.map(normalizeSpokenNum));
  const timingPhases = new Set(envelope.timingLabels.map((t) => t.phase));

  const user = [
    '一、选定角度',
    `id:${envelope.selectedAngle.id}`,
    `主角命题:${envelope.selectedAngle.thesis}`,
    `核心问题:${envelope.selectedAngle.openingQuestion}`,
    '',
    '二、事实清单(每条唯一编号,旁白只能用这里的人名/球队/事件/数据)',
    ...envelope.facts.map((f) => `[${f.id}] ${f.text}`),
    '',
    '三、时间口径(事件时间只能逐字复制)',
    ...(envelope.timingLabels.length ? envelope.timingLabels.map((t) => `[${t.eventId}] ${t.label}(${t.phase})`) : ['(无确定时间口径,禁写补时/加时)']),
    '',
    '四、允许数字口播词(旁白所有数字只能逐字用这些)',
    envelope.allowedSpokenNumbers.join('、') || '(无)',
    '',
    '请严格输出 JSON。',
  ].join('\n');

  // 逐句硬校验:证据存在 / 极限词 / 数字白名单 / 成倍 / 加时口径 / 字符集 / 平台红线 / 超长。
  const validate = (text: string, evidenceIds: string[], kind: LaoliReelArcKind): string | null => {
    const t = text.trim();
    // 拒因轻量日志(供真机诊断守卫误杀;重试会换新采样,连挂 3 次才最终失败)。
    const F = (r: string): null => { console.error(`[laoli-arc] reject ${kind}/${r} len=${t.length}`); return null; };
    if (!t) return F('empty');
    if (t.length > ARC_MAX[kind]) return F(`too-long:${t.length}>${ARC_MAX[kind]}`); // 深版不静默截断,超长=拒
    // 证据门:debate(纯争议回扣·呼吁站队,不做事实断言)豁免「非空证据」;其余拍必须引证。
    // 任何拍只要给了 evidence_ids,就必须真实存在(防编造引用)。
    if (kind !== 'debate' && !evidenceIds.length) return F('evidence-empty'); // 事实句缺证据
    if (!evidenceIds.every((id) => factIds.has(id))) return F(`evidence-bad:${evidenceIds.join(',')}`); // 证据越界
    if (!validateSpokenScene(t, t)) return F('charset'); // 字符集:纯 CJK、无阿拉伯/英文/符号
    if (containsExtremeTerm(t)) return F('extreme'); // 极限词(遮蔽合法序数后)
    if (containsRelativeMagnitude(t)) return F('rel-mag'); // 成/倍
    if (!spokenNumbersAllowed(t, allowed)) return F('num-allowlist'); // 中文数字越界
    if (violatesPlatformRedline(t)) return F('platform'); // 外链/博彩/黑哨
    if (t.includes('加时') && !timingPhases.has('加时')) return F('overtime'); // 加时口径一致
    if (t.includes('补时') && !timingPhases.has('补时')) return F('stoppage');
    return t;
  };

  // 一次 LLM 采样 → 解析 → 逐句校验 → 组 scenes+hook。
  //  返回 {scenes,hook}=成功;null=某句挂(可重试换新采样);'llm-dead'=LLM 挂/超时(不重试)。
  const attempt = async (): Promise<{ scenes: LaoliReelScene[]; hook: string } | 'llm-dead' | null> => {
    let raw: z.infer<typeof ArcStorySchema>;
    try {
      const result = await (llm || callLLM)({
        messages: [
          { role: 'system', content: ARC_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        temperature: 0.8,
        maxTokens: 1800,
        responseFormat: 'json',
        caller: 'laoli-reel-arc',
        timeoutMs: 90_000,
        fallback: backupProvidersFor(defaultProvider()),
      });
      const parsed = ArcStorySchema.safeParse(JSON.parse(result.content));
      if (!parsed.success) { console.error(`[laoli-arc] schema-fail angle=${envelope.selectedAngle.id}`); return null; }
      raw = parsed.data;
    } catch {
      return 'llm-dead';
    }

    const scenes: LaoliReelScene[] = [];
    const push = (kind: LaoliReelArcKind, text: string): void => {
      scenes.push({ kind, image: ARC_IMAGE[kind], narration: text, subtitle: text, approxSec: Math.max(3, Math.round(text.length / 4.5)) });
    };
    const q = validate(raw.question.text, raw.question.evidence_ids, 'question');
    if (!q) return null;
    push('question', q);
    const dKinds = dramaKinds(raw.drama.length);
    for (let i = 0; i < raw.drama.length; i += 1) {
      const v = validate(raw.drama[i]!.text, raw.drama[i]!.evidence_ids, dKinds[i]!);
      if (!v) return null;
      push(dKinds[i]!, v);
    }
    for (const a of raw.answer) {
      const v = validate(a.text, a.evidence_ids, 'answer');
      if (!v) return null;
      push('answer', v);
    }
    const d = validate(raw.debate.text, raw.debate.evidence_ids, 'debate');
    if (!d) return null;
    push('debate', d);
    // 系统 CTA:默认纯站内关注(不预测下一场·spec §1 D6);可被 ctaOverride 覆写(押球等跨promo钩子·过轻校验)。
    push('cta', resolveCtaText(options.ctaOverride));
    // 顶部 hook:LLM 钩子过极限词/字符集/红线守卫;不过则用确定性 angle 兜底(不因 hook 拒整条)。
    const rawHook = clampBannerHook(sanitizeLaoliVideoText(raw.hook || ''));
    const hook =
      rawHook && !containsExtremeTerm(rawHook) && !violatesPlatformRedline(rawHook) && LAOLI_SPOKEN_TEXT_RE.test(rawHook)
        ? rawHook
        : clampBannerHook(envelope.selectedAngle.thesis);
    return { scenes, hook };
  };

  // 重试:LLM temp 0.8 单次偶尔产出踩守卫的句子(超长/数字),重试至多 3 次(不放松守卫,只换新采样);
  //  LLM 挂/超时=不重试(避免 3×90s 空等),直接 null 交调用方回退/strict 硬失败。
  let built: { scenes: LaoliReelScene[]; hook: string } | null = null;
  for (let tryN = 0; tryN < 3 && !built; tryN += 1) {
    const r = await attempt();
    if (r === 'llm-dead') return null;
    if (r) built = r;
  }
  if (!built) return null;

  return {
    version: 'laoli-reel-v1',
    width: 1080,
    height: 1920,
    watermark: 'AI生成内容',
    title: sanitizeLaoliVideoText(`${match.match} · 老李赛后说`),
    matchId: options.matchId,
    hook: built.hook,
    scenes: built.scenes,
  };
}

// ===== 话题模式(跨场专题:金靴之争、球星盘点等,非单场比赛)=====

/** 话题版 CTA:站内关注(2026-07-08 去微信导流,同上——抖音禁站外导流)。 */
const TOPIC_OUTRO_CTA_FULL = `想追这条赛道,${OUTRO_CTA}准没错`;

/** 话题 outro:剥掉 LLM 自带导流残句,只留余味,再接固定话题 CTA。 */
export function buildTopicOutroLine(rawOutro: string): string {
  const lead0 = sanitizeLaoliVideoText(rawOutro || '')
    .replace(/[^。！？]*(微信|搜|想看|想追|赛道|详细战报|完整战报|战报)[^。！？]*[。！？]?/g, '')
    .replace(/[，。！？、；：\s]+$/, '')
    .trim();
  const lead = clampToBudget(lead0, Math.max(0, TOPIC_SCENE_BUDGET.outro - TOPIC_OUTRO_CTA_FULL.length - 1));
  return lead ? `${lead}。${TOPIC_OUTRO_CTA_FULL}` : `${TOPIC_OUTRO_CTA_FULL}。`;
}

export interface TopicScriptInput {
  /** 话题标题(封面同款,喂 LLM 定调) */
  title: string;
  /** 事实清单(所有可说的数字/人名都在里面;旁白数字必须来自此)*/
  facts: string;
}

/**
 * 老李「话题口播」4 段脚本(跨场专题):intro 悬念钩子 → event 核心冲突讲透 →
 * data 数字佐证 + 站队设问 → outro 余味 + 导流。复用单场 story 的红线/数字防编造/clamp。
 * 任一环节失败(无 key/超时/解析失败/数字越界/禁词)→ null,调用方回退。
 */
export async function buildLaoliTopicScript(
  input: TopicScriptInput,
  options: StoryScriptOptions = {},
): Promise<LaoliReelScript | null> {
  if (process.env.LAOLI_REEL_STORY === '0') return null;
  const llm = options.llm;
  if (!llm && !process.env.DOUBAO_API_KEY && !process.env.DEEPSEEK_API_KEY) return null;

  const facts = input.facts.trim();
  if (!facts) return null;
  const system = [
    '你是「老李」,北方老球迷大爷,在短视频里做「话题口播」——不是单场赛后,是一个话题/榜单(比如金靴之争、球星盘点)。你是说书人:把话题讲成有主角、有悬念、有争议的一段书,像茶馆单口。短句、有节奏、有烟火气,可带北方腔(嚯/得嘞/你猜怎么着),开头必须是悬念钩子、不重样,不堆口头禅。',
    '讲法(必须做到):',
    '1. intro 悬念钩子:一个问题、一声叹、一个反差瞬间;禁止用「今天聊」「这个话题」「这份榜单」开头;',
    '2. event 把话题的核心冲突讲透:谁跟谁争、凭啥争、反差/悬念在哪,围绕人讲、讲命运讲故事,不是干念名单;',
    '3. data 用给定数字佐证冲突,末尾必须落一个能让评论区吵起来、站队的设问(该给谁?凭啥?服不服?你押谁?);',
    '4. 制造争议但不越线:观点可以犀利,把观众逼到两边站队;但禁止辱骂球员、禁止阴谋论、不提博彩赔率;',
    '铁律:只用给定事实,禁止编造任何数字/人名/事件;不预测结果(可点出「悬念还在」);不出现「最/第一/绝对/史上」。',
    '数字铁律:数字一律照抄事实清单里的阿拉伯数字原样(如「7球」「6球」「2助攻」),禁止换算成「几成/几倍」这类相对说法;谁多谁少必须与事实一致。',
    '严格输出 JSON,五个字段都是文本:',
    '   hook(≤12字·务必短到能一行放下,宁缺毋滥):顶部大标题钩子,短促有冲击力、抓人眼球(如「三人7球金靴悬了」「谁配拿这金靴」),做视频顶部大字,必须抓人;',
    '   intro(≤38字):悬念钩子开场;',
    '   event(≤68字):核心冲突/主角故事,讲透;',
    '   data(≤54字):数字佐证 + 落一个站队设问;',
    `   outro(≤18字):一句有余味的收尾即可,不用写导流词,系统会自动接「${TOPIC_OUTRO_CTA_FULL}」。`,
  ].join('\n');

  try {
    const result = await (llm || callLLM)({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `话题:${input.title}\n事实清单(旁白数字只能用这里的):\n${facts}\n请输出 JSON。` },
      ],
      temperature: 0.85,
      maxTokens: 600,
      responseFormat: 'json',
      caller: 'laoli-topic-story',
      timeoutMs: 90_000,
      fallback: backupProvidersFor(defaultProvider()),
    });
    const parsed = StorySchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) return null;

    const kinds: LaoliReelFourBeatKind[] = ['intro', 'event', 'data', 'outro'];
    const raw = parsed.data;
    const scenes: LaoliReelScene[] = [];
    for (const kind of kinds) {
      const text = kind === 'outro'
        ? buildTopicOutroLine(raw.outro || '')
        : clampToBudget(sanitizeLaoliVideoText(raw[kind]), TOPIC_SCENE_BUDGET[kind]);
      if (text.length < 6) return null;
      // image 字段话题模式不用(话题管线用外部背景图),给合法占位值
      scenes.push({ kind, image: 'brief', narration: text, subtitle: text, approxSec: Math.max(4, Math.round(text.length / 4.5)) });
    }
    const spoken = scenes.filter((s) => s.kind !== 'outro').map((s) => s.narration).join('');
    if (!narrationNumbersAllowed(spoken, facts)) return null;
    // 相对量词换算(几成/几倍/多几倍/半成)方向易错且逃过数字校验 → 一律拒。「几/多/半」也算(比单场版多收几个)。
    if (/[一二两三四五六七八九十百几多半\d]\s*(成|倍)/.test(spoken)) return null;

    return {
      version: 'laoli-reel-v1',
      width: 1080,
      height: 1920,
      watermark: 'AI生成内容',
      title: sanitizeLaoliVideoText(input.title),
      matchId: options.matchId,
      hook: clampBannerHook(raw.hook || input.title), // LLM 钩子优先;缺省用话题标题兜底
      scenes,
    };
  } catch {
    return null;
  }
}

/** 与 clampNarrationToSentence 同思路(句界优先),预算不同所以本地实现。 */
function clampToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
  return lastStop >= 8 ? head.slice(0, lastStop + 1) : `${head.replace(/[，、；：]$/, '')}。`;
}
