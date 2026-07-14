const test = require('node:test');
const assert = require('node:assert');

// 赛事 tab 重设计回归:今日内排序(live 置顶)、直播比分轮询(仅有 live 才起/切后台停)、
// 比分变化一次性高亮、轮询单次失败静默保留上一帧不进错误态。
// 实走页面方法:mock wx.request / setTimeout / clearTimeout,手动控时序。

function makeEnv({ responses }) {
  // responses: 数组,每次 request 顺序取一条 { data } 或 { fail:true }
  const timers = [];
  const tracks = [];
  let reqCount = 0;
  const prev = {
    Page: global.Page, wx: global.wx, getApp: global.getApp,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
  };
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  global.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  global.getApp = () => ({
    globalData: { apiBase: 'https://api.test', aiNotice: 'AI' },
    track: (eventId, eventName, props) => tracks.push({ eventId, eventName, props }),
  });
  global.wx = {
    request: (opts) => {
      const r = responses[Math.min(reqCount, responses.length - 1)];
      reqCount += 1;
      if (r && r.fail) opts.fail({ errMsg: 'fail' });
      else opts.success({ statusCode: 200, data: (r && r.data) || {} });
    },
    pageScrollTo: () => {},
    showToast: () => {},
  };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/home/index.js')];
  require('../pages/home/index.js');
  pageDef.setData = function (patch) { this.data = { ...this.data, ...patch }; };
  return {
    page: pageDef, timers, tracks,
    get reqCount() { return reqCount; },
    restore() {
      global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp;
      global.setTimeout = prev.setTimeout; global.clearTimeout = prev.clearTimeout;
    },
  };
}

const mixedToday = {
  today: [
    { id: 'f', home_team: 'A', away_team: 'B', status: 'finished', home_score: 2, away_score: 1, kickoff: '18:00', competition: 'WC' },
    { id: 'l', home_team: 'C', away_team: 'D', status: 'live', home_score: 0, away_score: 0, kickoff: '21:00', competition: 'WC' },
    { id: 's', home_team: 'E', away_team: 'F', status: 'scheduled', kickoff: '23:00', competition: 'WC' },
  ],
  upcoming: [], finished: [],
};

test('今日内排序:live 置顶 → 未开赛 → 已完赛', () => {
  const env = makeEnv({ responses: [{ data: mixedToday }] });
  try {
    env.page.onShow();
    assert.deepStrictEqual(env.page.data.today.map((m) => m.id), ['l', 's', 'f']);
  } finally { env.restore(); }
});

test('焦点卡 heroMatch = 排序后首张(live 置顶),restToday 按开球正序', () => {
  const env = makeEnv({ responses: [{ data: mixedToday }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.page.data.heroMatch.id, 'l', 'live 场作今日焦点');
    // 其余比赛按开球时间正序(f 18:00 在 s 23:00 之前),不再沿用 sortToday 的完赛倒序
    assert.deepStrictEqual(env.page.data.restToday.map((m) => m.id), ['f', 's'], '其余按开球正序');
  } finally { env.restore(); }
});

test('全完赛日:焦点=最近一场,其余按开球时间正序(不倒排)', () => {
  // 真机场景(6/16):今天 4 场全完赛 00:00/03:00/06:00/09:00
  const allFinished = {
    today: [
      { id: 't00', home_team: 'A', away_team: 'B', status: 'finished', home_score: 0, away_score: 0, kickoff: '00:00', competition: 'WC' },
      { id: 't03', home_team: 'C', away_team: 'D', status: 'finished', home_score: 1, away_score: 1, kickoff: '03:00', competition: 'WC' },
      { id: 't06', home_team: 'E', away_team: 'F', status: 'finished', home_score: 1, away_score: 1, kickoff: '06:00', competition: 'WC' },
      { id: 't09', home_team: 'G', away_team: 'H', status: 'finished', home_score: 2, away_score: 2, kickoff: '09:00', competition: 'WC' },
    ],
    upcoming: [], finished: [],
  };
  const env = makeEnv({ responses: [{ data: allFinished }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.page.data.heroMatch.id, 't09', '焦点=最近一场(09:00)');
    // 其余顺时间:00:00 → 03:00 → 06:00(而非倒着 06/03/00)
    assert.deepStrictEqual(env.page.data.restToday.map((m) => m.id), ['t00', 't03', 't06'], '其余按开球正序');
  } finally { env.restore(); }
});

test('队名拆中文 + 结构化国旗(home_flag/away_flag.code)注入', () => {
  const data = { today: [{ id: 'x', home_team: 'Brazil', away_team: 'Japan', status: 'scheduled', kickoff: '20:00', competition: 'WC' }], upcoming: [], finished: [] };
  const env = makeEnv({ responses: [{ data }] });
  try {
    env.page.onShow();
    const m = env.page.data.today[0];
    assert.strictEqual(m.home_team, '巴西', '队名为纯中文,不前缀 emoji');
    assert.strictEqual(m.away_team, '日本');
    assert.strictEqual(m.home_flag.code, 'br', '主队 ISO 码由 emoji 反推');
    assert.strictEqual(m.away_flag.code, 'jp');
  } finally { env.restore(); }
});

test('服务端下发中文队名也能解出国旗(线上真实路径)', () => {
  // 线上 /matches/today 返回的是中文队名 + 冗长赛事名;此前 flagOf 按英文键查 → 全空白
  const data = { today: [{ id: 'x', home_team: '德国', away_team: '库拉索', status: 'scheduled', kickoff: '01:00', competition: '国际大赛 2026 - Group Stage - 1' }], upcoming: [], finished: [] };
  const env = makeEnv({ responses: [{ data }] });
  try {
    env.page.onShow();
    const m = env.page.data.today[0];
    assert.strictEqual(m.home_flag.code, 'de', '中文名也能解出国旗码');
    assert.strictEqual(m.away_flag.code, 'cw');
    assert.strictEqual(m.comp, '国际大赛 · 小组赛', '赛事名去年份+英文阶段中文化,不再溢出截断');
  } finally { env.restore(); }
});

test('有 live 才轮询:15s 拍;无 live 不轮询', () => {
  // 有 live
  let env = makeEnv({ responses: [{ data: mixedToday }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.timers.length, 1, '有 live → 安排一个轮询计时器');
    assert.strictEqual(env.timers[0].ms, 15000);
  } finally { env.restore(); }

  // 无 live(只有 finished)
  env = makeEnv({ responses: [{ data: { today: [{ id: 'f', home_team: 'A', away_team: 'B', status: 'finished', home_score: 1, away_score: 0, kickoff: '18:00', competition: 'WC' }], upcoming: [], finished: [] } }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.timers.length, 0, '无 live → 不轮询');
  } finally { env.restore(); }
});

test('onHide 停轮询', () => {
  const env = makeEnv({ responses: [{ data: mixedToday }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.timers[0].cleared, false);
    env.page.onHide();
    assert.strictEqual(env.timers[0].cleared, true, 'onHide 清掉轮询计时器');
  } finally { env.restore(); }
});

test('比分变化:轮询拿到新比分 → 该场打 scoreBump,高亮计时器到点清除', () => {
  const live10 = JSON.parse(JSON.stringify(mixedToday));
  live10.today.find((m) => m.id === 'l').home_score = 1; // 0:0 → 1:0
  const env = makeEnv({ responses: [{ data: mixedToday }, { data: live10 }] });
  try {
    env.page.onShow(); // 初始 0:0,安排轮询 timers[0]
    assert.strictEqual(env.timers[0].ms, 15000);
    env.timers[0].fn(); // 触发轮询 → 请求返回 1:0
    const liveItem = env.page.data.today.find((m) => m.id === 'l');
    assert.strictEqual(liveItem.home_score, 1);
    assert.strictEqual(liveItem.scoreBump, true, '比分变了 → 打高亮');
    // 找到高亮清除计时器(650ms)并触发
    const bump = env.timers.find((t) => t.ms === 650 && !t.cleared);
    assert.ok(bump, '应安排一次性高亮清除计时器');
    bump.fn();
    assert.strictEqual(env.page.data.today.find((m) => m.id === 'l').scoreBump, false, '动画后清除高亮');
  } finally { env.restore(); }
});

test('比分没变不打高亮', () => {
  const env = makeEnv({ responses: [{ data: mixedToday }, { data: mixedToday }] });
  try {
    env.page.onShow();
    env.timers[0].fn(); // 轮询,比分仍 0:0
    assert.ok(!env.page.data.today.find((m) => m.id === 'l').scoreBump, '比分未变 → 无高亮');
    assert.ok(!env.timers.some((t) => t.ms === 650), '无高亮计时器');
  } finally { env.restore(); }
});

test('轮询单次失败:静默保留上一帧,不进错误态,且继续下一拍', () => {
  const env = makeEnv({ responses: [{ data: mixedToday }, { fail: true }] });
  try {
    env.page.onShow();
    const before = env.page.data.today.map((m) => m.id);
    env.timers[0].fn(); // 轮询失败
    assert.strictEqual(env.page.data.loadError, false, '轮询失败不打错误态');
    assert.deepStrictEqual(env.page.data.today.map((m) => m.id), before, '保留上一帧');
    // 仍有 live → 继续安排下一拍(新计时器)
    const pending = env.timers.filter((t) => t.ms === 15000 && !t.cleared);
    assert.ok(pending.length >= 1, '失败后继续下一拍重试');
  } finally { env.restore(); }
});

test('首屏请求失败:进可重试错误态', () => {
  const env = makeEnv({ responses: [{ fail: true }] });
  try {
    env.page.onShow();
    assert.strictEqual(env.page.data.loadError, true);
    assert.strictEqual(env.page.data.loading, false);
  } finally { env.restore(); }
});

test('点开赛提醒 → 订阅开赛+战报两模板,允许的记到 /api/subscribe', () => {
  const env = makeEnv({ responses: [{ data: {} }] });
  try {
    const posted = [];
    const subTmpls = [];
    global.wx.request = (o) => { posted.push(o); if (o.success) o.success({ statusCode: 200, data: {} }); };
    global.wx.requestSubscribeMessage = (o) => { subTmpls.push(...o.tmplIds); const res = {}; o.tmplIds.forEach((t) => { res[t] = 'accept'; }); o.success(res); };
    global.wx.showToast = () => {};
    env.page.onShow();
    // 微信真机事件对象没有 stopPropagation()——故意不给,确保处理器不依赖它(回归:曾因 e.stopPropagation() 抛错致「点了没反应」)。
    env.page.toggleReminder({ currentTarget: { dataset: { id: 'm-uuid' } } });
    assert.strictEqual(subTmpls.length, 2, '一次订阅开赛+战报两模板');
    const sub = posted.find((o) => /\/subscribe$/.test(o.url));
    assert.ok(sub, '允许后应 POST /subscribe 记订阅');
    assert.strictEqual(sub.data.match_id, 'm-uuid');
    assert.deepStrictEqual(sub.data.kinds, ['match_start', 'report_ready']);
  } finally { env.restore(); }
});
