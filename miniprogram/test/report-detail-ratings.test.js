const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 战报详情「球员评分」卡:与战术卡同策略——downloadFile 服务端 PNG,200 才显;
// 无 players → 路由 404,非 200/binderror 整块隐藏(不打扰阅读)。

const root = join('miniprogram', 'pages', 'report-detail');

test('WXML 有球员评分卡块(showRatings 门 + 保存 + binderror 隐藏)', () => {
  const wxml = readFileSync(join(root, 'index.wxml'), 'utf8');
  assert.match(wxml, /球员评分/);
  assert.match(wxml, /wx:if="{{showRatings && ratingsImageSrc}}"/);
  assert.match(wxml, /bindtap="saveRatingsCardImage"/);
  assert.match(wxml, /binderror="onRatingsError"/);
});

test('JS:onLoad 拉评分卡、variant=ratings inline URL、200 才显', () => {
  const js = readFileSync(join(root, 'index.js'), 'utf8');
  assert.match(js, /loadRatingsImage\(reportId\)/); // onLoad 调用
  assert.match(js, /variant=ratings&inline=1/); // 走 ratings 路由
  assert.match(js, /statusCode === 200 && tempFilePath/); // 仅 200 显示
  assert.match(js, /showRatings: true/);
  assert.match(js, /onRatingsError\(\)/);
  assert.match(js, /saveRatingsCardImage\(\)/);
});

// 行为:loadRatingsImage 200→showRatings true;404(无 players)→保持 false 不显
function exercise(downloadResult) {
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test' }, track: () => {} });
  global.wx = {
    downloadFile: (o) => { o.success(downloadResult); },
    saveImageToPhotosAlbum: () => {},
    showToast: () => {},
  };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/report-detail/index.js')];
  require('../pages/report-detail/index.js');
  pageDef.setData = function (patch) { this.data = { ...this.data, ...patch }; };
  pageDef.data = { ...pageDef.data };
  pageDef.loadRatingsImage('r1');
  const showRatings = pageDef.data.showRatings;
  global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp;
  return showRatings;
}

test('loadRatingsImage:200 → 显示;404(无 players)→ 隐藏', () => {
  assert.strictEqual(exercise({ statusCode: 200, tempFilePath: '/tmp/r.png' }), true);
  assert.strictEqual(exercise({ statusCode: 404 }), false);
});
