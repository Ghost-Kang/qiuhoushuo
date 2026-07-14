const test = require('node:test');
const assert = require('node:assert');

global.getApp = () => ({
  globalData: { apiBase: 'https://qiuhoushuo.com/api' },
  track: () => {},
});
global.wx = {
  showToast: () => {},
  request: () => {},
  requestSubscribeMessage: () => {},
};

const api = require('../utils/api');
api._setUseMockForTest(true); // 本套用例验 mock 层契约；生产/内测默认 USE_MOCK=false 走真后端
const { request } = api;

function call(options) {
  return new Promise((resolve, reject) => {
    request({
      ...options,
      success: (res) => resolve(res),
      fail: (err) => reject(err),
    });
  });
}

test('returns matches', async () => {
  const res = await call({ url: '/matches/today' });
  assert.ok(res.data.today.length > 0);
});

test('returns report detail', async () => {
    const res = await call({ url: '/report/abc123' });
    assert.ok(typeof res.data.duanzi.title === 'string');
    assert.ok(res.data.duanzi.title.length > 0);
});

test('fails on missing route', async () => {
    await assert.rejects(() => call({ url: '/nonexistent' }));
});

// Finding B 回归（api 层）：request() 在 getApp() 未就绪时不抛、省略 x-openid；就绪后惰性注入
test('request 惰性取 app：未就绪不抛、省略 header；就绪注入 x-openid', () => {
  const savedGetApp = global.getApp;
  const savedReq = global.wx.request;
  let lastReq = null;
  global.wx.request = (opts) => { lastReq = opts; return opts; };
  api._setUseMockForTest(false); // 走真后端分支（header 计算路径）
  try {
    global.getApp = () => undefined; // 模拟模块求值期 app 未就绪
    assert.doesNotThrow(() => request({ url: 'https://x/api/matches/today' }));
    assert.deepStrictEqual(lastReq.header, {}); // 无 openid → 空 header，未抛

    global.getApp = () => ({ globalData: { apiBase: 'https://x/api', openid: 'mock_abc' } });
    request({ url: 'https://x/api/matches/today' });
    assert.strictEqual(lastReq.header['x-openid'], 'mock_abc'); // 惰性取到最新 openid
  } finally {
    global.getApp = savedGetApp;
    global.wx.request = savedReq;
    api._setUseMockForTest(true); // 恢复 mock 层，避免影响后续用例
  }
});

// 冷启动竞态回归:openid 未就绪 + 有 ensureOpenid → 不立即发,等登录拿到 openid 再带 x-openid 发。
// 修用户报修「首进战报一直生成、刷新才正常」(首请求缺 openid → 401 → 误显生成中)。
test('request 冷启动:openid 未就绪先等 ensureOpenid 再带 x-openid 发', async () => {
  const savedGetApp = global.getApp;
  const savedReq = global.wx.request;
  api._setUseMockForTest(false);
  let lastReq = null;
  global.wx.request = (opts) => { lastReq = opts; return opts; };
  const app = {
    globalData: { apiBase: 'https://x/api', openid: '' }, // 登录还没回
    ensureOpenid() {
      return Promise.resolve().then(() => { app.globalData.openid = 'late_openid'; return 'late_openid'; });
    },
  };
  global.getApp = () => app;
  try {
    request({ url: 'https://x/api/report/r1' });
    assert.strictEqual(lastReq, null, 'openid 未就绪 → 不立即发(等 ensureOpenid)');
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(lastReq, 'ensureOpenid 解决后才发');
    assert.strictEqual(lastReq.header['x-openid'], 'late_openid', '带上登录拿到的 openid,不再 401');
  } finally {
    global.getApp = savedGetApp;
    global.wx.request = savedReq;
    api._setUseMockForTest(true);
  }
});

test('request 转发 complete 给 wx.request(微信支付查单靠它触发 onPaid;此前漏转发致付费后不生成)', () => {
  const savedGetApp = global.getApp;
  const savedReq = global.wx.request;
  let lastReq = null;
  global.wx.request = (opts) => { lastReq = opts; return opts; };
  api._setUseMockForTest(false);
  global.getApp = () => ({ globalData: { apiBase: 'https://x/api', openid: 'o1' } });
  try {
    let completed = false;
    request({ url: 'https://x/api/payment/query', method: 'POST', data: { paymentId: 'p1' }, complete: () => { completed = true; } });
    assert.strictEqual(typeof lastReq.complete, 'function', 'complete 必须转发给 wx.request');
    lastReq.complete(); // 模拟微信回调 complete
    assert.strictEqual(completed, true, 'complete 被触发(→ onPaid → 生成)');
  } finally {
    global.getApp = savedGetApp;
    global.wx.request = savedReq;
    api._setUseMockForTest(true);
  }
});

test('request: HTTP 非 2xx 进入 fail 并携带 statusCode/data', async () => {
  const savedGetApp = global.getApp;
  const savedReq = global.wx.request;
  api._setUseMockForTest(false);
  global.getApp = () => ({ globalData: { apiBase: 'https://x/api', openid: 'openid-1' } });
  global.wx.request = (opts) => {
    opts.success({ statusCode: 413, data: { error: 'PAYLOAD_TOO_LARGE' } });
  };
  try {
    await assert.rejects(
      () => call({ url: 'https://x/api/avatar', method: 'POST', data: {} }),
      (err) => {
        assert.strictEqual(err.statusCode, 413);
        assert.deepStrictEqual(err.data, { error: 'PAYLOAD_TOO_LARGE' });
        assert.strictEqual(err.errMsg, 'HTTP_413');
        return true;
      },
    );
  } finally {
    global.getApp = savedGetApp;
    global.wx.request = savedReq;
    api._setUseMockForTest(true);
  }
});
