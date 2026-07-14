const test = require('node:test');
const assert = require('node:assert');

// 淘汰赛对阵图页:展示 /api/card/bracket 整图 + 保存到相册。

function makeEnv({ downloadStatus = 200, tempFilePath = '/tmp/b.png', saveOk = true } = {}) {
  const calls = { download: [], save: [], toasts: [], tracks: [] };
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test' }, track: (...a) => calls.tracks.push(a) });
  global.wx = {
    showLoading: () => {}, hideLoading: () => {}, stopPullDownRefresh: () => {},
    showToast: (o) => calls.toasts.push(o.title),
    downloadFile: (o) => { calls.download.push(o.url); o.success && o.success({ statusCode: downloadStatus, tempFilePath: downloadStatus === 200 ? tempFilePath : '' }); },
    saveImageToPhotosAlbum: (o) => { calls.save.push(o.filePath); saveOk ? o.success && o.success() : o.fail && o.fail(); },
  };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/bracket/index.js')];
  require('../pages/bracket/index.js');
  pageDef.setData = function (patch) { this.data = { ...this.data, ...patch }; };
  pageDef.data = { ...pageDef.data };
  return { page: pageDef, calls, restore() { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; } };
}

test('onLoad 设置对阵图 inline URL（显示用北京小时戳 buster·非时间戳）', () => {
  const env = makeEnv();
  try {
    env.page.onLoad();
    assert.match(env.page.data.imgUrl, /\/card\/bracket\?inline=1&_t=\d{10}(?!\d)/, '显示 buster=北京小时戳(10 位),非 13 位时间戳');
    assert.doesNotMatch(env.page.data.imgUrl, /_t=\d{13}/, '进页显示不应用 Date.now(会每次重下整张图)');
    assert.strictEqual(env.page.data.loading, true);
  } finally { env.restore(); }
});

test('同小时内两次进页 URL 稳定 → wx 缓存命中秒开(不每次重下)', () => {
  const env = makeEnv();
  try {
    env.page.onLoad();
    const first = env.page.data.imgUrl;
    env.page.onLoad();
    assert.strictEqual(env.page.data.imgUrl, first, '同小时 URL 必须一致,否则 <image> 当新资源重下');
  } finally { env.restore(); }
});

test('下拉刷新强制拿最新(Date.now buster,与进页的小时戳不同)', () => {
  const env = makeEnv();
  try {
    env.page.onLoad();
    const hourUrl = env.page.data.imgUrl;
    env.page.onPullDownRefresh();
    assert.match(env.page.data.imgUrl, /_t=\d{13}/, '下拉刷新用 Date.now 强制最新');
    assert.notStrictEqual(env.page.data.imgUrl, hourUrl);
  } finally { env.restore(); }
});

test('onImgLoad 关闭 loading', () => {
  const env = makeEnv();
  try { env.page.onImgLoad(); assert.strictEqual(env.page.data.loading, false); }
  finally { env.restore(); }
});

test('saveImg 成功 → downloadFile + saveImageToPhotosAlbum + 已保存提示', () => {
  const env = makeEnv();
  try {
    env.page.saveImg();
    assert.strictEqual(env.calls.download.length, 1);
    assert.match(env.calls.download[0], /\/card\/bracket\?inline=1/);
    assert.deepStrictEqual(env.calls.save, ['/tmp/b.png']);
    assert.ok(env.calls.toasts.includes('已保存到相册'));
  } finally { env.restore(); }
});

test('saveImg 下载失败 → 提示生成失败,不存相册', () => {
  const env = makeEnv({ downloadStatus: 500 });
  try {
    env.page.saveImg();
    assert.strictEqual(env.calls.save.length, 0);
    assert.ok(env.calls.toasts.some((t) => /生成失败/.test(t)));
  } finally { env.restore(); }
});

test('saveImg 相册权限失败 → 提示检查权限', () => {
  const env = makeEnv({ saveOk: false });
  try {
    env.page.saveImg();
    assert.ok(env.calls.toasts.some((t) => /相册权限/.test(t)));
  } finally { env.restore(); }
});
