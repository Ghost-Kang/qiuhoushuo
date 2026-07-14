const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 小组积分榜页:_build 把英文队名→中文+国旗、净胜带符号、出线区 class,
// 并把全局淘汰赛对阵按队名反查归到各组「晋级后对阵」。

function loadPage() {
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test' }, track: () => {} });
  global.wx = { downloadFile: () => {}, saveImageToPhotosAlbum: () => {}, showLoading: () => {}, hideLoading: () => {}, showToast: () => {}, createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }) }) };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/standings/index.js')];
  require('../pages/standings/index.js');
  pageDef.setData = function (patch, cb) { this.data = { ...this.data, ...patch }; if (cb) cb(); };
  pageDef.data = { ...pageDef.data };
  return { page: pageDef, restore() { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; } };
}

const GROUPS = [{
  group: 'A',
  rows: [
    { rank: 1, team: 'Mexico', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, qualified: true },
    { rank: 2, team: 'Netherlands', played: 3, win: 2, draw: 0, lose: 1, goalsDiff: 3, points: 6, qualified: true },
    { rank: 4, team: 'Saudi Arabia', played: 3, win: 0, draw: 0, lose: 3, goalsDiff: -7, points: 0, qualified: false },
  ],
}];
const KO = [
  { home: 'Mexico', away: 'Canada', kickoffAt: '2026-06-28T19:00:00+00:00', round: 'Round of 32', status: 'NS' },
];

test('_build:英文队名→中文+国旗,净胜带符号,出线区 class', () => {
  const { page, restore } = loadPage();
  try {
    const built = page._build(GROUPS, []);
    const a = built[0];
    assert.strictEqual(a.id, 'A');
    assert.strictEqual(a.table[0].teamZh, '墨西哥');
    assert.ok(a.table[0].flag && typeof a.table[0].flag.code === 'string'); // flagOf 返 {code,emoji}
    assert.strictEqual(a.table[0].gdLabel, '+6');
    assert.strictEqual(a.table[2].gdLabel, '-7');
    assert.strictEqual(a.table[0].cls, 'q'); // rank1 出线区
    assert.strictEqual(a.table[2].cls, 'o'); // rank4 淘汰
  } finally { restore(); }
});

test('_build:出线队对手已抽出→对阵卡(标本组侧+中文轮次);未抽出→对手待定', () => {
  const { page, restore } = loadPage();
  try {
    // GROUPS: 墨西哥(出线·KO 有)、荷兰(出线·KO 无)、沙特(未出线)。KO 只有墨西哥 vs 加拿大。
    const nm = page._build(GROUPS, KO)[0].nextMatches;
    assert.strictEqual(nm.length, 2); // 墨西哥(对阵)+ 荷兰(待定);沙特未出线不展示
    const match = nm.find((m) => m.kind === 'match');
    assert.strictEqual(match.homeZh, '墨西哥');
    assert.strictEqual(match.awayZh, '加拿大');
    assert.strictEqual(match.homeIsThisGroup, true);
    assert.strictEqual(match.awayIsThisGroup, false);
    assert.strictEqual(match.roundZh, '32强赛');
    assert.match(match.dateLabel, /^6\/29 周一 03:00$/); // UTC 6/28 19:00 → 北京 6/29 03:00
    const tbd = nm.find((m) => m.kind === 'tbd');
    assert.strictEqual(tbd.teamZh, '荷兰'); // 出线但对手未抽出
  } finally { restore(); }
});

test('_build:出线队对手全未抽出 → 全部"对手待定"(非空)', () => {
  const { page, restore } = loadPage();
  try {
    const nm = page._build(GROUPS, [])[0].nextMatches;
    assert.strictEqual(nm.length, 2); // 墨西哥+荷兰 均待定
    assert.ok(nm.every((m) => m.kind === 'tbd'));
  } finally { restore(); }
});

// 修「出线显示2次」:一场淘汰赛对阵两队来自不同组,会同时进两队各自的组。锚定「本组队为主位」后,
// 各组只讲自家队的去向(巴西组讲"巴西→日本"、日本组讲"日本→巴西"),不再像同一张对阵卡被复制。
const GROUPS_CROSS = [
  { group: 'C', rows: [{ rank: 1, team: 'Brazil', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 5, points: 9, qualified: true }] },
  { group: 'F', rows: [{ rank: 1, team: 'Japan', played: 3, win: 2, draw: 1, lose: 0, goalsDiff: 3, points: 7, qualified: true }] },
];
const KO_CROSS = [{ home: 'Brazil', away: 'Japan', kickoffAt: '2026-06-30T19:00:00+00:00', round: 'Round of 32', status: 'NS' }];

test('_build:跨组同一场对阵→各组都锚定本组队为主位(修「日本/巴西在两组里看着重复2次」)', () => {
  const { page, restore } = loadPage();
  try {
    const built = page._build(GROUPS_CROSS, KO_CROSS);
    const c = built[0].nextMatches.find((m) => m.kind === 'match'); // C 组(巴西视角)
    const f = built[1].nextMatches.find((m) => m.kind === 'match'); // F 组(日本视角)
    assert.strictEqual(c.homeZh, '巴西'); // C 组锚定巴西为主位
    assert.strictEqual(c.homeIsThisGroup, true);
    assert.strictEqual(c.awayZh, '日本');
    // 关键:日本在原始对阵里是 away,F 组仍把它翻到主位 → 两张卡各讲各队,不是同一张被复制
    assert.strictEqual(f.homeZh, '日本');
    assert.strictEqual(f.homeIsThisGroup, true);
    assert.strictEqual(f.awayZh, '巴西');
    assert.strictEqual(f.awayIsThisGroup, false);
  } finally { restore(); }
});

test('_build:同组两队互相对阵 → 只显一张(去重),对手也标本组侧', () => {
  const { page, restore } = loadPage();
  try {
    const G = [{ group: 'X', rows: [
      { rank: 1, team: 'Brazil', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 5, points: 9, qualified: true },
      { rank: 2, team: 'Japan', played: 3, win: 2, draw: 0, lose: 1, goalsDiff: 2, points: 6, qualified: true },
    ] }];
    const KO = [{ home: 'Japan', away: 'Brazil', kickoffAt: '2026-06-30T19:00:00+00:00', round: 'Round of 32', status: 'NS' }];
    const matches = page._build(G, KO)[0].nextMatches.filter((m) => m.kind === 'match');
    assert.strictEqual(matches.length, 1); // 去重:同组两队互相对阵只显一张(非两张反向卡)
    assert.strictEqual(matches[0].awayIsThisGroup, true); // 对手也是本组队
  } finally { restore(); }
});

test('WXML/WXSS 结构:swiper 切组 + 国旗模板 + 晋级后对阵 + 存图', () => {
  const wxml = readFileSync(join('miniprogram', 'pages/standings/index.wxml'), 'utf8');
  assert.match(wxml, /<swiper[^>]*bindchange="onSwiperChange"/);
  assert.match(wxml, /is="flag"/); // 国旗模板
  assert.match(wxml, /晋级后对阵/);
  assert.match(wxml, /bindtap="saveCurrentGroup"/);
  assert.match(wxml, /bindtap="onTabTap"/); // 组导航
});
