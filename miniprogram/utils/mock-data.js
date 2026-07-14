const reportBody = [
  '上半场节奏被压得很碎，真正的转折来自中场身后的连续冲击。',
  '落后的一方并没有完全失控，只是每次推进都被迫在低价值区域完成射门。',
  '这场比赛最值得复盘的不是比分，而是谁更早接受了比赛的真实形状。',
];

const report = {
  id: 'mock-report-001',
  short_code: 'mock001',
  competition: '国际大赛小组赛',
  date: '2026.06.16',
  match: '巴西 2:1 西班牙',
  hardcore: {
    title: '巴西用效率拆开传控',
    subtitle: '控球不等于控制，射门质量才是答案',
    lead: '这是一场数据和体感互相拧巴的比赛。',
    body: reportBody,
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
    share_quote: '足球最残忍的地方，是它从不奖励过程完整的人。',
    tags: ['情绪流', '夜读战报'],
    premium_locked: false,
    stats: { possession: '42:58', shots: '11:14', xg: '1.90:1.40', shots_on: '5:4' },
  },
};

const routes = [
  [/^\/wx\/login$/, () => ({ data: { openid: 'mock_openid_001' } })],
  [/^\/matches\/today$/, () => ({ data: {
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
  } })],
  [/^\/reports\/recent$/, () => ({ data: Array.from({ length: 6 }, (_, i) => ({
    id: `r00${i + 1}`,
    short_code: `mock00${i + 1}`,
    match: ['巴西 2:1 西班牙', '法国 1:1 日本', '摩洛哥 1:0 葡萄牙', '荷兰 2:2 阿根廷', '德国 1:2 克罗地亚', '韩国 0:0 乌拉圭'][i],
    share_quote: ['控球率赢了，朋友圈文案输了。', '平局有时候比输球更像一次提醒。', '防守反击不是退让，是等你犯错。', '最后十分钟，足球把剧本撕了。', '强队最怕的不是落后，是急。', '零比零也能有火星。'][i],
    competition: '国际大赛小组赛',
    date: '2026.06.' + (16 + i),
  })) })],
  [/^\/report\/([^/]+)$/, (m) => ({ data: { ...report, id: m[1], short_code: m[1] } })],
  [/^\/me$/, () => ({ data: {
    user: { nickname: '老李的朋友', avatar: '', is_minor: false, guardian_consent: false },
    quotes: [{ id: 'q1', text: '控球率赢了，朋友圈文案输了。' }, { id: 'q2', text: '足球从不奖励过程完整的人。' }],
    payments: [{ id: 'p1', sku: 'deep_report', label: '赛事通', amount: 19, paid_at: '2026.06.16' }],
  } })],
  [/^\/chat\/rooms$/, () => ({ data: [] })],
  [/^\/track$/, () => ({ data: { ok: true } })],
  [/^\/payment\/create$/, (_m, _method, data) => ({ data: {
    ok: true,
    paymentId: 'mock-pay-001',
    sku: data && data.sku ? data.sku : 'deep_report',
    amountCents: data && data.sku === 'final_column' ? 900 : 1900,
    mock: true,
    payParams: {
      appId: 'mock_appid',
      timeStamp: '0',
      nonceStr: 'mocknonce',
      package: 'prepay_id=mock_wx',
      signType: 'RSA',
      paySign: 'mock_paysign',
    },
  } })],
  [/^\/avatar$/, (_m, _method, data) => (
    data && data.consent === true
      ? { data: { url: 'https://mock.qiuhoushuo.cn/fan-avatars/mock-avatar.png', request_id: 'mock-avatar-001' } }
      : { error: { errMsg: 'CONSENT_REQUIRED' } }
  )],
];

module.exports = { routes };
