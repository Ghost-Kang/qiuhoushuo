/**
 * 小红书「关注转化层」专项测试(GROWTH-ROOTCAUSE-PLAN-2026-07-08 §3 S2/S3/S4/S5/S7):
 *   ① 追更承诺 CTA:距决赛动态 N 天 + 决赛当天/之后留存兜底;写死进正文结尾(不靠 LLM 自觉)。
 *   ② 球后锐评:第一人称签名式观点要求进 xhs prompt。
 *   ③ 金靴口径:命中金靴/射手榜自动附「已按同场次口径核对」;「少赛」系变体代码层护栏(命中→整条回退干净模板)。
 *   ④ 建议首评:每条 xhs 笔记带追更钩子首评,落 markdown + 企微通知。
 *   ⑤ 行为冻结:抖音/视频号 engine 输出与改造前逐点一致(共享函数改动的回归证明)。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PLATFORMS,
  STATION_OUT_FORBIDDEN,
  CHANNELS_FORBIDDEN,
  hasForbidden,
  buildKindPrompt,
  parseOneNote,
  generateSocialBundle,
  renderSocialMarkdown,
  buildSocialAlert,
  daysUntilFinal,
  xhsFollowCta,
  xhsFirstComment,
  WORLD_CUP_FINAL_DATE,
  GOLDEN_BOOT_CALIBER_NOTE,
  XHS_GOLDEN_BOOT_FORBIDDEN,
  type SocialFacts,
} from '@/lib/api/social-content';

const FACTS: SocialFacts = {
  matchId: '22222222-2222-4222-8222-222222222222',
  date: '2026-07-08', // 距 2026-07-19 决赛 11 天
  matchLabel: '法国 1:0 德国',
  home: '法国',
  away: '德国',
  score: '1:0',
  competition: '国际大赛',
  reports: {
    hardcore: { title: '法国防反教科书', shareQuote: '一剑封喉', lead: 'l', body: ['b1', 'b2'] },
  },
  briefCardUrl: 'https://qiuhoushuo.com/api/card/y?variant=brief',
  ratingsCardUrl: 'https://qiuhoushuo.com/api/card/y?variant=ratings',
};

const XHS = PLATFORMS.xhs;
const KIND0 = XHS.llmKinds[0]!;

/** 单条 note 的 LLM 返回,body 可注入。 */
function rawNote(body: string, extra: Partial<{ title: string; coverTitle: string }> = {}): string {
  return JSON.stringify({
    note: {
      coverTitle: extra.coverTitle ?? '封面',
      coverSub: '副',
      title: extra.title ?? '标题带emoji✨',
      body,
      tags: ['看球'],
    },
  });
}

const okLLM = (body: string) =>
  vi.fn(async () => ({ content: rawNote(body), provider: 'doubao' as const, meta: { model: 'm', latencyMs: 1 } }));

// ============ ① 追更承诺 CTA(S2 + S7) ============

describe('追更承诺 CTA:动态天数 + 决赛后留存兜底', () => {
  it('daysUntilFinal:7/08→11、7/18→1、决赛当天→0、非法日期→NaN', () => {
    expect(WORLD_CUP_FINAL_DATE).toBe('2026-07-19');
    expect(daysUntilFinal('2026-07-08')).toBe(11);
    expect(daysUntilFinal('2026-07-18')).toBe(1);
    expect(daysUntilFinal('2026-07-19')).toBe(0);
    expect(daysUntilFinal('2026-06-29')).toBe(20);
    expect(daysUntilFinal('not-a-date')).toBeNaN();
  });

  it('决赛前:按规定措辞出「关注我,大赛最后N天每场赛后更:AI评分、金靴榜、决赛路径」', () => {
    expect(xhsFollowCta('2026-07-08')).toContain('关注我,大赛最后11天每场赛后更:AI评分、金靴榜、决赛路径');
    expect(xhsFollowCta('2026-07-18')).toContain('大赛最后1天每场赛后更');
    expect(xhsFollowCta('2026-07-08')).toContain('微信搜小程序「超帧球后说」'); // 搜索导流保留
  });

  it('决赛当天/之后/非法日期:兜底「关注看五大联赛/欧冠 AI 球评,不断更」(S7 留存承诺)', () => {
    for (const d of ['2026-07-19', '2026-07-25', '2026-08-01', 'garbage']) {
      const cta = xhsFollowCta(d);
      expect(cta).toContain('关注看五大联赛/欧冠 AI 球评,不断更');
      expect(cta).not.toContain('大赛最后');
    }
  });

  it('两种 CTA 均不踩小红书禁词(站外红线 + 少赛护栏)', () => {
    expect(hasForbidden(xhsFollowCta('2026-07-08'), XHS.forbidden)).toBe(false);
    expect(hasForbidden(xhsFollowCta('2026-07-20'), XHS.forbidden)).toBe(false);
  });

  it('CTA 写死进正文结尾:LLM 输出不带也强制附上(ensureCta),并进 prompt 要求', () => {
    const n = parseOneNote(XHS, KIND0, rawNote('随便写的正文,没带话术'), FACTS);
    expect(n.body.trimEnd().endsWith(xhsFollowCta(FACTS.date))).toBe(true);
    const user = buildKindPrompt(XHS, KIND0, FACTS)[1]!.content;
    expect(user).toContain('大赛最后11天每场赛后更');
  });

  it('决赛后的比赛:正文结尾自动切留存承诺', () => {
    const late = { ...FACTS, date: '2026-07-21' };
    const n = parseOneNote(XHS, KIND0, rawNote('赛后正文'), late);
    expect(n.body).toContain('关注看五大联赛/欧冠 AI 球评,不断更');
    expect(n.body).not.toContain('大赛最后');
  });

  it('兜底模板同样带动态追更承诺(LLM 挂了也不丢转化层)', async () => {
    const llm = vi.fn(async () => { throw new Error('boom'); });
    const bundle = await generateSocialBundle(FACTS, XHS, { llm });
    for (const n of bundle.notes) expect(n.body).toContain('大赛最后11天每场赛后更');
  });
});

// ============ ② 球后锐评(S5) ============

describe('球后锐评进 prompt', () => {
  it('xhs systemPrompt 要求第一人称签名式锐评、放正文靠前、犀利但克制', () => {
    const sys = XHS.systemPrompt;
    expect(sys).toContain('球后锐评');
    expect(sys).toContain('第一人称');
    expect(sys).toContain('签名式观点');
    expect(sys).toContain('谁被高估');
    expect(sys).toContain('谁该背锅');
    expect(sys).toContain('评分最冤');
    expect(sys).toContain('靠前');
    expect(sys).toContain('犀利但克制');
  });

  it('buildKindPrompt 每类都把锐评要求带给 LLM(system 消息)', () => {
    for (const k of XHS.llmKinds) {
      expect(buildKindPrompt(XHS, k, FACTS)[0]!.content).toContain('球后锐评');
    }
  });

  it('抖音/视频号 prompt 不受影响(无锐评要求)', () => {
    expect(PLATFORMS.douyin.systemPrompt).not.toContain('球后锐评');
    expect(PLATFORMS.channels.systemPrompt).not.toContain('球后锐评');
  });
});

// ============ ③ 金靴口径标注 + 「少赛」护栏(S4) ============

describe('金靴口径标注 + 少赛护栏', () => {
  it('文案涉及金靴榜 → 自动附「已按同场次口径核对」,且仍以 CTA 收尾', () => {
    const n = parseOneNote(XHS, KIND0, rawNote('今晨过后金靴榜又变了:姆巴佩 5 球领跑。'), FACTS);
    expect(n.body).toContain('已按同场次口径核对');
    const cta = xhsFollowCta(FACTS.date);
    expect(n.body.trimEnd().endsWith(cta)).toBe(true);
    expect(n.body.indexOf(GOLDEN_BOOT_CALIBER_NOTE)).toBeLessThan(n.body.indexOf(cta)); // 标注在 CTA 之前
  });

  it('射手榜字样同样触发;标题/封面命中也触发', () => {
    expect(parseOneNote(XHS, KIND0, rawNote('射手榜前三没变。'), FACTS).body).toContain('已按同场次口径核对');
    expect(parseOneNote(XHS, KIND0, rawNote('正文不提榜单', { title: '金靴榜第4天📈' }), FACTS).body).toContain('已按同场次口径核对');
  });

  it('幂等:LLM 已自带口径句 → 不重复附', () => {
    const n = parseOneNote(XHS, KIND0, rawNote('金靴榜更新(已按同场次口径核对):凯恩追平。'), FACTS);
    expect(n.body.split('已按同场次口径核对').length - 1).toBe(1);
  });

  it('不涉及金靴/射手榜 → 不附口径句', () => {
    const n = parseOneNote(XHS, KIND0, rawNote('普通战报正文,只聊控球率。'), FACTS);
    expect(n.body).not.toContain('已按同场次口径核对');
  });

  it('「少赛」系变体(少赛/少踢/少打/少赛紧追)→ 整条回退干净模板(代码层护栏)', () => {
    for (const bad of ['凯恩少赛一场紧追', '他还少踢两场', '少打一轮照样领跑', '少赛紧追姆巴佩']) {
      for (const raw of [rawNote(`金靴榜:${bad}。`), rawNote('正文', { title: `金靴悬念!${bad}` })]) {
        const n = parseOneNote(XHS, KIND0, raw, FACTS);
        expect(XHS_GOLDEN_BOOT_FORBIDDEN.some((re) => re.test(`${n.coverTitle}\n${n.title}\n${n.body}`))).toBe(false);
        expect(n.body.trimEnd().endsWith(xhsFollowCta(FACTS.date))).toBe(true); // 回退条同样带追更承诺
      }
    }
  });

  it('prompt 护栏:xhs systemPrompt 显式禁「少赛/少踢/少赛紧追」并规定口径话术', () => {
    const sys = XHS.systemPrompt;
    expect(sys).toContain('少赛');
    expect(sys).toContain('少踢');
    expect(sys).toContain('少赛紧追');
    expect(sys).toContain('已按同场次口径核对');
  });
});

// ============ ④ 建议首评(S3) ============

describe('建议首评(追更钩子)', () => {
  it('每条 xhs 笔记(LLM 条 + 兜底条 + 写真条)都带首评,含追更钩子且不踩禁词', async () => {
    const bundle = await generateSocialBundle(FACTS, XHS, { llm: okLLM('正文') });
    expect(bundle.notes.length).toBeGreaterThan(0);
    for (const n of bundle.notes) {
      expect(n.firstComment).toBe('金靴榜每天更,谁反超评论区揭晓,关注不迷路📌');
      expect(hasForbidden(n.firstComment!, XHS.forbidden)).toBe(false);
    }
  });

  it('决赛后首评切留存钩子', () => {
    expect(xhsFirstComment('2026-07-20')).toBe('五大联赛/欧冠 AI 球评不断更,关注不迷路📌');
    const n = parseOneNote(XHS, KIND0, rawNote('正文'), { ...FACTS, date: '2026-07-20' });
    expect(n.firstComment).toContain('五大联赛/欧冠');
  });

  it('首评落 markdown(## 建议首评)+ 企微通知(【建议首评】)', async () => {
    const bundle = await generateSocialBundle(FACTS, XHS, { llm: okLLM('正文') });
    const files = renderSocialMarkdown(XHS, bundle);
    expect(files.some((f) => f.content.includes('## 建议首评') && f.content.includes('关注不迷路📌'))).toBe(true);
    const alert = buildSocialAlert(XHS, bundle, '/data/x', true);
    expect(alert.body).toContain('【建议首评】金靴榜每天更');
  });
});

// ============ ⑤ 抖音/视频号行为冻结(共享函数改动的回归证明) ============

describe('抖音/视频号输出不受关注转化层影响', () => {
  it('两平台未接动态 CTA / postProcess,禁词集仍是共享原集合(引用相等,未混入少赛护栏)', () => {
    for (const p of [PLATFORMS.douyin, PLATFORMS.channels]) {
      expect(p.followCtaFor).toBeUndefined();
      expect(p.postProcess).toBeUndefined();
    }
    expect(PLATFORMS.douyin.forbidden).toBe(STATION_OUT_FORBIDDEN);
    expect(PLATFORMS.channels.forbidden).toBe(CHANNELS_FORBIDDEN);
    expect(hasForbidden('少赛一场紧追', PLATFORMS.xhs.forbidden)).toBe(true);
    expect(hasForbidden('少赛一场紧追', PLATFORMS.douyin.forbidden)).toBe(false);
    expect(hasForbidden('少赛一场紧追', PLATFORMS.channels.forbidden)).toBe(false);
  });

  it('静态 CTA 字面锁定(改动前原文)', () => {
    expect(PLATFORMS.douyin.followCta).toBe('👀 想自己玩的微信搜「超帧球后说」小程序,关注我每场都更——别划走!');
    expect(PLATFORMS.channels.followCta).toBe('👇 关注本视频号 + 点赞,点下方小程序「超帧球后说」看完整战报,每场都有!');
  });

  it('金靴文案在抖音/视频号不附口径句、不带首评、正文仍以各自静态 CTA 收尾', async () => {
    for (const p of [PLATFORMS.douyin, PLATFORMS.channels]) {
      const bundle = await generateSocialBundle(FACTS, p, { llm: okLLM('[0-3s] 金靴榜悬念开场') });
      for (const n of bundle.notes) {
        expect(n.body).not.toContain('已按同场次口径核对');
        expect(n.firstComment).toBeUndefined();
        expect(n.body).toContain(p.followCta);
      }
      const files = renderSocialMarkdown(p, bundle);
      expect(files.every((f) => !f.content.includes('建议首评'))).toBe(true);
      const alert = buildSocialAlert(p, bundle, '/data/x', true);
      expect(alert.body).not.toContain('建议首评');
    }
  });

  it('抖音/视频号 prompt 的关注话术仍是静态原句', () => {
    for (const p of [PLATFORMS.douyin, PLATFORMS.channels]) {
      const user = buildKindPrompt(p, p.llmKinds[0]!, FACTS)[1]!.content;
      expect(user).toContain(p.followCta);
      expect(user).not.toContain('大赛最后');
    }
  });
});
