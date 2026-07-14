import { describe, expect, it } from 'vitest';
import { buildLaoliDouyinCaption, renderCaptionMarkdown } from '@/lib/api/laoli-douyin-caption';
import type { MatchData } from '@/lib/prompts';
import type { callLLM } from '@/lib/llm';

const base = { competition: '国际大赛', date: '2026-07-12' };

// 零球最高分场（angle=zero_goals_top_rating）——与 reel 六拍弧同源 envelope
const captionMatch: MatchData = {
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

// 加时场（timing 含「加时」）——测试 caption 加时口径一致
const otMatch: MatchData = {
  ...base,
  match: '法国 1:0 英格兰',
  final_score: '1-0',
  events: [{ minute: 93, type: 'goal', team: '法国', player: 'Mbappe' }],
  stats: {
    statusRaw: 'AET',
    scoreBreakdown: { fulltime: { home: 0, away: 0 }, extratime: { home: 1, away: 0 } },
    players: { home: [{ name: 'Mbappe', rating: 8.1, minutes: 120, position: '前锋', goals: 1, assists: 0 }], away: [] },
  },
};

const reports = {};
const fakeLlm = (payload: unknown): typeof callLLM =>
  (async () => ({ content: JSON.stringify(payload), provider: 'doubao' as const, meta: { model: 'fake', latencyMs: 1 } }));

const goodCaption = {
  title: '英格兰完胜，评分王竟没进球',
  intro: '英格兰这场两球拿下，全场压着打。可全场评分王一个球没进，八点七的评分是靠助攻串起来的。你说这算不算真核心？',
  self: '你觉得这个评分王，配不配？评论区聊两句。',
};

describe('buildLaoliDouyinCaption', () => {
  it('全字段合规 → source=llm、degraded=false、angle 与 reel 同源', async () => {
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: fakeLlm(goodCaption) });
    expect(c.source).toBe('llm');
    expect(c.degraded).toBe(false);
    expect(c.angleId).toBe('zero_goals_top_rating');
    expect(c.title).toBe(goodCaption.title);
    expect(c.fields).toEqual({ title: 'llm', intro: 'llm', self: 'llm' });
  });

  it('26. Caption 数字防编造:简介新增「评分九点一」(不在 allowlist)→ 简介回退模板,不落该数字', async () => {
    const bad = { ...goodCaption, intro: '这场评分九点一，稳了。' };
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: fakeLlm(bad) });
    expect(c.fields.intro).toBe('template');
    expect(c.degraded).toBe(true);
    expect(c.intro).not.toContain('九点一');
    expect(c.source).toBe('mixed'); // title/self 仍 LLM
  });

  it('27. Caption 加时一致性:输出「补时绝杀」与 story「加时」口径冲突 → 简介回退加时版', async () => {
    const bad = { title: '法国加时绝杀英格兰', intro: '这球是补时绝杀，法国赢了。', self: '你说这球该不该算？' };
    const c = await buildLaoliDouyinCaption(otMatch, reports, { llm: fakeLlm(bad) });
    expect(c.fields.intro).toBe('template');
    expect(c.intro).not.toContain('补时');
    expect(c.intro).toContain('加时'); // 模板逐字复制系统时间标签
  });

  it('28. 平台红线:自评含微信/搜 → 该字段回退,最终不落站外导流', async () => {
    const bad = { ...goodCaption, self: '关注老李，微信搜超帧球后说。' };
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: fakeLlm(bad) });
    expect(c.fields.self).toBe('template');
    expect(c.self).not.toContain('微信');
    expect(c.degraded).toBe(true);
  });

  it('极限词字段被拦:标题含「史上第一」→ 回退模板', async () => {
    const bad = { ...goodCaption, title: '史上第一门神' };
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: fakeLlm(bad) });
    expect(c.fields.title).toBe('template');
  });

  it('LLM 全灭(无 key/无注入)→ 全模板、degraded=true、可观测 fallbackReason', async () => {
    const prev = { d: process.env.DOUBAO_API_KEY, k: process.env.DEEPSEEK_API_KEY };
    delete process.env.DOUBAO_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const c = await buildLaoliDouyinCaption(captionMatch, reports, {});
      expect(c.source).toBe('template');
      expect(c.degraded).toBe(true);
      expect(c.fallbackReason).toContain('template');
      // 模板也过全套守卫:无极限词、无站外导流、无阿拉伯数字
      expect(c.title).not.toMatch(/[0-9A-Za-z%]/);
      expect(c.intro).not.toContain('微信');
    } finally {
      if (prev.d) process.env.DOUBAO_API_KEY = prev.d;
      if (prev.k) process.env.DEEPSEEK_API_KEY = prev.k;
    }
  });

  it('LLM 抛错/超时 → 全模板兜底(绝不失败)', async () => {
    const boom: typeof callLLM = async () => { throw new Error('timeout'); };
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: boom });
    expect(c.source).toBe('template');
    expect(c.degraded).toBe(true);
  });
});

describe('renderCaptionMarkdown', () => {
  it('含标题/简介/自评 + 话题标签 + 站内关注 CTA;不含微信/每天十九秒', async () => {
    const c = await buildLaoliDouyinCaption(captionMatch, reports, { llm: fakeLlm(goodCaption) });
    const md = renderCaptionMarkdown(c, { match: captionMatch });
    expect(md).toContain(goodCaption.title);
    expect(md).toContain(goodCaption.intro);
    expect(md).toContain('#国际大赛');
    expect(md).toContain('关注老李');
    expect(md).not.toContain('微信');
    expect(md).not.toContain('每天');
    expect(md).not.toContain('十九秒');
    expect(md).not.toContain('19秒');
  });
});
