/**
 * fallbackReport 兜底质量回归测试。
 *
 * 触发场景：LLM 全 provider 挂 → fallbackReport 兜底 → 落库（is_fallback=true）→ 用户看到。
 * 设计目标："看起来不像占位"，且必须满足 ReportSchema 长度约束。
 */
import { describe, expect, it } from 'vitest';
import { fallbackReport } from '@/lib/report';
import { ReportSchema } from '@/lib/llm';
import type { MatchData } from '@/lib/prompts';

const MATCH: MatchData = {
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛',
  date: '2026-06-22',
  final_score: '2:1',
  events: [
    { minute: 23, type: 'goal', team: '巴西', player: '维尼修斯', assist: '拉菲尼亚' },
    { minute: 41, type: 'goal', team: '西班牙', player: '亚马尔' },
    { minute: 78, type: 'goal', team: '巴西', player: '罗德里戈', assist: '维尼修斯' },
    { minute: 89, type: 'yellow_card', team: '西班牙', player: '罗德里' },
    { minute: 65, type: 'substitution', team: '巴西', player: '罗德里戈' },
  ],
  stats: {
    possession: { home: 42, away: 58 },
    shots: { home: 11, away: 14 },
    shots_on_target: { home: 5, away: 4 },
    xg: { home: 1.9, away: 1.4 },
    pass_accuracy: { home: 84, away: 89 },
    corners: { home: 5, away: 7 },
  },
};

describe('fallbackReport 队名解析（match 串两形态,6/12 揭幕战实测踩坑）', () => {
  it('auto-report 形态 "A 2:0 B" 也能拆出双方队名,绝不输出 undefined', () => {
    const r = fallbackReport('duanzi', { ...MATCH, match: 'Mexico 2:0 South Africa', final_score: '2:0' });
    expect(r.title).toContain('Mexico');
    expect(r.title).toContain('South Africa');
    expect(JSON.stringify(r)).not.toContain('undefined');
  });

  it('vs 形态照常解析', () => {
    const r = fallbackReport('duanzi', MATCH);
    expect(r.title).toContain('巴西');
    expect(r.title).toContain('西班牙');
  });

  it('两种形态都拆不出时退化为整串+对手,仍不出现 undefined', () => {
    const r = fallbackReport('emotion', { ...MATCH, match: '一场没有标准格式的比赛' });
    expect(JSON.stringify(r)).not.toContain('undefined');
    expect(r.title).toContain('对手');
  });
});

describe('fallbackReport schema 长度合规', () => {
  it.each(['hardcore', 'duanzi', 'emotion'] as const)(
    '%s 风格 fallback 通过 ReportSchema 校验',
    (style) => {
      const r = fallbackReport(style, MATCH);
      // 排除掉非 schema 字段后丢给 zod
      const { style: _s, promptVersion: _p, meta: _m, ...payload } = r;
      const parsed = ReportSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        // 调试用：把第一个失败的 issue 打出来
        console.error(style, parsed.error.issues[0]);
      }
    },
  );
});

describe('fallbackReport 三风格差异化', () => {
  it('三风格 title / lead / share_quote 互不相同', () => {
    const a = fallbackReport('hardcore', MATCH);
    const b = fallbackReport('duanzi', MATCH);
    const c = fallbackReport('emotion', MATCH);
    expect(a.title).not.toBe(b.title);
    expect(b.title).not.toBe(c.title);
    expect(a.lead).not.toBe(b.lead);
    expect(b.lead).not.toBe(c.lead);
    expect(a.share_quote).not.toBe(b.share_quote);
  });

  it('hardcore 兜底带 xG / 控球率 等数据术语', () => {
    const r = fallbackReport('hardcore', MATCH);
    expect(r.lead + r.body.join('')).toMatch(/xG|控球率|射门/);
  });

  it('emotion 兜底带叙事性词（故事 / 夜晚 / 名字）', () => {
    const r = fallbackReport('emotion', MATCH);
    const all = r.title + r.subtitle + r.lead + r.body.join('') + r.ending;
    expect(all).toMatch(/故事|夜晚|名字|那 ?90|每一/);
  });
});

describe('fallbackReport 元数据', () => {
  it('promptVersion 带 -fallback 后缀（便于 evals 区分）', () => {
    const r = fallbackReport('hardcore', MATCH);
    expect(r.promptVersion).toMatch(/-fallback$/);
  });

  it('meta.provider === "fallback" 且 latencyMs=0', () => {
    const r = fallbackReport('duanzi', MATCH);
    expect(r.meta.provider).toBe('fallback');
    expect(r.meta.latencyMs).toBe(0);
  });

  it('tags 含双方队名 + 赛事名（用于检索）', () => {
    const r = fallbackReport('emotion', MATCH);
    expect(r.tags).toContain('巴西');
    expect(r.tags).toContain('西班牙');
    expect(r.tags).toContain('国际大赛小组赛');
  });
});

describe('fallbackReport 比分解析（兼容多格式）', () => {
  it.each([
    ['2:1', { winner: '巴西' }],
    ['2-1', { winner: '巴西' }],
    ['1:2', { winner: '西班牙' }],
    ['1:1', { tie: true }],
  ])('解析 %s 正确', (score, expected) => {
    const r = fallbackReport('hardcore', { ...MATCH, final_score: score });
    if ('winner' in expected) {
      expect(r.subtitle).toContain(expected.winner);
    } else if ('tie' in expected) {
      expect(r.subtitle).toMatch(/平局/);
    }
  });
});

describe('fallbackReport 退化场景（输入数据不全）', () => {
  it('无 events 时不挂，body 仍输出数据待补录文案', () => {
    const r = fallbackReport('hardcore', { ...MATCH, events: [] });
    const payload = { title: r.title, subtitle: r.subtitle, lead: r.lead, body: r.body, ending: r.ending, share_quote: r.share_quote, tags: r.tags };
    expect(ReportSchema.safeParse(payload).success).toBe(true);
    expect(r.body.join('')).toMatch(/进球数据|数据/);
  });

  it('无 stats 时不挂，写 "数据暂未同步"', () => {
    const r = fallbackReport('hardcore', { ...MATCH, stats: {} });
    expect(r.lead).toMatch(/暂未同步/);
    const payload = { title: r.title, subtitle: r.subtitle, lead: r.lead, body: r.body, ending: r.ending, share_quote: r.share_quote, tags: r.tags };
    expect(ReportSchema.safeParse(payload).success).toBe(true);
  });
});
