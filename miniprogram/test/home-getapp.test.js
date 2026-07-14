// Finding B 回归：入口页 home 在模块求值期 getApp() 未就绪（返回 undefined）也不能崩，
// 方法调用期 getApp() 就绪后须正常 loadMatches。旧代码顶层 `const app = getApp()` 缓存
// undefined → onShow 抛 → 首页永卡“加载中”（实测冷启动复现，mock/单测此前照不到）。
const test = require('node:test');
const assert = require('node:assert');

function loadHome({ getAppAtLoad, getAppAtCall, requestImpl }) {
  const apiPath = require.resolve('../utils/api.js');
  const cfgPath = require.resolve('../config.js');
  // 注入桩隔离真实 api/config（与 home `require('../../utils/api')` 解析到同一绝对路径）
  require.cache[apiPath] = {
    id: apiPath, filename: apiPath, loaded: true,
    exports: { request: requestImpl, requestSubscribeMessage: () => {} },
  };
  require.cache[cfgPath] = {
    id: cfgPath, filename: cfgPath, loaded: true,
    exports: { TMPL_MATCH_REMINDER: 'tmpl-x' },
  };
  delete require.cache[require.resolve('../pages/home/index.js')];
  global.getApp = getAppAtLoad;            // 模块求值期
  global.wx = { showToast: () => {}, navigateTo: () => {} };
  let def;
  global.Page = (d) => { def = d; };
  require('../pages/home/index.js');
  global.getApp = getAppAtCall;            // 方法调用期（惰性 app() 此刻才取）
  def.setData = function setData(patch) { this.data = { ...this.data, ...patch }; };
  return def;
}

test('home: 模块求值期 getApp() undefined 也不抛，onShow 正常 loadMatches', () => {
  let requested = false;
  const page = loadHome({
    getAppAtLoad: () => undefined,
    getAppAtCall: () => ({ globalData: { apiBase: 'https://x/api', aiNotice: '【AI 生成内容】' }, track: () => {} }),
    requestImpl: ({ url, success }) => {
      requested = true;
      assert.ok(url.endsWith('/matches/today'), 'loadMatches 应打 /matches/today');
      success({ data: { today: [{ id: 'm1', home_team: 'A', away_team: 'B', status: 'finished' }], upcoming: [] } });
    },
  });
  page.data = { today: [], upcoming: [], loading: true, aiNotice: '' };
  assert.doesNotThrow(() => page.onShow());
  assert.strictEqual(requested, true);
  assert.strictEqual(page.data.loading, false); // 不再永卡“加载中”
  assert.strictEqual(page.data.today.length, 1);
  assert.strictEqual(page.data.aiNotice, '【AI 生成内容】');
});

test('home: loadMatches 失败也置 loading=false（不卡“加载中”）', () => {
  const page = loadHome({
    getAppAtLoad: () => undefined,
    getAppAtCall: () => ({ globalData: { apiBase: 'https://x/api', aiNotice: '' }, track: () => {} }),
    requestImpl: ({ fail }) => fail({ errMsg: 'boom' }),
  });
  page.data = { today: [], upcoming: [], loading: true, aiNotice: '' };
  page.onShow();
  assert.strictEqual(page.data.loading, false);
});
