import { describe, expect, it } from 'vitest';
import { buildLaoliReelScript, containsLaoliVideoForbiddenTerm } from '@/lib/api/laoli-video-script';

const match = {
  match: '约旦 1:3 阿根廷',
  competition: '国际大赛',
  date: '2026-06-28',
  final_score: '1-3',
  events: [{ minute: 32, type: 'goal' as const, team: '阿根廷', player: '梅西' }],
  stats: { possession: { home: 27, away: 73 }, shots_on_target: { home: 3, away: 9 } },
};
const reports = {
  duanzi: { style: 'duanzi' as const, share_quote: '梅西最强打卡进球', title: 't', subtitle: 's', lead: 'l' },
  hardcore: { style: 'hardcore' as const, share_quote: 'q', title: '阿根廷效率碾压', subtitle: 's', lead: '控球率赢了比分也赢了' },
};

describe('buildLaoliReelScript', () => {
  it('4 段 + 画面映射 intro/outro→brief、event→highlight、data→ratings', () => {
    const s = buildLaoliReelScript(match, reports, { matchId: 'm1' });
    expect(s.version).toBe('laoli-reel-v1');
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
    expect(s.scenes.map((x) => x.kind)).toEqual(['intro', 'event', 'data', 'outro']);
    expect(s.scenes.map((x) => x.image)).toEqual(['brief', 'highlight', 'ratings', 'brief']);
    expect(s.matchId).toBe('m1');
  });

  it('各段按独立预算 clamp(intro40/event62/data56/outro34),总量不空', () => {
    const budgets = { intro: 40, event: 62, data: 56, outro: 34 } as const;
    const s = buildLaoliReelScript(match, reports);
    for (const sc of s.scenes) expect(sc.narration.length).toBeLessThanOrEqual(budgets[sc.kind as keyof typeof budgets]);
    expect(s.scenes.reduce((a, x) => a + x.narration.length, 0)).toBeGreaterThan(60);
  });

  it('event 段保得住进球事实(38字一刀切时代会被剪没)+ 罚丢点球/双响进事件行', () => {
    const dramatic = {
      ...match,
      events: [
        { minute: 14, type: 'penalty_missed' as const, team: '巴西', player: '吉马良斯' },
        { minute: 79, type: 'goal' as const, team: '挪威', player: '哈兰德' },
        { minute: 90, type: 'goal' as const, team: '挪威', player: '哈兰德' },
      ],
    };
    const s = buildLaoliReelScript(dramatic, reports);
    const eventScene = s.scenes.find((x) => x.kind === 'event')!;
    expect(eventScene.narration).toContain('罚丢点球');
    expect(eventScene.narration).toContain('哈兰德79、90分钟梅开二度');
  });

  it('反向:含「最」被清(最→更)、字幕=旁白、无禁词', () => {
    const s = buildLaoliReelScript(match, reports);
    for (const sc of s.scenes) {
      expect(sc.narration).not.toContain('最');
      expect(sc.subtitle).toBe(sc.narration);
      expect(containsLaoliVideoForbiddenTerm(sc.narration)).toBe(false);
    }
  });

  it('outro 走正式导流「超帧球后说」', () => {
    const s = buildLaoliReelScript(match, reports);
    expect(s.scenes[3]!.narration).toContain('超帧球后说');
  });
});
