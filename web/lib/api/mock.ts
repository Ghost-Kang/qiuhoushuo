export const reportBody = [
  '上半场节奏被压得很碎，真正的转折来自中场身后的连续冲击。',
  '落后的一方并没有完全失控，只是每次推进都被迫在低价值区域完成射门。',
  '这场比赛最值得复盘的不是比分，而是谁更早接受了比赛的真实形状。',
];

export const report = {
  id: 'mock-report-001',
  short_code: 'mock001',
  competition: '国际大赛小组赛',
  date: '2026.06.16',
  match: '巴西 2:1 西班牙',
  home_team: '巴西',
  away_team: '西班牙',
  home_score: 2,
  away_score: 1,
  highlight_moments: [
    {
      id: 'score-turn',
      kind: 'goal',
      minute: '关键进球',
      title: '巴西把比分写进镜头',
      description: '巴西 2:1 西班牙，这一下是整篇战报的主画面。',
      image_alt: '巴西对西班牙的比分关键镜头示意图',
      image_prompt: '足球比赛关键进球瞬间，巴西球员完成决定性一脚，球场灯光、禁区、观众席，电影感运动摄影，非真实球员肖像',
    },
    {
      id: 'pressure-wave',
      kind: 'pressure',
      minute: '压迫时刻',
      title: '西班牙的连续冲击',
      description: '射门 11:14，xG 1.90:1.40，镜头应该落在禁区前沿和二点球争夺。',
      image_alt: '西班牙连续压迫的战术镜头示意图',
      image_prompt: '足球比赛连续压迫镜头，禁区前沿多人冲刺、防守线后退、球在脚下高速移动，战术分析风格，非真实照片',
    },
  ],
  hardcore: {
    title: '巴西用效率拆开传控',
    subtitle: '控球不等于控制，射门质量才是答案',
    lead: '这是一场数据和体感互相拧巴的比赛。',
    body: reportBody,
    ending: '真正决定比赛的，是谁能把压力转化成更高质量的一脚。\n\n【AI 生成内容】',
    share_quote: '比分只有一球差，比赛的答案却藏在禁区前沿。',
    tags: ['数据战报', '战术复盘'],
    premium_locked: true,
    stats: { possession: '42:58', shots: '11:14', xg: '1.90:1.40', shots_on: '5:4' },
  },
  duanzi: {
    title: '传控传到冒烟，巴西一脚把灯关了',
    subtitle: '球可以多拿，机会不能乱花',
    lead: '西班牙像是在写论文，巴西像是在交答案。',
    body: reportBody,
    ending: '有些控球像铺垫，有些射门才像结论。\n\n【AI 生成内容】',
    share_quote: '控球率赢了，朋友圈文案输了。',
    tags: ['段子战报', '赛后两分钟'],
    premium_locked: false,
    stats: { possession: '42:58', shots: '11:14', xg: '1.90:1.40', shots_on: '5:4' },
  },
  emotion: {
    title: '有些比赛，是从错过第一脚开始输的',
    subtitle: '热闹之后，留下的是效率的安静惩罚',
    lead: '终场哨响时，最沉默的人往往最懂这场球。',
    body: reportBody,
    ending: '等热闹散去，比分会留下，遗憾也会留下。\n\n【AI 生成内容】',
    share_quote: '足球最残忍的地方，是它从不奖励过程完整的人。',
    tags: ['情绪流', '夜读战报'],
    premium_locked: false,
    stats: { possession: '42:58', shots: '11:14', xg: '1.90:1.40', shots_on: '5:4' },
  },
};

export function mockLogin(openid: string) {
  return { openid };
}

export function mockMatchesToday() {
  return {
    today: [
      { id: 'm001', home_team: '巴西', away_team: '西班牙', competition: '国际大赛小组赛', kickoff: '20:00', status: 'finished' },
      { id: 'm002', home_team: '法国', away_team: '日本', competition: '国际大赛小组赛', kickoff: '23:00', status: 'live' },
      { id: 'm003', home_team: '摩洛哥', away_team: '葡萄牙', competition: '国际大赛小组赛', kickoff: '明日 02:00', status: 'upcoming' },
    ],
    upcoming: [
      { id: 'm004', home_team: '荷兰', away_team: '阿根廷', kickoff_text: '明日 20:00' },
      { id: 'm005', home_team: '德国', away_team: '克罗地亚', kickoff_text: '明日 23:00' },
      { id: 'm006', home_team: '英格兰', away_team: '塞内加尔', kickoff_text: '周三 02:00' },
      { id: 'm007', home_team: '美国', away_team: '威尔士', kickoff_text: '周三 20:00' },
      { id: 'm008', home_team: '韩国', away_team: '乌拉圭', kickoff_text: '周三 23:00' },
    ],
    finished: [
      { id: 'm001', home_team: '巴西', away_team: '西班牙', home_score: 2, away_score: 1, competition: '国际大赛小组赛', date_text: '6/16 20:00' },
      { id: 'f002', home_team: '英格兰', away_team: '伊朗', home_score: 3, away_score: 0, competition: '国际大赛小组赛', date_text: '6/15 23:00' },
      { id: 'f003', home_team: '塞内加尔', away_team: '荷兰', home_score: 0, away_score: 2, competition: '国际大赛小组赛', date_text: '6/15 20:00' },
    ],
  };
}

/**
 * 原始 reports 行(每场 3 风格各一行,故意暴露去重场景)+ 相对今天/昨天/更早日期 +
 * 焦点战(大胜 3:0)+ 无看点平场。route 把它过 buildRecentReportsGroups 才成分组结构。
 */
export function mockRecentReports() {
  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now - offsetDays * 86400000).toISOString();
  const QUOTES: Record<string, string[]> = {
    duanzi: ['控球率赢了，朋友圈文案输了。', '平局有时候比输球更像一次提醒。', '零比零也能有火星。', '强队最怕的不是落后，是急。'],
    emotion: ['有些胜利是写给坚持的人看的。', '平局收场，心事未平。', '沉默的比分里藏着千言万语。', '落后从不是终点。'],
    hardcore: ['高位逼抢撕开三条线。', '双后腰锁死中场，0 射正。', '互交白卷的背后是两套保守。', '换人调整盘活右路。'],
  };
  const game = (i: number, code: string, home: string, away: string, hs: number, as: number, offsetDays: number) =>
    ['hardcore', 'duanzi', 'emotion'].map((style) => ({
      id: `${code}-${style}`,
      style,
      share_quote: QUOTES[style]![i],
      created_at: iso(offsetDays),
      is_premium: false,
      matches: {
        short_code: code, competition: '国际大赛小组赛',
        home_team: home, away_team: away, home_score: hs, away_score: as, match_date: iso(offsetDays),
      },
    }));
  return [
    ...game(0, 'mockA', '巴西', '阿根廷', 3, 0, 0), // 今天 · 大胜 → 焦点
    ...game(1, 'mockB', '韩国', '捷克', 2, 1, 0),   // 今天 · 标准卡
    ...game(2, 'mockC', '法国', '日本', 1, 1, 1),   // 昨天
    ...game(3, 'mockD', '德国', '西班牙', 0, 0, 3), // 更早 · 互交白卷
  ];
}

export function mockReport(id = 'mock001') {
  return { ...report, id, short_code: id };
}

export function mockMe() {
  return {
    user: { nickname: '老李的朋友', avatar: '', is_minor: false, guardian_consent: false },
    quotes: [{ id: 'q1', text: '控球率赢了，朋友圈文案输了。' }, { id: 'q2', text: '足球从不奖励过程完整的人。' }],
    payments: [{ id: 'p1', sku: 'deep_report', label: '赛事通', amount: 19, paid_at: '2026.06.16' }],
  };
}

export function mockChatRooms() {
  return [];
}
