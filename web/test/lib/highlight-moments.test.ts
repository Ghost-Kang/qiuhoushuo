import { describe, expect, it } from 'vitest';
import { buildHighlightMoments, firstHighlightMoment } from '@/lib/api/highlight-moments';

describe('highlight moments', () => {
  it('builds visual moments from match score and stats', () => {
    const moments = buildHighlightMoments(
      { home_team: '巴西', away_team: '西班牙', home_score: 2, away_score: 1 },
      { shots: { home: 11, away: 14 }, xg: { home: 1.9, away: 1.4 } },
    );

    expect(moments).toHaveLength(3);
    expect(moments[0]).toMatchObject({
      id: 'score-turn',
      kind: 'goal',
      title: '巴西把比分写进镜头',
    });
    expect(moments[1]?.description).toContain('射门 11:14');
    expect(moments[1]?.description).toContain('xG 1.9:1.4');
    expect(moments.every((m) => m.image_prompt.includes('非真实'))).toBe(true);
  });

  it('falls back without stats', () => {
    const moment = firstHighlightMoment(
      { home_team: '法国', away_team: '日本', home_score: 0, away_score: 0 },
      null,
    );

    expect(moment.title).toBe('法国把比分写进镜头');
    expect(moment.description).toContain('法国 0:0 日本');
  });

  it('translates API-Football English team names for miniprogram highlight copy', () => {
    const moments = buildHighlightMoments(
      { home_team: 'Argentina', away_team: 'Saudi Arabia', home_score: 1, away_score: 2 },
      { shots: { home: 15, away: 3 }, xg: { home: 2.3, away: 0.5 } },
    );

    expect(moments[0]?.title).toBe('沙特阿拉伯把比分写进镜头');
    expect(moments[0]?.description).toContain('阿根廷 1:2 沙特阿拉伯');
    expect(moments[0]?.image_alt).toContain('阿根廷 对 沙特阿拉伯');
    expect(moments[1]?.title).toBe('阿根廷的连续冲击');
    expect(JSON.stringify(moments)).not.toContain('Argentina');
    expect(JSON.stringify(moments)).not.toContain('Saudi Arabia');
  });
});

describe('highlight moments 真实发生锚定（F63）', () => {
  const match = { home_team: 'Mexico', away_team: 'South Africa', home_score: 2, away_score: 0 };
  const statsWithVenue = { venue: { name: 'Estadio Azteca', city: 'Mexico City' } };
  const goals = [
    { minute: 28, type: 'goal', team: 'Mexico', player: 'R. Jiménez' },
    { minute: 75, type: 'goal', team: 'Mexico', player: 'S. Giménez' },
  ];

  it('grounds prompts in the real venue and the deciding goal minute/team', () => {
    const moments = buildHighlightMoments(match, statsWithVenue, goals);
    const scoreTurn = moments[0]!;
    expect(scoreTurn.minute).toBe('第75分钟'); // 最后一粒进球=锁定比分的瞬间
    expect(scoreTurn.title).toContain('墨西哥'); // 进球方,经 translateTeam 中文化
    expect(scoreTurn.image_prompt).toContain('Estadio Azteca');
    expect(scoreTurn.image_prompt).toContain('第75分钟');
    expect(scoreTurn.image_prompt).toContain('2:0');
    // 合规红线不动:真实化场景,不真实化人
    expect(moments.every((m) => m.image_prompt.includes('非真实'))).toBe(true);
    expect(moments.every((m) => m.image_prompt.includes('无可辨识人脸与队徽'))).toBe(true);
    // 三个镜头都锚定真实球场
    expect(moments.every((m) => m.image_prompt.includes('Estadio Azteca'))).toBe(true);
  });

  it('keeps the generic copy when events are absent (赛事事件未同步时不编造)', () => {
    const moments = buildHighlightMoments(match, statsWithVenue, null);
    expect(moments[0]!.minute).toBe('关键进球');
    expect(moments[0]!.image_prompt).not.toContain('第');
    expect(moments[0]!.image_prompt).toContain('Estadio Azteca'); // venue 仍可用
  });

  it('omits venue text when stats has no venue', () => {
    const moments = buildHighlightMoments(match, null, goals);
    expect(moments[0]!.image_prompt).not.toContain('Estadio');
    expect(moments[0]!.minute).toBe('第75分钟');
  });
});
