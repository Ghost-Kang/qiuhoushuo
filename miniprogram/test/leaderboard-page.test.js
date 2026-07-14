const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 射手榜/助攻榜页:拉 /api/leaderboard,英文队名→中文+国旗;切 tab;存图走 scoreboard 卡。

function loadPage(leaderboardData) {
  const calls = { downloads: [] };
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test' }, track: () => {} });
  global.wx = {
    showLoading: () => {}, hideLoading: () => {}, showToast: () => {},
    downloadFile: (o) => { calls.downloads.push(o.url); o.success && o.success({ statusCode: 200, tempFilePath: '/t.png' }); },
    saveImageToPhotosAlbum: (o) => o.success && o.success(),
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }) }),
  };
  // mock request util(页面 require '../../utils/api')
  const apiPath = require.resolve('../utils/api.js');
  delete require.cache[apiPath];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { request: ({ success }) => success({ data: leaderboardData }) } };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/leaderboard/index.js')];
  require('../pages/leaderboard/index.js');
  pageDef.setData = function (patch) { this.data = { ...this.data, ...patch }; };
  pageDef.data = { ...pageDef.data };
  return { page: pageDef, calls, restore() { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; delete require.cache[apiPath]; } };
}

const DATA = {
  scorers: [{ name: '梅西', team: 'Argentina', count: 5, apps: 2 }],
  assists: [{ name: '德布劳内', team: 'Belgium', count: 3, apps: 3 }],
  asof: '2026.06.27',
};

test('load:队名英→中 + 国旗,球员名用服务端中文', () => {
  const { page, restore } = loadPage(DATA);
  try {
    page.onLoad();
    assert.strictEqual(page.data.scorers[0].name, '梅西');
    assert.strictEqual(page.data.scorers[0].teamZh, '阿根廷');
    assert.ok(page.data.scorers[0].flag && typeof page.data.scorers[0].flag.code === 'string');
    assert.strictEqual(page.data.assists[0].teamZh, '比利时');
    assert.strictEqual(page.data.asof, '2026.06.27');
  } finally { restore(); }
});

test('onTab / onSwiperChange 切射手榜⇄助攻榜(左右滑动联动)', () => {
  const { page, restore } = loadPage(DATA);
  try {
    page.onLoad();
    page.onTab({ currentTarget: { dataset: { idx: 1 } } });
    assert.strictEqual(page.data.current, 1); // 点分段切助攻榜
    page.onSwiperChange({ detail: { current: 0 } });
    assert.strictEqual(page.data.current, 0); // 滑回射手榜
  } finally { restore(); }
});

test('saveCard 存 scoreboard 卡(inline)', () => {
  const { page, calls, restore } = loadPage(DATA);
  try {
    page.onLoad();
    page.saveCard();
    assert.match(calls.downloads[0], /\/card\/scoreboard\?inline=1/);
  } finally { restore(); }
});

test('WXML:射手榜/助攻榜分段 + 左右滑动 swiper + 国旗模板 + 存图', () => {
  const wxml = readFileSync(join('miniprogram', 'pages/leaderboard/index.wxml'), 'utf8');
  assert.match(wxml, /data-idx="0"/);
  assert.match(wxml, /data-idx="1"/);
  assert.match(wxml, /<swiper[^>]*bindchange="onSwiperChange"/); // 左右滑动切换
  assert.match(wxml, /is="flag"/);
  assert.match(wxml, /bindtap="saveCard"/);
});
