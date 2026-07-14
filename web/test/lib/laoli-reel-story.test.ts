import { describe, expect, it } from 'vitest';
import {
  SCENE_BUDGET,
  buildEndingHook,
  buildFactsBlock,
  buildLaoliReelStoryScript,
  buildLaoliReelArcScript,
  resolveCtaText,
  buildReelFactsEnvelope,
  selectNarrativeAngle,
  resolveMotm,
  spokenNumbersAllowed,
  extractSpokenNumbers,
  containsRelativeMagnitude,
  violatesPlatformRedline,
  extractDramaBeats,
  extractNarrativeThreads,
  narrationNumbersAllowed,
  type TournamentContext,
  type AngleKind,
} from '@/lib/api/laoli-reel-story';
import {
  containsLaoliVideoForbiddenTerm,
  containsExtremeTerm,
  validateSpokenScene,
} from '@/lib/api/laoli-video-script';
import type { MatchData } from '@/lib/prompts';
import type { callLLM } from '@/lib/llm';

// 巴挪战真实形态 fixture(2026-07-06:罚丢点球+哈兰德双响+数据反差,founder 反馈的标杆场)
const match = {
  match: '巴西 1:2 挪威',
  competition: '国际大赛',
  date: '2026-07-06',
  final_score: '1-2',
  halftime_score: '0-0',
  events: [
    { minute: 14, type: 'penalty_missed' as const, team: 'Brazil', player: 'Bruno Guimaraes' },
    { minute: 79, type: 'goal' as const, team: 'Norway', player: 'E. Haaland', assist: 'A. Schjelderup' },
    { minute: 90, type: 'goal' as const, team: 'Norway', player: 'E. Haaland', assist: 'A. Schjelderup' },
    { minute: 100, type: 'penalty' as const, team: 'Brazil', player: 'Neymar' },
  ],
  stats: {
    possession: { home: 33, away: 67 },
    shots: { home: 14, away: 9 },
    shots_on_target: { home: 4, away: 5 },
    xg: { home: 1.93, away: 0.73 },
  },
  key_players: [{ name: 'Erling Haaland', team: 'Norway', rating: 9 }],
};
const reports = {
  duanzi: { style: 'duanzi' as const, title: 't', subtitle: 's', lead: 'l', share_quote: '巴西赢了射门数,输了球门坐标' },
};

// 判卷四拍形态的合规 LLM 输出(各段都在新预算内);单场模式已不再要求/消费 outro 字段
const goodStory = {
  hook: '点球开局点球收尾',
  intro: '嚯,巴西开场就罚丢点球了!',
  event: '14分钟吉马良斯把点球罚飞,这场就拐了弯,内马尔来得太迟。',
  data: 'xG 1.93比0.73巴西占优,球呢?',
};
const FOLLOW_HOOK = '关注老李,押球评分每场兑现,别错过';
const fakeLlm = (payload: unknown): typeof callLLM =>
  (async () => ({ content: JSON.stringify(payload), provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } }));

describe('extractDramaBeats / buildFactsBlock', () => {
  it('抽出罚丢点球、梅开二度(90+X 口径)、数据反差、MOTM,球员名走中文译名', () => {
    const beats = extractDramaBeats(match);
    const blob = beats.join('\n');
    expect(blob).toContain('吉马良斯');
    expect(blob).toContain('罚丢点球');
    expect(blob).toContain('哈兰德');
    expect(blob).toContain('梅开二度');
    expect(blob).toContain('90+10分钟'); // 100' → 90+10
    expect(blob).toContain('数据反差');
    expect(blob).toContain('评分9');
  });

  it('叙事线索:点球轮回(同队补时还账)、憋局、双响同一助攻人一条线', () => {
    const threads = extractNarrativeThreads(match);
    const blob = threads.join('\n');
    expect(blob).toContain('点球轮回');
    expect(blob).toContain('拖到补时才还上'); // 巴西罚丢+巴西90+10点球,同队晚点球
    expect(blob).toContain('前78分钟一球没有'); // 首球79'→憋局线索
    expect(blob).toContain('哈兰德的2个球,全是舍尔德鲁普助攻');
  });

  it('事实清单含比分/数据面/金句,是数字校验的同源语料', () => {
    const facts = buildFactsBlock(match, reports);
    expect(facts).toContain('1-2');
    expect(facts).toContain('xG 1.93比0.73');
    expect(narrationNumbersAllowed(goodStory.intro + goodStory.event + goodStory.data, facts)).toBe(true);
    expect(narrationNumbersAllowed('梅西这届已经12球了', facts)).toBe(false); // 编造数字被拦
    expect(narrationNumbersAllowed('挪威xG才0.93', facts)).toBe(false); // 「93」不能蹭「1.93」的子串
  });
});

describe('buildEndingHook(第四拍·a/b 双分支)', () => {
  it('a:有真实下一场对阵,无显式 pick → 押本场胜者(晋级到该对阵才押),预测悬念钩子', () => {
    expect(buildEndingHook(match, { home: '挪威', away: '法国' })).toBe('老李押挪威,明晚见分晓');
  });

  it('a:显式 pick 必须在对阵双方之内;pick 编造(不在对阵里)→ 忽略,回落本场胜者', () => {
    expect(buildEndingHook(match, { home: '挪威', away: '法国', pick: '法国' })).toBe('老李押法国,明晚见分晓');
    expect(buildEndingHook(match, { home: '挪威', away: '法国', pick: '巴西' })).toBe('老李押挪威,明晚见分晓');
  });

  it('a:非次日场次可传真实时间口径 when,不硬说「明晚」', () => {
    expect(buildEndingHook(match, { home: '挪威', away: '法国', when: '周六晚' })).toBe('老李押挪威,周六晚见分晓');
  });

  it('b:无下一场信息/对阵残缺 → 关注承诺钩子(禁止编造对阵)', () => {
    expect(buildEndingHook(match)).toBe(FOLLOW_HOOK);
    expect(buildEndingHook(match, { home: '', away: '法国' })).toBe(FOLLOW_HOOK);
  });

  it('b:下一场对阵与本场胜者无关且无 pick → 没有真实押注依据,绝不硬押', () => {
    expect(buildEndingHook(match, { home: '法国', away: '英格兰' })).toBe(FOLLOW_HOOK);
  });

  it('b:本场战平(常规口径无胜者)且无 pick → 关注钩子', () => {
    const draw = { ...match, match: '巴西 1:1 挪威', final_score: '1-1' };
    expect(buildEndingHook(draw, { home: '挪威', away: '法国' })).toBe(FOLLOW_HOOK);
  });

  it('两个钩子文案本身过红线检查(预测句式/禁词都不命中)', () => {
    expect(containsLaoliVideoForbiddenTerm(buildEndingHook(match, { home: '挪威', away: '法国' }))).toBe(false);
    expect(containsLaoliVideoForbiddenTerm(FOLLOW_HOOK)).toBe(false);
  });
});

describe('buildLaoliReelStoryScript(判卷四拍·12-15s)', () => {
  it('LLM 正常返回 → 四拍成片:画面映射不变,outro=固定关注钩子,全段无禁词', async () => {
    const s = await buildLaoliReelStoryScript(match, reports, { matchId: 'm1', llm: fakeLlm(goodStory) });
    expect(s).not.toBeNull();
    expect(s!.scenes.map((x) => x.kind)).toEqual(['intro', 'event', 'data', 'outro']);
    expect(s!.scenes.map((x) => x.image)).toEqual(['brief', 'highlight', 'ratings', 'brief']);
    expect(s!.scenes[0]!.narration).toContain('罚丢点球'); // 第一拍:爆点直接砸
    // 第四拍:无下一场信息 → 关注承诺钩子(b 分支),不再吃 LLM 余味
    expect(s!.scenes[3]!.narration).toBe(FOLLOW_HOOK);
    for (const sc of s!.scenes) {
      expect(containsLaoliVideoForbiddenTerm(sc.narration)).toBe(false);
      expect(sc.subtitle).toBe(sc.narration);
    }
  });

  it('传入真实下一场对阵 → outro=预测悬念钩子(a 分支);不传 → 关注承诺(b 分支)', async () => {
    const a = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm(goodStory),
      nextMatch: { home: '挪威', away: '法国' },
    });
    expect(a!.scenes[3]!.narration).toBe('老李押挪威,明晚见分晓');
    expect(containsLaoliVideoForbiddenTerm(a!.scenes[3]!.narration)).toBe(false);
    const b = await buildLaoliReelStoryScript(match, reports, { llm: fakeLlm(goodStory) });
    expect(b!.scenes[3]!.narration).toBe(FOLLOW_HOOK);
  });

  it('LLM 带上多余的 outro 字段(旧习惯)→ 被忽略,outro 仍=固定钩子', async () => {
    const s = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm({ ...goodStory, outro: '这波啊,是效率赢了场面。微信搜超帧球后说' }),
    });
    expect(s).not.toBeNull();
    expect(s!.scenes[3]!.narration).toBe(FOLLOW_HOOK);
    expect(s!.scenes[3]!.narration).not.toContain('微信');
  });

  it('12-15s 字数预算:预算总和按 154字≈21s 实测口径折算落在 88-110 字(12-15s)', () => {
    const total = SCENE_BUDGET.intro + SCENE_BUDGET.event + SCENE_BUDGET.data + SCENE_BUDGET.outro;
    const charsPerSec = 154 / 21; // 上一版实测:154 字 ≈ 21s
    expect(total).toBeGreaterThanOrEqual(Math.ceil(12 * charsPerSec) - 1); // ≥ ~88 字(12s)
    expect(total).toBeLessThanOrEqual(Math.floor(15 * charsPerSec)); // ≤ ~110 字(15s)
  });

  it('超长 LLM 输出也被压进各段预算与 15s 总上限(场景切分不变)', async () => {
    const verbose = {
      hook: '点球开局点球收尾',
      intro: '嚯,你敢信这事儿?巴西居然把点球罚丢了!全场都傻了眼,这开局谁顶得住啊!',
      event: '这场球的弯儿拐得太急。点球被扑之后巴西人一直压着打。哈兰德看准了机会连着还了两下。内马尔来得实在太迟了。这锅到底该谁背?',
      data: '数据上巴西全面占优。控球也不落下风。可足球只认进的那个。你说冤不冤?',
      outro: '老李我看完只想叹气,这就是足球啊,回见。',
    };
    const s = await buildLaoliReelStoryScript(match, reports, { llm: fakeLlm(verbose) });
    expect(s).not.toBeNull();
    expect(s!.scenes.map((x) => x.kind)).toEqual(['intro', 'event', 'data', 'outro']);
    // clampToBudget 句界收口最多 +1 个句号
    expect(s!.scenes[0]!.narration.length).toBeLessThanOrEqual(SCENE_BUDGET.intro + 1);
    expect(s!.scenes[1]!.narration.length).toBeLessThanOrEqual(SCENE_BUDGET.event + 1);
    expect(s!.scenes[2]!.narration.length).toBeLessThanOrEqual(SCENE_BUDGET.data + 1);
    expect(s!.scenes[3]!.narration.length).toBeLessThanOrEqual(SCENE_BUDGET.outro);
    const total = s!.scenes.reduce((acc, x) => acc + x.narration.length, 0);
    expect(total / (154 / 21)).toBeLessThanOrEqual(15); // 折算时长 ≤15s
  });

  it('prompt=判卷四拍:单判断/单数据约束、禁面面俱到、前3秒炸开纪律、红线全数保留', async () => {
    let system = '';
    let user = '';
    const spy: typeof callLLM = async (opts) => {
      system = opts.messages.find((m) => m.role === 'system')?.content || '';
      user = opts.messages.find((m) => m.role === 'user')?.content || '';
      return { content: JSON.stringify(goodStory), provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } };
    };
    await buildLaoliReelStoryScript(match, reports, { llm: spy });
    // 四拍单判断结构
    expect(system).toContain('判卷四拍');
    expect(system).toContain('一条只讲一个判断');
    expect(system).toContain('12-15 秒');
    expect(system).toContain('第一拍·爆点结果');
    expect(system).toContain('第二拍·转折');
    expect(system).toContain('第三拍·核心数据');
    expect(system).toContain('第四拍·结尾钩子');
    // 单数据约束 + 禁面面俱到
    expect(system).toContain('只允许一个数据论据');
    expect(system).toContain('禁止堆第二个数据');
    expect(system).toContain('严禁面面俱到讲全场');
    // 前3秒炸开纪律(2ba0cc4)不削弱
    expect(system).toContain('前 3 秒必须炸开');
    expect(system).toContain('禁止铺垫');
    // 老李观点句落在第二拍(转折)
    expect(system).toContain('谁被高估了/这锅该谁背/谁的评分冤不冤');
    // 红线:极限词/金靴少赛/博彩/数字铁律 全数保留
    expect(system).toContain('最/第一/绝对/必/史上');
    expect(system).toContain('金靴话题禁说「少赛」');
    expect(system).toContain('博彩');
    expect(system).toContain('数字一律照抄事实清单里的阿拉伯数字原样');
    expect(system).toContain('几成/几倍/多几个');
    // 结尾钩子归系统,LLM 不许写
    expect(system).toContain('不要 outro 字段');
    expect(user).toContain('事实清单');
  });

  it('中文量词换算(几成/几倍)方向易错 → 整体拒绝(2026-07-06「巴西控球多六成」实测反向)', async () => {
    const s = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm({ ...goodStory, data: '巴西控球多六成,射门也压着打,可就是不进——这锅谁背?' }),
    });
    expect(s).toBeNull();
    const s2 = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm({ ...goodStory, data: '巴西xG是挪威的2倍还多,结果呢?这锅谁背?' }),
    });
    expect(s2).toBeNull();
  });

  it('「最后/最终」是时间词,不再被打成「更后」;story 场景整段保真', async () => {
    const s = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm({ ...goodStory, intro: '嚯,最后十分钟全变了天。' }),
    });
    expect(s!.scenes[0]!.narration).toContain('最后十分钟');
    expect(s!.scenes[0]!.narration).not.toContain('更后');
  });

  it('LLM 编造事实清单外的数字 → 整体拒绝(null,回退模板)', async () => {
    const s = await buildLaoliReelStoryScript(match, reports, {
      llm: fakeLlm({ ...goodStory, data: '哈兰德这届已经12球了,断层领先。' }),
    });
    expect(s).toBeNull();
  });

  it('LLM 抛错 / 返回非 JSON 结构 → null', async () => {
    const boom: typeof callLLM = async () => { throw new Error('timeout'); };
    expect(await buildLaoliReelStoryScript(match, reports, { llm: boom })).toBeNull();
    expect(await buildLaoliReelStoryScript(match, reports, { llm: fakeLlm({ intro: '太短' }) })).toBeNull();
  });

  it('LAOLI_REEL_STORY=0 关闸 → null(不打 LLM)', async () => {
    process.env.LAOLI_REEL_STORY = '0';
    try {
      const called = { n: 0 };
      const spy: typeof callLLM = async () => { called.n += 1; throw new Error('should not be called'); };
      expect(await buildLaoliReelStoryScript(match, reports, { llm: spy })).toBeNull();
      expect(called.n).toBe(0);
    } finally {
      delete process.env.LAOLI_REEL_STORY;
    }
  });

  it('超预算旁白按句界裁到预算内', async () => {
    const long = {
      ...goodStory,
      event: '这球从14分钟就拐了弯。点球被扑之后巴西人一直压着打。79分钟哈兰德先进一个。90分钟哈兰德又进一个。90+10分钟内马尔点球追回一个。可是时间不够了。',
    };
    const s = await buildLaoliReelStoryScript(match, reports, { llm: fakeLlm(long) });
    expect(s!.scenes[1]!.narration.length).toBeLessThanOrEqual(SCENE_BUDGET.event + 1);
    expect(/[。！？]$/.test(s!.scenes[1]!.narration)).toBe(true);
  });
});

// ============================================================
// 六拍变长争议弧(NARRATION-REDESIGN Phase 1)· Codex §6.4 反向验证表
// ============================================================

const base = { competition: '国际大赛', date: '2026-07-12' };

// 零球最高分:唯一最高评分球员本场零进球、有助攻(zero_goals_top_rating)
const zeroGoalsMatch: MatchData = {
  ...base,
  match: '英格兰 2:0 塞内加尔',
  final_score: '2-0',
  events: [
    { minute: 40, type: 'goal', team: '英格兰', player: 'Kane' },
    { minute: 70, type: 'goal', team: '英格兰', player: 'Foden', assist: 'Bellingham' },
  ],
  stats: {
    possession: { home: 62, away: 38 },
    shots: { home: 15, away: 6 },
    xg: { home: 2.4, away: 0.6 },
    players: {
      motm: { name: 'Bellingham', team: '英格兰', rating: 8.7, position: '中场' },
      home: [
        { name: 'Bellingham', rating: 8.7, minutes: 90, position: '中场', goals: 0, assists: 2 },
        { name: 'Kane', rating: 8.0, minutes: 90, position: '前锋', goals: 1, assists: 0 },
      ],
      away: [{ name: 'Mendy', rating: 6.5, minutes: 90, position: '门将', goals: 0, assists: 0 }],
    },
  },
};

describe('中文数字防编造 + 相对数 + 平台红线守卫', () => {
  it('1. 数字越界拒:allowlist 只有八点九/二十二/三比一,输出九点一 → 不通过', () => {
    const allowed = new Set(['八点九', '二十二', '三比一']);
    expect(spokenNumbersAllowed('这场评分九点一', allowed)).toBe(false);
    expect(spokenNumbersAllowed('这场评分八点九', allowed)).toBe(true);
  });

  it('2. 数字子串不可蹭用:allowlist 一点九三,输出零点九三 → 精确 token 不匹配', () => {
    expect(spokenNumbersAllowed('挪威预期进球零点九三', new Set(['一点九三']))).toBe(false);
    expect(spokenNumbersAllowed('巴西预期进球一点九三', new Set(['一点九三']))).toBe(true);
  });

  it('3. 相对数「成/倍」一律拒(方向易错)', () => {
    expect(containsRelativeMagnitude('控球多六成')).toBe(true);
    expect(containsRelativeMagnitude('预期进球翻两倍')).toBe(true);
    expect(containsRelativeMagnitude('高出几倍')).toBe(true);
    expect(containsRelativeMagnitude('评分八点七')).toBe(false);
  });

  it('中文数字提取:成语里的数字字不误当口播数字(一个/两次/十分),球/助攻等强量词才收', () => {
    expect(extractSpokenNumbers('英格兰一直压着打')).toEqual([]); // 一直
    expect(extractSpokenNumbers('一个球都没进')).toEqual([]); // 一个(弱量词)
    expect(extractSpokenNumbers('这场十分精彩')).toEqual([]); // 十分=很
    expect(extractSpokenNumbers('三球领先')).toEqual(['三']); // 强量词 球
    expect(extractSpokenNumbers('已经十二球了')).toEqual(['十二']);
    expect(extractSpokenNumbers('控球百分之五十九')).toEqual(['百分之五十九']);
  });

  it('28(片段). 平台红线:微信/搜/小程序/博彩/黑哨 命中', () => {
    expect(violatesPlatformRedline('关注老李微信搜超帧')).toBe(true);
    expect(violatesPlatformRedline('赔率盘口大小球')).toBe(true);
    expect(violatesPlatformRedline('这球是不是黑哨')).toBe(true);
    expect(violatesPlatformRedline('你服不服这个评分王')).toBe(false);
  });
});

describe('极限词遮蔽序数 + 字符集守卫', () => {
  it('9. 「第一百」不被误伤(遮蔽合法时间序数后再判)', () => {
    expect(containsExtremeTerm('第一百一十二分钟进球')).toBe(false);
    expect(containsExtremeTerm('第一分钟就丢球')).toBe(false);
  });

  it('10. 极限排名/极限词仍被拦', () => {
    expect(containsExtremeTerm('全场第一')).toBe(true);
    expect(containsExtremeTerm('历史第一人')).toBe(true);
    expect(containsExtremeTerm('史上更强')).toBe(true);
    expect(containsExtremeTerm('全场评分王')).toBe(false);
    expect(containsExtremeTerm('最后十分钟')).toBe(false); // 时间词不误伤
  });

  it('11. 字符集:含 ≠/①/VAR/8.9/% → 拒;规范化中文版通过', () => {
    expect(validateSpokenScene('预期进球不相等≠', '预期进球不相等≠')).toBe(false);
    expect(validateSpokenScene('第一档①', '第一档①')).toBe(false);
    expect(validateSpokenScene('VAR 介入', 'VAR 介入')).toBe(false);
    expect(validateSpokenScene('射正是8.9', '射正是8.9')).toBe(false);
    expect(validateSpokenScene('控球五十九%', '控球五十九%')).toBe(false);
    expect(validateSpokenScene('控球百分之五十九', '控球百分之五十九')).toBe(true);
  });

  it('12. 字幕必须逐字等于旁白', () => {
    expect(validateSpokenScene('评分八点七', '评分八点八')).toBe(false);
    expect(validateSpokenScene('评分八点七', '评分八点七')).toBe(true);
  });
});

describe('selectNarrativeAngle(争议角度自动识别·读 stats.players)', () => {
  it('13. 零球最高分角度命中(唯一最高评分、零进球、有助攻)', () => {
    expect(selectNarrativeAngle(zeroGoalsMatch).id).toBe('zero_goals_top_rating');
  });

  it('14. 零球但非最高分 → 不误命中', () => {
    const notTop: MatchData = {
      ...zeroGoalsMatch,
      stats: {
        ...zeroGoalsMatch.stats,
        players: {
          motm: { name: 'Kane', team: '英格兰', rating: 8.5, position: '前锋' },
          home: [
            { name: 'Kane', rating: 8.5, minutes: 90, position: '前锋', goals: 1, assists: 0 },
            { name: 'Bellingham', rating: 7.0, minutes: 90, position: '中场', goals: 0, assists: 1 },
          ],
          away: [],
        },
      },
    };
    expect(selectNarrativeAngle(notTop).id).not.toBe('zero_goals_top_rating');
  });

  it('15. 输球方门将评分王命中(最高评分、输球方、门将)', () => {
    const gk: MatchData = {
      ...base,
      match: '瑞士 0:1 巴西',
      final_score: '0-1',
      events: [{ minute: 80, type: 'goal', team: '巴西', player: 'Vinicius' }],
      stats: {
        possession: { home: 40, away: 60 },
        players: {
          motm: { name: 'Sommer', team: '瑞士', rating: 8.6, position: '门将' },
          home: [{ name: 'Sommer', rating: 8.6, minutes: 90, position: '门将', goals: 0, assists: 0 }],
          away: [{ name: 'Vinicius', rating: 7.9, minutes: 90, position: '前锋', goals: 1, assists: 0 }],
        },
      },
    };
    expect(selectNarrativeAngle(gk).id).toBe('losing_goalkeeper_motm');
  });

  it('16. 缺位置 → 不猜门将', () => {
    const noPos: MatchData = {
      ...base,
      match: '瑞士 0:1 巴西',
      final_score: '0-1',
      events: [{ minute: 80, type: 'goal', team: '巴西', player: 'Vinicius' }],
      stats: {
        possession: { home: 40, away: 60 },
        players: {
          motm: { name: 'Sommer', team: '瑞士', rating: 8.6, position: '' },
          home: [{ name: 'Sommer', rating: 8.6, minutes: 90, position: '', goals: 0, assists: 0 }],
          away: [{ name: 'Vinicius', rating: 7.9, minutes: 90, position: '前锋', goals: 1, assists: 0 }],
        },
      },
    };
    expect(selectNarrativeAngle(noPos).id).not.toBe('losing_goalkeeper_motm');
  });

  it('16b. 一人包办全队进球命中(≥2 球且=全队全部进球,压过 brace/late_winner)', () => {
    const oms: MatchData = {
      ...base,
      match: '挪威 1:2 英格兰',
      final_score: '1-2',
      events: [
        { minute: 36, type: 'goal', team: '挪威', player: 'Schjelderup' },
        { minute: 47, type: 'goal', team: '英格兰', player: 'Bellingham' },
        { minute: 93, type: 'goal', team: '英格兰', player: 'Bellingham' },
      ],
      stats: {
        possession: { home: 47, away: 53 },
        players: {
          motm: { name: 'Bellingham', team: '英格兰', rating: 8.5, position: '中场' },
          home: [{ name: 'Schjelderup', rating: 7.5, minutes: 90, position: '前锋', goals: 1, assists: 0 }],
          away: [{ name: 'Bellingham', rating: 8.5, minutes: 90, position: '中场', goals: 2, assists: 0 }],
        },
      },
    };
    expect(selectNarrativeAngle(oms).id).toBe('one_man_show');
  });

  it('16c. 进球≥2 但非全队全部 → 不误命中 one_man_show(走 brace)', () => {
    const notAll: MatchData = {
      ...base,
      match: '甲 3:0 乙',
      final_score: '3-0',
      events: [
        { minute: 20, type: 'goal', team: '甲', player: 'X' },
        { minute: 50, type: 'goal', team: '甲', player: 'X' },
        { minute: 70, type: 'goal', team: '甲', player: 'Y' },
      ],
      stats: {
        possession: { home: 60, away: 40 },
        players: { motm: { name: 'X', team: '甲', rating: 8.0, position: '前锋' }, home: [], away: [] },
      },
    };
    expect(selectNarrativeAngle(notAll).id).not.toBe('one_man_show');
  });

  it('17. 占优却被拖进加时命中(90 分钟平、一球险胜、控球达阈值)', () => {
    const dragged: MatchData = {
      ...base,
      match: '法国 2:1 摩洛哥',
      final_score: '2-1',
      events: [
        { minute: 20, type: 'goal', team: '法国', player: 'Mbappe' },
        { minute: 88, type: 'goal', team: '摩洛哥', player: 'Ziyech' },
        { minute: 105, type: 'goal', team: '法国', player: 'Giroud' },
      ],
      stats: {
        possession: { home: 61, away: 39 },
        shots: { home: 18, away: 7 },
        statusRaw: 'AET',
        scoreBreakdown: { fulltime: { home: 1, away: 1 }, extratime: { home: 2, away: 1 } },
        players: { home: [{ name: 'Mbappe', rating: 8.2, minutes: 120, position: '前锋', goals: 1, assists: 0 }], away: [] },
      },
    };
    expect(selectNarrativeAngle(dragged).id).toBe('dominant_but_dragged_to_extra_time');
  });

  it('18. 普通补时绝杀(FT)→ 不误判被拖进加时', () => {
    const ftLate: MatchData = {
      ...base,
      match: '法国 2:1 摩洛哥',
      final_score: '2-1',
      events: [
        { minute: 20, type: 'goal', team: '法国', player: 'Mbappe' },
        { minute: 70, type: 'goal', team: '摩洛哥', player: 'Ziyech' },
        { minute: 93, type: 'goal', team: '法国', player: 'Giroud' },
      ],
      stats: {
        possession: { home: 61, away: 39 },
        shots: { home: 18, away: 7 },
        statusRaw: 'FT',
        scoreBreakdown: { fulltime: { home: 2, away: 1 } },
        players: { home: [{ name: 'Mbappe', rating: 8.2, minutes: 90, position: '前锋', goals: 1, assists: 0 }], away: [] },
      },
    };
    expect(selectNarrativeAngle(ftLate).id).not.toBe('dominant_but_dragged_to_extra_time');
  });

  it('19. 红牌改变走势命中,问题文案只问「转折点」', () => {
    const red: MatchData = {
      ...base,
      match: 'A队 0:1 B队',
      final_score: '0-1',
      events: [
        { minute: 30, type: 'red_card', team: 'A队', player: 'X' },
        { minute: 60, type: 'goal', team: 'B队', player: 'Y' },
      ],
      stats: { players: { home: [], away: [] } },
    };
    const angle = selectNarrativeAngle(red);
    expect(angle.id).toBe('red_card_changed_course');
    expect(angle.openingQuestion).toContain('转折点');
    expect(containsExtremeTerm(angle.thesis)).toBe(false);
  });

  it('20. 红牌发生在落后方且之后比分不变 → 不命中红牌转折', () => {
    const redNo: MatchData = {
      ...base,
      match: 'A队 0:1 B队',
      final_score: '0-1',
      events: [
        { minute: 10, type: 'goal', team: 'B队', player: 'Y' },
        { minute: 30, type: 'red_card', team: 'A队', player: 'X' },
      ],
      stats: { players: { home: [], away: [] } },
    };
    expect(selectNarrativeAngle(redNo).id).not.toBe('red_card_changed_course');
  });

  it('21/22. 金靴领跑者没进:有 tournament 上下文才命中,缺则严禁编造', () => {
    const gb: MatchData = {
      ...base,
      match: '德国 1:0 日本',
      final_score: '1-0',
      events: [{ minute: 55, type: 'goal', team: '德国', player: 'Musiala' }],
      stats: { players: { home: [{ name: 'Musiala', rating: 7.8, minutes: 90, position: '中场', goals: 1, assists: 0 }], away: [] } },
    };
    const tournament: TournamentContext = {
      goldenBootTable: [
        { name: 'Kane', goals: 7, playedMatchIds: ['德国 1:0 日本'] },
        { name: 'Musiala', goals: 3 },
      ],
    };
    expect(selectNarrativeAngle(gb, tournament).id).toBe('golden_boot_leader_blank');
    expect(selectNarrativeAngle(gb).id).not.toBe('golden_boot_leader_blank'); // 无榜不编
  });

  it('29. 跨场去重:近五条两条同角度扣分,红牌角度反超;无历史时事实优先仍选零球', () => {
    const dedup: MatchData = {
      ...base,
      match: 'A队 0:2 B队',
      final_score: '0-2',
      events: [
        { minute: 20, type: 'red_card', team: 'A队', player: 'X' },
        { minute: 35, type: 'goal', team: 'B队', player: 'Y' },
        { minute: 65, type: 'goal', team: 'B队', player: 'Z' },
      ],
      stats: { players: { home: [], away: [{ name: 'Bellingham', rating: 9.0, minutes: 90, position: '中场', goals: 0, assists: 1 }] } },
    };
    expect(selectNarrativeAngle(dedup).id).toBe('zero_goals_top_rating'); // 无历史:事实优先
    const recentIds: AngleKind[] = ['zero_goals_top_rating', 'zero_goals_top_rating'];
    expect(selectNarrativeAngle(dedup, undefined, { angleIds: recentIds, openingFingerprints: [] }).id).toBe('red_card_changed_course');
  });
});

describe('resolveMotm(显式最高评分,非第一个有评分)', () => {
  it('优先 stats.players.motm;缺则取 home/away 最高;再缺兜底 key_players 最高', () => {
    expect(resolveMotm(zeroGoalsMatch)!.name).toBe('Bellingham');
    const noMotm: MatchData = {
      ...base, match: 'A 1:0 B', final_score: '1-0', events: [],
      stats: { players: { home: [{ name: '低分哥', rating: 6.0 }, { name: '高分哥', rating: 8.9 }], away: [] } },
    };
    expect(resolveMotm(noMotm)!.name).toBe('高分哥'); // 显式最高,非数组第一个
  });
});

describe('buildReelFactsEnvelope', () => {
  it('facts 纯中文口播、带 spokenNumberTokens、selectedAngle 一致、allowedSpokenNumbers 含评分/比分', () => {
    const env = buildReelFactsEnvelope(zeroGoalsMatch);
    expect(env.facts.length).toBeGreaterThan(3);
    const blob = env.facts.map((f) => f.text).join('\n');
    expect(blob).toContain('贝林厄姆');
    expect(blob).toContain('八点七'); // 评分 8.7 中文口播
    expect(blob).not.toMatch(/[0-9]/); // 事实文本无阿拉伯数字
    expect(env.selectedAngle.id).toBe('zero_goals_top_rating');
    expect(env.allowedSpokenNumbers).toContain('八点七');
    expect(env.allowedSpokenNumbers).toContain('二比零');
  });
});

// 六拍弧合规 LLM 输出(纯 CJK、全角标点、evidence 指向真实 fact、数字仅用 allowlist)
const goodArc = {
  hook: '零进球拿评分王',
  question: { text: '贝林厄姆一个球没进，凭啥拿全场头名？', evidence_ids: ['f7'] },
  drama: [
    { text: '英格兰全场压着打，机会一个接一个。', evidence_ids: ['f5'] },
    { text: '真正串起进攻的，是没进球的那个人。', evidence_ids: ['f7'] },
    { text: '七十分钟这个球，就是他喂出来的。', evidence_ids: ['f3'] },
  ],
  answer: [{ text: '全场评分王给了没进球的他，评分八点七，这不巧合。', evidence_ids: ['f7'] }],
  debate: { text: '你服不服这个评分王？', evidence_ids: ['f7'] },
};

describe('buildLaoliReelArcScript(六拍变长争议弧)', () => {
  it('合规输出 → 六拍成片:question/setup/escalation/turn/answer/debate/cta,字幕=旁白,CTA 纯站内关注', async () => {
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(goodArc), matchId: 'arc1' });
    expect(s).not.toBeNull();
    expect(s!.scenes.map((x) => x.kind)).toEqual(['question', 'setup', 'escalation', 'turn', 'answer', 'debate', 'cta']);
    expect(s!.scenes.at(-1)!.narration).toBe(FOLLOW_HOOK); // 系统 CTA:不预测下一场
    for (const sc of s!.scenes) {
      expect(sc.subtitle).toBe(sc.narration);
      expect(containsExtremeTerm(sc.narration)).toBe(false);
    }
    expect(s!.hook).toBe('零进球拿评分王');
  });

  it('1(e2e). 编造中文数字(评分九点一,不在 allowlist)→ 整条拒 null', async () => {
    const bad = { ...goodArc, answer: [{ text: '他这场评分九点一，稳稳的。', evidence_ids: ['f7'] }] };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(bad) })).toBeNull();
  });

  it('3(e2e). 相对数「成/倍」→ 整条拒 null', async () => {
    const bad = { ...goodArc, drama: [{ text: '英格兰控球多六成，场面占优。', evidence_ids: ['f4'] }, ...goodArc.drama.slice(1)] };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(bad) })).toBeNull();
  });

  it('23. 证据引用越界(引用不存在的 fact 编号)→ 整条拒 null', async () => {
    const bad = { ...goodArc, question: { text: '贝林厄姆凭啥拿头名？', evidence_ids: ['f99'] } };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(bad) })).toBeNull();
  });

  it('25. 非法 JSON(缺 debate)→ schema 失败 null', async () => {
    const bad = { hook: 'x', question: goodArc.question, drama: goodArc.drama, answer: goodArc.answer };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(bad) })).toBeNull();
  });

  it('24. LLM 抛错/超时 → null', async () => {
    const boom: typeof callLLM = async () => { throw new Error('timeout'); };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: boom })).toBeNull();
  });

  it('28(e2e). 平台红线(微信/搜)命中字段 → 整条拒 null', async () => {
    const bad = { ...goodArc, debate: { text: '评论区扣一个，关注老李微信搜超帧。', evidence_ids: ['f7'] } };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(bad) })).toBeNull();
  });

  it('debate 空 evidence_ids 仍成片(争议回扣不做事实断言·豁免证据门·修生产回退真 bug)', async () => {
    const emptyDebate = { ...goodArc, debate: { text: '你服不服这个评分王？', evidence_ids: [] as string[] } };
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(emptyDebate), matchId: 'arc-debate-empty' });
    expect(s).not.toBeNull();
    expect(s!.scenes.at(-2)!.kind).toBe('debate'); // 倒数第二=debate,最后一拍=cta
  });

  it('非 debate 拍空 evidence_ids → 仍拒 null(事实句必须引证)', async () => {
    const emptyDramaEv = { ...goodArc, drama: [{ text: '英格兰全场压着打，机会一个接一个。', evidence_ids: [] as string[] }, ...goodArc.drama.slice(1)] };
    expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(emptyDramaEv) })).toBeNull();
  });

  it('LAOLI_REEL_ARC=0 关闸 → null(不打 LLM,便于 A/B 切回四拍)', async () => {
    process.env.LAOLI_REEL_ARC = '0';
    try {
      const spy = { n: 0 };
      const llm: typeof callLLM = async () => { spy.n += 1; throw new Error('should not call'); };
      expect(await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm })).toBeNull();
      expect(spy.n).toBe(0);
    } finally {
      delete process.env.LAOLI_REEL_ARC;
    }
  });

  it('ctaOverride 过轻校验(纯CJK+无极限词+无红线)→ 末拍 CTA 用覆写句(不走数字/证据门)', async () => {
    const cta = '想看老李押球，关注就行';
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(goodArc), ctaOverride: cta, matchId: 'arc-cta' });
    expect(s).not.toBeNull();
    expect(s!.scenes.at(-1)!.kind).toBe('cta');
    expect(s!.scenes.at(-1)!.narration).toBe(cta); // 覆写句原样上位,非 FOLLOW_HOOK
    expect(s!.scenes.at(-1)!.narration).not.toBe(FOLLOW_HOOK);
  });

  it('非法 ctaOverride(平台红线「下注」)→ 回退 FOLLOW_HOOK', async () => {
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(goodArc), ctaOverride: '想下注就关注老李' });
    expect(s!.scenes.at(-1)!.narration).toBe(FOLLOW_HOOK);
  });

  it('非法 ctaOverride(含英文/非纯CJK)→ 回退 FOLLOW_HOOK', async () => {
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(goodArc), ctaOverride: '关注老李看MVP' });
    expect(s!.scenes.at(-1)!.narration).toBe(FOLLOW_HOOK);
  });

  it('无 ctaOverride → 默认 FOLLOW_HOOK(不回归)', async () => {
    const s = await buildLaoliReelArcScript(zeroGoalsMatch, reports, { llm: fakeLlm(goodArc) });
    expect(s!.scenes.at(-1)!.narration).toBe(FOLLOW_HOOK);
  });
});

describe('resolveCtaText(结尾 CTA 轻校验)', () => {
  it('缺省/空 → FOLLOW_HOOK', () => {
    expect(resolveCtaText()).toBe(FOLLOW_HOOK);
    expect(resolveCtaText('')).toBe(FOLLOW_HOOK);
  });
  it('合规纯 CJK 覆写句 → 原样用', () => {
    expect(resolveCtaText('想看老李押球，关注就行')).toBe('想看老李押球，关注就行');
  });
  it('平台红线(下注/搜一搜)→ FOLLOW_HOOK', () => {
    expect(resolveCtaText('想下注就关注老李')).toBe(FOLLOW_HOOK);
    expect(resolveCtaText('关注老李，搜一搜超帧')).toBe(FOLLOW_HOOK);
  });
  it('极限词(史上/最)→ FOLLOW_HOOK', () => {
    expect(resolveCtaText('关注老李看史上最强战报')).toBe(FOLLOW_HOOK);
  });
  it('非纯 CJK(英文/半角逗号/数字)→ FOLLOW_HOOK', () => {
    expect(resolveCtaText('关注老李看MVP')).toBe(FOLLOW_HOOK);
    expect(resolveCtaText('关注老李,淘汰赛见')).toBe(FOLLOW_HOOK); // 半角逗号非法字符集
    expect(resolveCtaText('关注老李押3场')).toBe(FOLLOW_HOOK);
  });
});
