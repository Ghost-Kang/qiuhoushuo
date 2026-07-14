import { describe, expect, it } from 'vitest';
import { buildMatchBriefCard, sanitizeCompetition } from '@/lib/api/match-brief-card';

describe('sanitizeCompetition (F67h 合规:赛事名商标词清洗)', () => {
  it('境外赛事商标词替换为中性"国际大赛",且不残留禁词', () => {
    const out = sanitizeCompetition('World Cup 2026 - Group Stage - 1'); // trademark-allowed
    expect(out).toBe('国际大赛 2026 · 小组赛第1轮');
    expect(out).not.toMatch(/world\s*cup/i);
    expect(out).not.toContain('FIF' + 'A');
  });

  it('赛段/轮次英文→中文(小组赛第N轮 / 32强赛 / 1/4决赛 等)', () => {
    expect(sanitizeCompetition('国际大赛 2026 - Group Stage - 3')).toBe('国际大赛 2026 · 小组赛第3轮');
    expect(sanitizeCompetition('World Cup - Round of 32')).toBe('国际大赛 · 32强赛'); // trademark-allowed
    expect(sanitizeCompetition('Round of 16')).toBe('16强赛');
    expect(sanitizeCompetition('Quarter-finals')).toBe('1/4决赛');
    expect(sanitizeCompetition('Semi-finals')).toBe('半决赛');
    expect(sanitizeCompetition('Final')).toBe('决赛');
    expect(sanitizeCompetition('Group Stage')).toBe('小组赛');
    // 不残留英文赛段词
    expect(sanitizeCompetition('Group Stage - 2')).not.toMatch(/group|stage/i);
  });

  it('边界:带限定词全名 / Final Round / Group Phase|A / Matchday / Qualification(审查 P3-3~5)', () => {
    expect(sanitizeCompetition('FIFA Club World Cup - Final')).toBe('国际大赛 · 决赛'); // trademark-allowed·无 Club/FIFA 孤儿
    expect(sanitizeCompetition("Women's World Cup - Semi-finals")).toBe('国际大赛 · 半决赛'); // trademark-allowed
    expect(sanitizeCompetition('World Cup - Final Round')).toBe('国际大赛 · 决赛轮'); // trademark-allowed·非"决赛 Round"
    expect(sanitizeCompetition('World Cup 2026 - Group Phase')).toBe('国际大赛 2026 · 小组赛'); // trademark-allowed
    expect(sanitizeCompetition('World Cup - Group A')).toBe('国际大赛 · A组'); // trademark-allowed·裸组字母
    expect(sanitizeCompetition('World Cup - Matchday 3')).toBe('国际大赛 · 第3轮'); // trademark-allowed
    expect(sanitizeCompetition('World Cup Qualification')).toBe('国际大赛 预选赛'); // trademark-allowed
    // 不残留 Club/Women's 限定词孤儿
    expect(sanitizeCompetition('FIFA Club World Cup')).not.toMatch(/club|fifa/i); // trademark-allowed
  });

  it('裸词只译单数 Final,不误吃赛事名里的复数 "Finals"(Global/Nations League Finals)', () => {
    // 复数 Finals 是赛事名的一部分,不应被译成"决赛"(否则 "Global Finals" → "Global 决赛")
    expect(sanitizeCompetition('Nations League Finals')).toBe('Nations League Finals');
    expect(sanitizeCompetition('Global Finals 2026 - Round of 32')).toBe('Global Finals 2026 · 32强赛');
  });

  it('清洗禁词的大小写变体 + 中文 + 首尾分隔符', () => {
    expect(sanitizeCompetition('FIFA 世界杯')).toBe('国际大赛'); // trademark-allowed
    expect(sanitizeCompetition('WORLD CUP Qualifier')).toBe('国际大赛 预选赛'); // trademark-allowed·Qualifier 现译预选赛
    expect(sanitizeCompetition('· 世界杯小组赛 ·')).toBe('国际大赛小组赛'); // trademark-allowed
  });

  it('无商标词原样返回;空值返空串', () => {
    expect(sanitizeCompetition('国际大赛小组赛')).toBe('国际大赛小组赛');
    expect(sanitizeCompetition(null)).toBe('');
    expect(sanitizeCompetition(undefined)).toBe('');
  });
});

describe('buildMatchBriefCard', () => {
  it('builds a stable one-image-understand card from match, reports, stats, and highlight moments', () => {
    const card = buildMatchBriefCard({
      id: 'match-1',
      competition: '国际大赛小组赛',
      date: '2026-06-16',
      home_team: '巴西',
      away_team: '西班牙',
      home_score: 2,
      away_score: 1,
      stats: { shots: { home: 11, away: 14 }, xg: { home: 1.9, away: 1.4 } },
    }, {
      hardcore: { title: '巴西用效率拆开传控', lead: '控球不等于控制。' },
      duanzi: { share_quote: '控球率赢了，朋友圈文案输了。' },
      emotion: { lead: '终场哨响时，最沉默的人最懂这场球。' },
    }, [{
      id: 'score-turn',
      kind: 'goal',
      minute: '关键进球',
      title: '巴西把比分写进镜头',
      description: '巴西 2:1 西班牙，这一下是整篇战报的主画面。',
      image_alt: '比分关键镜头示意图',
      image_prompt: '足球比赛关键进球瞬间',
      image_url: 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.png',
    }]);

    expect(card.schema_version).toBe('match_brief_card_v1');
    expect(card.title).toBe('一图看懂：巴西用效率拆开传控');
    expect(card.match_line).toContain('巴西 2:1 西班牙');
    expect(card.focus_tags).toContain('精彩镜头');
    expect(card.key_reasons[0]).toMatchObject({ title: '巴西把比分优势守到终场' });
    expect(card.data_points).toContainEqual({ label: 'xG', value: '1.9:1.4', note: '巴西更接近高质量机会' });
    expect(card.highlight_lens).toMatchObject({
      title: '巴西把比分写进镜头',
      image_url: 'https://img.qiuhoushuo.cn/highlight-images/match-1/score-turn.png',
    });
    expect(card.share_line).toBe('控球率赢了，朋友圈文案输了。');
  });

  it('falls back gracefully when only match text is available', () => {
    const card = buildMatchBriefCard({
      id: 'match-2',
      match: '法国 1:1 日本',
    }, {
      duanzi: { title: '平局也能有重点', stats: { shots: '8:10' } },
    }, []);

    expect(card.match_line).toContain('法国 1:1 日本');
    expect(card.focus_tags).toContain('拉锯战');
    expect(card.data_points[0]).toMatchObject({ label: '射门', value: '8:10' });
    expect(card.timeline[0]).toMatchObject({ minute: '赛后' });
  });

  it('关键时间线吃真实事件:进球带累计比分 + 红牌/点球,按分钟排序', () => {
    const card = buildMatchBriefCard({
      id: 'm-tl',
      home_team: 'Argentina',
      away_team: 'France',
      home_score: 2,
      away_score: 1,
      events: [
        { minute: 23, type: 'goal', team: 'Argentina', player: 'Messi' },
        { minute: 67, type: 'red_card', team: 'France', player: 'Dembele' },
        { minute: 80, type: 'penalty', team: 'France', player: 'Mbappe' },
        { minute: 88, type: 'goal', team: 'Argentina', player: 'Alvarez' },
      ],
    }, { hardcore: { title: '阿根廷险胜' } }, []);

    expect(card.timeline).toHaveLength(4);
    expect(card.timeline[0]).toEqual({ minute: '第23分钟', text: '阿根廷 · 梅西 1:0' });
    expect(card.timeline[1]).toEqual({ minute: '第67分钟', text: '法国 · 登贝莱 红牌' });
    expect(card.timeline[2]).toEqual({ minute: '第80分钟', text: '法国 · 姆巴佩 点球 1:1' });
    expect(card.timeline[3]).toEqual({ minute: '第88分钟', text: '阿根廷 · Alvarez 2:1' });
  });

  it('乌龙球:上游事件 team=受益方,直接按事件队记分(不再翻转)', () => {
    const card = buildMatchBriefCard({
      id: 'm-og',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 1,
      away_score: 0,
      events: [
        // API-Football 实测(fixture 1565178 哈尼乌龙):乌龙事件挂受益方名下,player=对方后卫。
        // 旧断言按"记给对方"翻转 → 双重翻转,澳埃战 55' 乌龙误显 0:2。
        { minute: 40, type: 'goal', team: 'Brazil', player: 'Pau', description: '乌龙球' },
      ],
    }, {}, []);

    // 巴西受益(西班牙球员 Pau 乌龙)→ 比分记给巴西(主) → 1:0
    expect(card.timeline[0]).toEqual({ minute: '第40分钟', text: '巴西 · Pau 乌龙 1:0' });
  });

  it('点球大战:逐轮不进常规时间线/累计比分,汇成一行;晋级方按互射比分', () => {
    const card = buildMatchBriefCard({
      id: 'm-pen',
      home_team: 'Australia',
      away_team: 'Egypt',
      home_score: 1,
      away_score: 1,
      stats: { possession: { home: 42, away: 58 } },
      events: [
        { minute: 13, type: 'goal', team: 'Egypt', player: 'E. Ashour', assist: 'K. Hafez' },
        { minute: 55, type: 'goal', team: 'Australia', player: 'M. Hany', description: '乌龙球' },
        // 点球大战逐轮(elapsed 120 + extra → minute>120),与对阵图 penScore 同口径
        { minute: 121, type: 'penalty_missed', team: 'Australia', player: 'A' },
        { minute: 121, type: 'penalty', team: 'Egypt', player: 'B' },
        { minute: 122, type: 'penalty', team: 'Australia', player: 'C' },
        { minute: 122, type: 'penalty', team: 'Egypt', player: 'D' },
        { minute: 123, type: 'penalty', team: 'Australia', player: 'E' },
        { minute: 123, type: 'penalty', team: 'Egypt', player: 'F' },
        { minute: 124, type: 'penalty_missed', team: 'Australia', player: 'G' },
        { minute: 124, type: 'penalty', team: 'Egypt', player: 'H' },
      ],
    }, {}, [{
      id: 'pen-moment',
      kind: 'goal',
      minute: '点球大战',
      title: '原始镜头标题',
      description: '互射瞬间',
      image_alt: '点球瞬间',
      image_prompt: '点球大战瞬间',
    }]);

    // 时间线:两粒常规进球 + 点球大战汇总行;8 轮逐轮不出现
    expect(card.timeline).toHaveLength(3);
    expect(card.timeline[0]!.text).toContain('0:1'); // 13' 埃及先开纪录
    expect(card.timeline[1]!.text).toContain('乌龙 1:1'); // 55' 乌龙记给受益方澳大利亚
    expect(card.timeline[2]).toEqual({ minute: '点球大战', text: '互射 2:4，埃及晋级' });
    // 摘要/标签/胜负关键①:晋级方=埃及(此前 LLM 只见 1:1 猜成澳大利亚)
    expect(card.one_sentence_summary).toContain('点球大战 2:4');
    expect(card.one_sentence_summary).toContain('埃及晋级');
    expect(card.focus_tags).toContain('点球大战');
    expect(card.key_reasons[0]!.title).toBe('点球大战 2:4，埃及晋级');
    // ② 效率:按常规时间战平口径,不能说晋级方"守住比分优势"
    expect(card.key_reasons[1]!.title).toBe('埃及掌控球权却未能取胜');
    // 代表镜头标题:点球大战定调,不出「哈尼 的制胜球」
    expect(card.highlight_lens!.title).toBe('点球大战一锤定音');
  });

  it('纯平局(无点球大战):代表镜头标题不安"制胜球",走兜底原标题', () => {
    const card = buildMatchBriefCard({
      id: 'm-draw',
      home_team: 'France',
      away_team: 'Japan',
      home_score: 1,
      away_score: 1,
      events: [
        { minute: 20, type: 'goal', team: 'France', player: 'Mbappe' },
        { minute: 70, type: 'goal', team: 'Japan', player: 'Kubo' },
      ],
    }, {}, [{
      id: 'draw-moment',
      kind: 'goal',
      minute: '关键进球',
      title: '拉锯战的定格瞬间',
      description: '扳平瞬间',
      image_alt: '扳平镜头',
      image_prompt: '扳平瞬间',
    }]);

    expect(card.highlight_lens!.title).toBe('拉锯战的定格瞬间');
    expect(card.focus_tags).toContain('拉锯战');
  });

  it('关键时间线:长球员名只取姓(行宽有限,全名会被切)', () => {
    const card = buildMatchBriefCard({
      id: 'm-name',
      home_team: 'USA',
      away_team: 'Turkey',
      home_score: 0,
      away_score: 1,
      events: [
        { minute: 90, type: 'goal', team: 'Turkey', player: 'Kenan Yildiz' },
      ],
    }, {}, []);

    expect(card.timeline[0]).toEqual({ minute: '第90分钟', text: '土耳其 · 耶尔德兹 0:1' });
  });

  it('关键时间线:纳入争议事件(VAR 改判 / 点球射失)', () => {
    const card = buildMatchBriefCard({
      id: 'm-var',
      home_team: 'Argentina',
      away_team: 'France',
      home_score: 1,
      away_score: 0,
      events: [
        { minute: 23, type: 'goal', team: 'Argentina', player: 'Messi' },
        { minute: 55, type: 'penalty_missed', team: 'France', player: 'Mbappe' },
        { minute: 70, type: 'var', team: 'Argentina', description: '进球被 VAR 吹无效' },
      ],
    }, {}, []);

    const texts = card.timeline.map((t) => t.text);
    expect(texts).toContain('阿根廷 · 梅西 1:0');
    expect(texts).toContain('法国 · 姆巴佩 点球射失');
    expect(texts).toContain('阿根廷 · 进球被 VAR 吹无效');
  });

  it('关键时间线:争议事件(红牌/点球/VAR/射失)超 4 行时优先于开放进球保留', () => {
    const card = buildMatchBriefCard({
      id: 'm-var-cap',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 3,
      away_score: 0,
      events: [
        { minute: 10, type: 'goal', team: 'Brazil', player: 'A' },
        { minute: 20, type: 'goal', team: 'Brazil', player: 'B' },
        { minute: 30, type: 'var', team: 'Spain', description: 'VAR 取消点球' },
        { minute: 60, type: 'red_card', team: 'Spain', player: 'C' },
        { minute: 80, type: 'goal', team: 'Brazil', player: 'D' },
      ],
    }, {}, []);

    expect(card.timeline).toHaveLength(4);
    const texts = card.timeline.map((t) => t.text);
    expect(texts).toContain('西班牙 · VAR 取消点球'); // 争议事件必留
    expect(texts).toContain('西班牙 · C 红牌');
  });

  it('代表镜头标题按本场特征生成(读秒绝杀),不再千篇一律', () => {
    const moment = { id: 'score-turn', kind: 'goal' as const, minute: '第90分钟', title: '土耳其把比分写进镜头', description: '主画面', image_alt: '', image_prompt: '', image_url: 'https://img/x.png' };
    const card = buildMatchBriefCard({
      id: 'hl-1',
      home_team: 'USA',
      away_team: 'Turkey',
      home_score: 1,
      away_score: 2,
      events: [
        { minute: 20, type: 'goal', team: 'USA', player: 'R' },
        { minute: 60, type: 'goal', team: 'Turkey', player: 'C' },
        { minute: 90, type: 'goal', team: 'Turkey', player: 'K' },
      ],
    }, {}, [moment]);

    expect(card.highlight_lens!.title).toBe('第90分钟读秒绝杀');
    expect(card.highlight_lens!.title).not.toContain('把比分写进镜头');
  });

  it('代表镜头标题:无进球(0:0)时兜底用镜头原标题', () => {
    const moment = { id: 'score-turn', kind: 'goal' as const, minute: '关键回合', title: '门前一役', description: '主画面', image_alt: '', image_prompt: '', image_url: 'https://img/x.png' };
    const card = buildMatchBriefCard({
      id: 'hl-2',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 0,
      away_score: 0,
      events: [],
    }, {}, [moment]);

    expect(card.highlight_lens!.title).toBe('门前一役');
  });

  it('关键时间线:进球带助攻者(关键球员·放不下队名退球员主视角)', () => {
    const card = buildMatchBriefCard({
      id: 'm-assist',
      home_team: 'USA',
      away_team: 'Turkey',
      home_score: 0,
      away_score: 1,
      events: [
        { minute: 10, type: 'goal', team: 'Turkey', player: 'A. Guler', assist: 'B. Yilmaz' },
      ],
    }, {}, []);

    expect(card.timeline[0]!.text).toBe('阿尔达·居莱尔（耶尔马兹 助）0:1');
  });

  it('关键时间线:同球员多球 → 梅开二度/帽子戏法(关键球员的关键事)', () => {
    const card = buildMatchBriefCard({
      id: 'm-brace',
      home_team: 'Argentina',
      away_team: 'Mexico',
      home_score: 3,
      away_score: 0,
      events: [
        { minute: 20, type: 'goal', team: 'Argentina', player: 'Messi' },
        { minute: 60, type: 'goal', team: 'Argentina', player: 'Messi' },
        { minute: 80, type: 'goal', team: 'Argentina', player: 'Messi' },
      ],
    }, {}, []);

    expect(card.timeline[0]!.text).toBe('阿根廷 · 梅西 1:0'); // 第 1 球普通
    expect(card.timeline[1]!.text).toBe('梅西 梅开二度 2:0');
    expect(card.timeline[2]!.text).toBe('梅西 帽子戏法 3:0');
  });

  it('代表镜头说明:有球员评分时用「全场最佳」(stats.players.motm)', () => {
    const moment = { id: 'score-turn', kind: 'goal' as const, minute: '第90分钟', title: 'X', description: '镜头描述', image_alt: '', image_prompt: '', image_url: 'https://img/x.png' };
    const card = buildMatchBriefCard({
      id: 'm-motm',
      home_team: 'Argentina',
      away_team: 'France',
      home_score: 2,
      away_score: 1,
      stats: { players: { motm: { name: 'L. Messi', team: 'Argentina', rating: 9.6, position: '前锋' } } },
      events: [{ minute: 90, type: 'goal', team: 'Argentina', player: 'Messi' }],
    }, {}, [moment]);

    expect(card.highlight_lens!.caption).toBe('全场最佳 梅西 · 9.6（阿根廷）');
  });

  it('代表镜头说明:整数评分规整为一位小数(7→7.0)', () => {
    const moment = { id: 'score-turn', kind: 'goal' as const, minute: '第90分钟', title: 'X', description: 'd', image_alt: '', image_prompt: '', image_url: 'https://img/x.png' };
    const card = buildMatchBriefCard({
      id: 'm-motm-int', home_team: 'Brazil', away_team: 'Spain', home_score: 1, away_score: 0,
      stats: { players: { motm: { name: 'Neymar', team: 'Brazil', rating: 7, position: '前锋' } } },
      events: [{ minute: 30, type: 'goal', team: 'Brazil', player: 'Neymar' }],
    }, {}, [moment]);
    expect(card.highlight_lens!.caption).toBe('全场最佳 内马尔 · 7.0（巴西）');
  });

  it('代表镜头说明:无球员评分时退回镜头描述', () => {
    const moment = { id: 'score-turn', kind: 'goal' as const, minute: '第90分钟', title: 'X', description: '镜头描述', image_alt: '', image_prompt: '', image_url: 'https://img/x.png' };
    const card = buildMatchBriefCard({
      id: 'm-nomotm', home_team: 'Argentina', away_team: 'France', home_score: 2, away_score: 1,
      events: [{ minute: 90, type: 'goal', team: 'Argentina', player: 'Messi' }],
    }, {}, [moment]);

    expect(card.highlight_lens!.caption).toBe('镜头描述');
  });

  it('事件超 4:红牌/点球必留,其余取较晚进球补满,再按时间排序', () => {
    const card = buildMatchBriefCard({
      id: 'm-cap',
      home_team: 'Germany',
      away_team: 'Italy',
      home_score: 4,
      away_score: 1,
      events: [
        { minute: 10, type: 'goal', team: 'Germany', player: 'A' },
        { minute: 20, type: 'goal', team: 'Germany', player: 'B' },
        { minute: 30, type: 'goal', team: 'Italy', player: 'C' },
        { minute: 75, type: 'red_card', team: 'Italy', player: 'D' },
        { minute: 82, type: 'goal', team: 'Germany', player: 'E' },
        { minute: 90, type: 'goal', team: 'Germany', player: 'F' },
      ],
    }, {}, []);

    expect(card.timeline).toHaveLength(4);
    expect(card.timeline.map((t) => t.minute)).toEqual(['第30分钟', '第75分钟', '第82分钟', '第90分钟']);
    // 累计比分遍历全部进球算,被裁掉的中段球不影响保留行比分
    expect(card.timeline.find((t) => t.minute === '第30分钟')!.text).toContain('2:1');
    expect(card.timeline.find((t) => t.minute === '第90分钟')!.text).toContain('4:1');
    expect(card.timeline.find((t) => t.minute === '第75分钟')!.text).toBe('意大利 · D 红牌');
  });

  it('无关键事件(只有黄牌/换人)时退回镜头兜底,不空行', () => {
    const card = buildMatchBriefCard({
      id: 'm-fb',
      home_team: 'Korea',
      away_team: 'Japan',
      home_score: 0,
      away_score: 0,
      events: [
        { minute: 50, type: 'yellow_card', team: 'Korea', player: 'X' },
        { minute: 70, type: 'substitution', team: 'Japan', player: 'Y' },
      ],
    }, {}, [{
      id: 'score-turn',
      kind: 'goal',
      minute: '关键回合',
      title: '门前一役',
      description: '镜头落在禁区前沿。',
      image_alt: '',
      image_prompt: '',
    }]);

    expect(card.timeline[0]).toEqual({ minute: '关键回合', text: '门前一役' });
  });

  it('translates API-Football team names to Chinese in quick-scan copy', () => {
    const card = buildMatchBriefCard({
      id: 'match-3',
      home_team: 'Argentina',
      away_team: 'Saudi Arabia',
      home_score: 1,
      away_score: 2,
      stats: { shots: { home: 15, away: 3 } },
    }, {
      hardcore: { title: '冷门之夜' },
      duanzi: { share_quote: '强弱预测被比分推翻。' },
    }, []);

    expect(card.match_line).toContain('阿根廷 1:2 沙特阿拉伯');
    expect(card.one_sentence_summary).toContain('阿根廷 1:2 沙特阿拉伯');
    expect(card.key_reasons[0]!.title).toBe('沙特阿拉伯把比分优势守到终场');
    expect(card.data_points[0]!).toMatchObject({ label: '射门', note: '阿根廷制造了更多尝试' });
  });

  it('数据证据:统计富集后填满 4 格(无 xG 时角球补位)+ 短注释', () => {
    const card = buildMatchBriefCard({
      id: 'm-data',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 3,
      away_score: 2,
      stats: {
        possession: { home: 45, away: 55 },
        shots: { home: 12, away: 9 },
        shots_on_target: { home: 5, away: 3 },
        corners: { home: 6, away: 4 },
        fouls: { home: 14, away: 10 },
      },
    }, { hardcore: { title: '补时绝杀' } }, []);

    expect(card.data_points).toHaveLength(4);
    expect(card.data_points.map((p) => p.label)).toEqual(['射门', '射正', '控球', '角球']);
    expect(card.data_points.find((p) => p.label === '角球')).toEqual({ label: '角球', value: '6:4', note: '巴西更多' });
  });

  it('数据证据:xG 在场时 xG/射门/射正/控球 优先,角球等让位', () => {
    const card = buildMatchBriefCard({
      id: 'm-data2',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 2,
      away_score: 1,
      stats: {
        xg: { home: 1.9, away: 1.4 },
        shots: { home: 12, away: 9 },
        shots_on_target: { home: 5, away: 3 },
        possession: { home: 45, away: 55 },
        corners: { home: 6, away: 4 },
      },
    }, {}, []);

    expect(card.data_points.map((p) => p.label)).toEqual(['xG', '射门', '射正', '控球']);
  });

  it('数据证据:持平项注释为「接近」', () => {
    const card = buildMatchBriefCard({
      id: 'm-data3',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 1,
      away_score: 1,
      stats: { corners: { home: 5, away: 5 } },
    }, {}, []);

    expect(card.data_points.find((p) => p.label === '角球')).toEqual({ label: '角球', value: '5:5', note: '接近' });
  });

  it('胜负关键:有事件+统计时三条都讲为什么赢(事件/效率/过程,互不重复)', () => {
    const card = buildMatchBriefCard({
      id: 'kr-1',
      home_team: 'USA',
      away_team: 'Turkey',
      home_score: 2,
      away_score: 3,
      stats: { possession: { home: 55, away: 45 }, shots_on_target: { home: 3, away: 5 } },
      events: [
        { minute: 12, type: 'goal', team: 'USA', player: 'P' },
        { minute: 28, type: 'goal', team: 'Turkey', player: 'Y' },
        { minute: 41, type: 'goal', team: 'USA', player: 'R' },
        { minute: 67, type: 'red_card', team: 'USA', player: 'A' },
        { minute: 73, type: 'penalty', team: 'Turkey', player: 'C' },
        { minute: 98, type: 'goal', team: 'Turkey', player: 'K' },
      ],
    }, { hardcore: { title: '土耳其逆转' } }, []);

    expect(card.key_reasons).toHaveLength(3);
    // ① 决定性事件:输球方(美国)染红
    expect(card.key_reasons[0]!.title).toContain('美国');
    expect(card.key_reasons[0]!.title).toContain('染红');
    // ② 效率:美国控球占优却告负(与数据证据讲反差,不堆原始数)
    expect(card.key_reasons[1]).toEqual({ title: '美国控球占优却效率告负', evidence: '美国控球 55%，射正 3:5，机会质量被土耳其反超。' });
    // ③ 过程:土耳其落后逆转
    expect(card.key_reasons[2]!.title).toBe('土耳其落后后完成逆转');
    // 不再出现旧的元标签/情绪条
    expect(card.key_reasons.map((r) => r.title)).not.toContain('数据解释比赛体感');
    expect(card.key_reasons.map((r) => r.title)).not.toContain('情绪落点清晰');
  });

  it('胜负关键:读秒绝杀 + 落后逆转(末段制胜)', () => {
    const card = buildMatchBriefCard({
      id: 'kr-2a',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 2,
      away_score: 1,
      events: [
        { minute: 20, type: 'goal', team: 'Spain', player: 'B' },
        { minute: 70, type: 'goal', team: 'Brazil', player: 'A' },
        { minute: 90, type: 'goal', team: 'Brazil', player: 'C' },
      ],
    }, {}, []);

    expect(card.key_reasons[0]!.title).toBe('巴西第90分钟读秒绝杀'); // 一球小胜 + 末段制胜球
    expect(card.key_reasons[2]!.title).toBe('巴西落后后完成逆转'); // 一度落后
  });

  it('胜负关键:全程领先 → 半场锁定 + 先发制人守住', () => {
    const card = buildMatchBriefCard({
      id: 'kr-2b',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 3,
      away_score: 1,
      events: [
        { minute: 10, type: 'goal', team: 'Brazil', player: 'A' },
        { minute: 35, type: 'goal', team: 'Brazil', player: 'B' },
        { minute: 60, type: 'goal', team: 'Spain', player: 'C' },
        { minute: 82, type: 'goal', team: 'Brazil', player: 'D' },
      ],
    }, {}, []);

    expect(card.key_reasons[0]!.title).toBe('巴西半场前就锁定胜局'); // 上半场已 2:0
    expect(card.key_reasons[2]!.title).toBe('巴西先发制人守住胜果'); // 领先从未被抹平
  });

  it('胜负关键:无事件无统计时降级为模板,且不含情绪条', () => {
    const card = buildMatchBriefCard({
      id: 'kr-3',
      home_team: 'Brazil',
      away_team: 'Spain',
      home_score: 2,
      away_score: 0,
    }, { hardcore: { lead: '巴西用高位逼抢锁死西班牙出球。' } }, []);

    expect(card.key_reasons[0]!.title).toBe('巴西把比分优势守到终场');
    expect(card.key_reasons.map((r) => r.title)).not.toContain('情绪落点清晰');
    expect(card.key_reasons[2]!.title).not.toContain('情绪');
  });
});
