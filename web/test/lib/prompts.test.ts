import { describe, expect, it } from 'vitest';
import {
  PROMPT_VERSION,
  buildHostUserPrompt,
  buildReportUserPrompt,
  getReportSystemPrompt,
  type MatchData,
} from '@/lib/prompts';

const sampleMatch: MatchData = {
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛',
  date: '2026-06-22',
  final_score: '2:1',
  events: [
    { minute: 12, type: 'goal', team: '巴西', player: '维尼修斯' },
    { minute: 80, type: 'yellow_card', team: '西班牙', player: '罗德里' },
  ],
  stats: {
    possession: { home: 42, away: 58 },
    xg: { home: 1.9, away: 1.4 },
  },
};

describe('prompts', () => {
  it('exposes a non-empty PROMPT_VERSION', () => {
    expect(typeof PROMPT_VERSION).toBe('string');
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it.each(['hardcore', 'duanzi', 'emotion'] as const)('returns a system prompt for style %s', (style) => {
    const prompt = getReportSystemPrompt(style);
    expect(prompt.length).toBeGreaterThan(50);
    // 合规：prompt 自身不能含官方赛事名（应使用槽位 / 中性表述）
    expect(prompt).not.toMatch(/FIFA|世界杯|World Cup/i); // trademark-allowed (反向断言)
  });

  it('hardcore differs from duanzi differs from emotion', () => {
    const a = getReportSystemPrompt('hardcore');
    const b = getReportSystemPrompt('duanzi');
    const c = getReportSystemPrompt('emotion');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('buildReportUserPrompt embeds match data as JSON', () => {
    const text = buildReportUserPrompt(sampleMatch);
    expect(text).toContain('巴西 vs 西班牙');
    expect(text).toContain('2:1');
    expect(text).toMatch(/```json[\s\S]+```/);
  });

  it('buildReportUserPrompt instructs JSON-only output', () => {
    const text = buildReportUserPrompt(sampleMatch);
    expect(text).toContain('只返回 JSON');
  });

  it('buildHostUserPrompt round-trips context as JSON string', () => {
    const text = buildHostUserPrompt({
      match: '德国 vs 日本',
      minute: -10,
      score: null,
      task: 'topic_throw',
    });
    const parsed = JSON.parse(text);
    expect(parsed.match).toBe('德国 vs 日本');
    expect(parsed.task).toBe('topic_throw');
    expect(parsed.score).toBeNull();
  });
});
