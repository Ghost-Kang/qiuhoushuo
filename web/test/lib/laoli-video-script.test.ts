import { describe, expect, it } from 'vitest';
import {
  buildLaoliVideoScript,
  buildLaoliReelScript,
  clampBannerHook,
  containsLaoliVideoForbiddenTerm,
  sanitizeLaoliVideoText,
} from '@/lib/api/laoli-video-script';
import type { MatchData } from '@/lib/prompts';
import type { GeneratedReport } from '@/lib/report';

const match: MatchData = {
  match: '韩国 vs 捷克',
  competition: 'World Cup 2026', // trademark-allowed
  date: '2026-06-12',
  final_score: '2-1',
  events: [
    { minute: 46, type: 'goal', team: '韩国', player: '金民宇' },
    { minute: 59, type: 'red_card', team: '捷克', player: '克雷伊奇' },
    { minute: 80, type: 'goal', team: '韩国', player: '李刚仁' },
  ],
  stats: {
    possession: { home: 48, away: 52 },
    shots_on_target: { home: 6, away: 3 },
  },
};

function report(style: GeneratedReport['style'], overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    style,
    title: '59分钟之后的反超',
    subtitle: '真实赛果已经落定',
    lead: '韩国利用射正效率和关键回合拿下比赛。',
    body: [],
    ending: '终场。',
    share_quote: '效率决定了这一晚的方向。',
    tags: [],
    promptVersion: 'test',
    meta: {
      provider: 'mock',
      model: 'mock',
      latencyMs: 1,
      safetyPassed: true,
    },
    ...overrides,
  };
}

describe('clampBannerHook（抖音顶部大标题钩子)', () => {
  it('短钩子原样保留', () => {
    expect(clampBannerHook('三人7球金靴悬了')).toBe('三人7球金靴悬了');
    expect(clampBannerHook('绝杀!10人翻11人')).toBe('绝杀!10人翻11人');
  });
  it('LLM「A!B」超长句 → 收成首个完整短句 A!(B 归字幕)', () => {
    expect(clampBannerHook('红牌+双响！英格兰34%控球率偷走阿兹特卡的胜利')).toBe('红牌+双响！');
    expect(clampBannerHook('红牌+双响！英格兰34%控球率偷走胜利')).toBe('红牌+双响！');
  });
  it('无早断点的超长句 → 硬裁到 14 字、去尾标点', () => {
    const out = clampBannerHook('英格兰34%控球率偷走了整场比赛的全部胜利悬念');
    expect(out.length).toBeLessThanOrEqual(14);
    expect(out).not.toMatch(/[，。！？、；：]$/);
  });
  it('句末句号被剥掉(!/? 语气保留)', () => {
    expect(clampBannerHook('墨西哥赢了场面。英格兰赢了贝林厄姆全场最佳')).toBe('墨西哥赢了场面');
  });
});

describe('buildLaoliReelScript 顶部钩子', () => {
  it('模板脚本带 hook 字段(战报标题优先,兜底比分)', () => {
    const s = buildLaoliReelScript(match, {}, { matchId: 'm1' });
    expect(typeof s.hook).toBe('string');
    expect(s.hook!.length).toBeGreaterThan(0);
    expect(s.hook!.length).toBeLessThanOrEqual(14);
  });
});

describe('buildLaoliVideoScript', () => {
  it('builds a fixed 9:16 Hook/Body/Outro timeline no longer than 35 seconds', () => {
    const script = buildLaoliVideoScript(match, {
      hardcore: report('hardcore'),
      duanzi: report('duanzi'),
      emotion: report('emotion'),
    }, { matchId: 'match-1' });

    expect(script).toMatchObject({
      version: 'laoli-postmatch-v1',
      width: 1080,
      height: 1920,
      durationSec: 35,
      matchId: 'match-1',
      watermark: 'AI生成内容',
    });
    expect(script.segments.map((item) => item.kind)).toEqual([
      'hook',
      'body',
      'body',
      'body',
      'outro',
    ]);
    expect(script.segments[0]).toMatchObject({ startSec: 0, endSec: 3, visual: 'score' });
    expect(script.segments.at(-1)).toMatchObject({ startSec: 29, endSec: 35, visual: 'brand' });
    expect(script.segments.every((item) => item.subtitle === item.narration)).toBe(true);
  });

  it('uses only supplied score, events and stats for the factual body', () => {
    const script = buildLaoliVideoScript(match, { hardcore: report('hardcore') });
    expect(script.narration).toContain('韩国 2:1 捷克');
    expect(script.narration).toContain('46分钟，金民宇进球');
    expect(script.narration).toContain('59分钟，克雷伊奇被罚下');
    expect(script.narration).toContain('射正6比3');
    expect(script.narration).toContain('控球48%比52%');
  });

  it('sanitizes trademark, gambling, superlative and prediction language at generation time', () => {
    const unsafe = '世界杯官方独家：这是唯一最强预测，下场一定会赢，赔率第一。'; // trademark-allowed
    const script = buildLaoliVideoScript(match, {
      duanzi: report('duanzi', { share_quote: unsafe }),
      hardcore: report('hardcore', { lead: unsafe }),
    });

    expect(script.narration).toContain('国际大赛');
    expect(containsLaoliVideoForbiddenTerm(script.narration)).toBe(false);
    expect(script.narration).not.toContain('世界杯'); // trademark-allowed
    expect(script.narration).not.toContain('赔率');
    expect(script.narration).not.toContain('下场一定会赢');
  });

  it('proves the forbidden-term guard detects unfiltered copy (reverse assertion)', () => {
    const unsafe = 'World Cup 唯一预测：下场肯定会赢，赔率更低。'; // trademark-allowed
    expect(containsLaoliVideoForbiddenTerm(unsafe)).toBe(true);
    expect(containsLaoliVideoForbiddenTerm(sanitizeLaoliVideoText(unsafe))).toBe(false);
  });

  it('falls back safely when reports, events and stats are sparse', () => {
    const sparse: MatchData = {
      match: '巴西 vs 日本',
      competition: '国际大赛',
      date: '2026-06-20',
      final_score: '0:0',
      events: [],
      stats: {},
    };
    const script = buildLaoliVideoScript(sparse, {});
    expect(script.title).toContain('巴西 0:0 日本');
    expect(script.narration).toContain('双方把悬念留到了终场');
    expect(script.narration).toContain('数据和赛果都已经落定');
  });
});
