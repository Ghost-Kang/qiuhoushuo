const test = require('node:test');
const assert = require('node:assert');

// 收藏金句:report-detail saveQuote 写本地存储(saved_quotes),「我的」页读取/展开/删除。
// 此前 saveQuote 只 toast 不存、无处可看(用户报修)。本套件钉死持久化 + 查看 + 删除 + 去重。

function loadPage(file, { storage = {} } = {}) {
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const toasts = [];
  const store = { ...storage };
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    showToast: (o) => toasts.push(o),
    navigateTo: () => {}, switchTab: () => {}, pageScrollTo: () => {},
    request: () => {}, downloadFile: () => {}, requestSubscribeMessage: () => {},
    getDeviceInfo: () => ({ platform: 'android' }),
  };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test', aiNotice: 'AI', followedTeams: [] }, track: () => {} });
  let def;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve(file)];
  require(file);
  def.setData = function (p) { this.data = { ...this.data, ...p }; };
  def.data = { ...def.data };
  const restore = () => { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; };
  return { page: def, toasts, store, restore };
}

test('report-detail saveQuote 持久化到本地 saved_quotes + 提示去「我的」看', () => {
  const env = loadPage('../pages/report-detail/index.js');
  try {
    env.page.data = { ...env.page.data, report: { duanzi: { share_quote: '控球率赢了，朋友圈文案输了', title: '段子标题' } }, style: 'duanzi', reportId: 'r1' };
    env.page.saveQuote();
    const saved = env.store['saved_quotes'];
    assert.ok(Array.isArray(saved) && saved.length === 1, '写入一条到本地');
    assert.strictEqual(saved[0].text, '控球率赢了，朋友圈文案输了');
    assert.strictEqual(saved[0].reportId, 'r1');
    assert.match(env.toasts[env.toasts.length - 1].title, /我的/, 'toast 告知去哪看');
  } finally { env.restore(); }
});

test('saveQuote 同金句去重不重复写', () => {
  const env = loadPage('../pages/report-detail/index.js', { storage: { saved_quotes: [{ text: 'X', title: 't', reportId: 'r0', ts: 1 }] } });
  try {
    env.page.data = { ...env.page.data, report: { duanzi: { share_quote: 'X', title: 't' } }, style: 'duanzi', reportId: 'r0' };
    env.page.saveQuote();
    assert.strictEqual(env.store['saved_quotes'].length, 1, '已存在 → 不新增');
    assert.match(env.toasts[env.toasts.length - 1].title, /已收藏过/);
  } finally { env.restore(); }
});

test('「我的」页:onShow 读本地收藏 + 展开 + 删除', () => {
  const env = loadPage('../pages/me/index.js', {
    storage: { saved_quotes: [{ text: 'A', title: 't1', reportId: 'r1', ts: 2 }, { text: 'B', title: 't2', reportId: 'r2', ts: 1 }] },
  });
  try {
    env.page.onShow();
    assert.strictEqual(env.page.data.savedQuotes.length, 2, 'onShow 读本地收藏');
    env.page.toggleQuotes();
    assert.strictEqual(env.page.data.showQuotes, true, '点行展开列表');
    env.page.removeQuote({ currentTarget: { dataset: { idx: 0 } } });
    assert.strictEqual(env.page.data.savedQuotes.length, 1, '删一条');
    assert.strictEqual(env.store['saved_quotes'].length, 1, '本地存储同步删除');
    assert.strictEqual(env.page.data.savedQuotes[0].text, 'B', '删的是第 0 条');
  } finally { env.restore(); }
});

test('「我的」页:付费记录可展开/收起(默认收起)', () => {
  const env = loadPage('../pages/me/index.js', { storage: {} });
  try {
    env.page.onShow();
    assert.strictEqual(env.page.data.showPayments, false, '默认收起');
    env.page.togglePayments();
    assert.strictEqual(env.page.data.showPayments, true, '点行展开');
    env.page.togglePayments();
    assert.strictEqual(env.page.data.showPayments, false, '再点收起');
  } finally { env.restore(); }
});
