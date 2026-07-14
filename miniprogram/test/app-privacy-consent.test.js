const test = require('node:test');
const assert = require('node:assert');

// 合规不变量(修微信审核「默认自动同意《用户服务协议》及《隐私政策》」):
// **同意前绝不采集任何用户信息**——不 wx.login 取 openid、不发埋点;用户在协议关卡主动同意后才采集。

function loadApp({ agreed = false, currentRoute = 'pages/home/index' } = {}) {
  const store = agreed ? { protocolAgreed_v1: true } : {};
  const calls = { login: 0, requests: [], reLaunch: [] };
  const queued = [];
  const prev = { App: global.App, wx: global.wx, getCurrentPages: global.getCurrentPages };
  let route = currentRoute;
  global.getCurrentPages = () => [{ route }];
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    login: (o) => { calls.login += 1; o.success && o.success({ code: 'CODE' }); },
    reLaunch: (o) => { calls.reLaunch.push(o.url); },
  };
  const tqPath = require.resolve('../utils/track-queue.js');
  const apiPath = require.resolve('../utils/api.js');
  const mgPath = require.resolve('../utils/minor-guard.js');
  const orig = { tq: require.cache[tqPath], api: require.cache[apiPath], mg: require.cache[mgPath] };
  require.cache[tqPath] = { id: tqPath, filename: tqPath, loaded: true, exports: { enqueue: (e) => queued.push(e), flush: () => {} } };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    request: (o) => { calls.requests.push(o.url); if (/wx\/login/.test(o.url)) o.success && o.success({ data: { openid: 'OID' } }); },
  } };
  require.cache[mgPath] = { id: mgPath, filename: mgPath, loaded: true, exports: { maybeShowMinorUsageNotice: () => {} } };
  let appDef;
  global.App = (def) => { appDef = def; };
  delete require.cache[require.resolve('../app.js')];
  require('../app.js');
  const inst = {};
  Object.assign(inst, appDef);
  inst.globalData = { ...appDef.globalData };
  inst.loginPromise = null;
  inst._consentWaiters = null;
  const restore = () => {
    global.App = prev.App; global.wx = prev.wx; global.getCurrentPages = prev.getCurrentPages;
    require.cache[tqPath] = orig.tq; require.cache[apiPath] = orig.api; require.cache[mgPath] = orig.mg;
  };
  return { inst, calls, store, queued, restore, setRoute: (r) => { route = r; } };
}

test('未同意:onLaunch 不发起 wx.login(不采集 openid)', () => {
  const env = loadApp({ agreed: false });
  try {
    env.inst.onLaunch();
    assert.strictEqual(env.inst.globalData.privacyAgreed, false);
    assert.strictEqual(env.calls.login, 0, '同意前不应 wx.login');
    assert.ok(!env.calls.requests.some((u) => /wx\/login/.test(u)), '同意前不应打登录接口');
  } finally { env.restore(); }
});

test('已同意老用户:onLaunch 即登录(不打扰)', () => {
  const env = loadApp({ agreed: true });
  try {
    env.inst.onLaunch();
    assert.strictEqual(env.inst.globalData.privacyAgreed, true);
    assert.strictEqual(env.calls.login, 1, '已同意应启动即登录');
  } finally { env.restore(); }
});

test('未同意:track 排队不发(不采集行为数据)', () => {
  const env = loadApp({ agreed: false });
  try {
    env.inst.onLaunch();
    env.inst.track('E001', 'app_open', {});
    assert.strictEqual(env.queued.length, 1, '同意前埋点应排队');
    assert.ok(!env.calls.requests.some((u) => /\/track/.test(u)), '同意前不应发埋点');
  } finally { env.restore(); }
});

test('onPrivacyAgreed:用户主动同意后才采集(登录 + 置标志)', () => {
  const env = loadApp({ agreed: false });
  try {
    env.inst.onLaunch();
    assert.strictEqual(env.calls.login, 0);
    env.inst.onPrivacyAgreed();
    assert.strictEqual(env.inst.globalData.privacyAgreed, true);
    assert.strictEqual(env.store.protocolAgreed_v1, true, '同意标志落库');
    assert.strictEqual(env.calls.login, 1, '同意后才登录');
  } finally { env.restore(); }
});

// —— app 级单一卡口:未同意任何冷启/深链都 reLaunch 到专用同意页(堵审核器直接加载无门页绕过) ——

test('未同意:onLaunch 强制 reLaunch 到 /pages/consent/index', () => {
  const env = loadApp({ agreed: false });
  try {
    env.inst.onLaunch();
    assert.deepStrictEqual(env.calls.reLaunch, ['/pages/consent/index'], '未同意冷启必进同意页');
  } finally { env.restore(); }
});

test('已同意:onLaunch 不跳同意页(不打扰老用户)', () => {
  const env = loadApp({ agreed: true });
  try {
    env.inst.onLaunch();
    assert.strictEqual(env.calls.reLaunch.length, 0, '已同意不应再跳同意页');
  } finally { env.restore(); }
});

test('未同意:onShow 兜底 reLaunch(热启/onLaunch 未生效时)', () => {
  const env = loadApp({ agreed: false, currentRoute: 'pages/bracket/index' });
  try {
    env.inst.onShow(); // 停在无门页 bracket 且未同意 → 拦回同意页
    assert.deepStrictEqual(env.calls.reLaunch, ['/pages/consent/index']);
  } finally { env.restore(); }
});

test('未同意但已在同意页/协议页:onShow 不再跳(防死循环 + 可读协议原文)', () => {
  for (const route of ['pages/consent/index', 'pages/legal/index']) {
    const env = loadApp({ agreed: false, currentRoute: route });
    try {
      env.inst.onShow();
      assert.strictEqual(env.calls.reLaunch.length, 0, `${route} 不应再被拦`);
    } finally { env.restore(); }
  }
});

test('已同意:onShow 不跳同意页(正常放行)', () => {
  const env = loadApp({ agreed: true, currentRoute: 'pages/me/index' });
  try {
    env.inst.onLaunch(); // 真机时序:onLaunch 先跑,从 storage 置 privacyAgreed=true
    env.inst.onShow();
    assert.strictEqual(env.calls.reLaunch.length, 0);
  } finally { env.restore(); }
});

test('ensureOpenid:同意前挂起不登录,同意后解决', async () => {
  const env = loadApp({ agreed: false });
  try {
    env.inst.onLaunch();
    const p = env.inst.ensureOpenid(); // 同意前调用 → 挂起,不登录
    assert.strictEqual(env.calls.login, 0, '同意前 ensureOpenid 不应 wx.login');
    env.inst.onPrivacyAgreed(); // 同意 → 触发登录 → 解决挂起的 promise
    const openid = await p;
    assert.strictEqual(openid, 'OID');
    assert.strictEqual(env.calls.login, 1);
  } finally { env.restore(); }
});
