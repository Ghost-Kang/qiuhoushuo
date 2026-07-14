const test = require('node:test');
const assert = require('node:assert');

// 首启同意页(pages/consent):合规不变量——
// ① 点「同意并开始」才置标志 + 触发 app.onPrivacyAgreed(此刻起才采集)+ reLaunch 进首页;
// ② 点「不同意」弹二次确认,选「退出」才 exitMiniProgram,不默认放行;
// ③ 点协议链接 navigateTo 到 legal 阅读原文。
// 不默认勾选、不默认同意——修微信审核「默认自动同意《用户协议》《隐私政策》」。

function loadPage({ hasApp = true } = {}) {
  const store = {};
  const calls = { reLaunch: [], navigateTo: [], modal: [], exit: 0, onPrivacyAgreed: 0 };
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    reLaunch: (o) => { calls.reLaunch.push(o.url); },
    navigateTo: (o) => { calls.navigateTo.push(o.url); },
    exitMiniProgram: () => { calls.exit += 1; },
    showModal: (o) => { calls.modal.push(o); },
  };
  global.getApp = () => (hasApp ? { onPrivacyAgreed: () => { calls.onPrivacyAgreed += 1; store.protocolAgreed_v1 = true; } } : undefined);
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/consent/index.js')];
  require('../pages/consent/index.js');
  pageDef.setData = function setData(patch) { this.data = { ...this.data, ...patch }; };
  const restore = () => { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; };
  return { page: pageDef, calls, store, restore };
}

test('同意并开始:调 app.onPrivacyAgreed + reLaunch 到首页', () => {
  const env = loadPage();
  try {
    env.page.onAgree();
    assert.strictEqual(env.calls.onPrivacyAgreed, 1, '走 app 采集入口');
    assert.strictEqual(env.store.protocolAgreed_v1, true, '同意标志落库');
    assert.deepStrictEqual(env.calls.reLaunch, ['/pages/home/index'], '同意后进首页');
  } finally { env.restore(); }
});

test('无 app 兜底:仍直接落同意标志 + 进首页', () => {
  const env = loadPage({ hasApp: false });
  try {
    env.page.onAgree();
    assert.strictEqual(env.store.protocolAgreed_v1, true);
    assert.deepStrictEqual(env.calls.reLaunch, ['/pages/home/index']);
  } finally { env.restore(); }
});

test('不同意:弹确认;选「退出」才 exit,不默认放行', () => {
  const env = loadPage();
  try {
    env.page.onDisagree();
    assert.strictEqual(env.calls.modal.length, 1, '应二次确认');
    assert.strictEqual(env.calls.reLaunch.length, 0, '不同意不放行(不进首页)');
    // 模拟用户点「退出」(cancel)
    env.calls.modal[0].success({ cancel: true });
    assert.strictEqual(env.calls.exit, 1, '选退出才 exitMiniProgram');
  } finally { env.restore(); }
});

test('不同意→再看看:不退出、不放行(留在同意页)', () => {
  const env = loadPage();
  try {
    env.page.onDisagree();
    env.calls.modal[0].success({ confirm: true, cancel: false });
    assert.strictEqual(env.calls.exit, 0, '再看看不退出');
    assert.strictEqual(env.calls.reLaunch.length, 0, '仍不放行');
  } finally { env.restore(); }
});

test('点协议链接:navigateTo 到 legal 阅读原文', () => {
  const env = loadPage();
  try {
    env.page.openDoc({ currentTarget: { dataset: { doc: 'privacy' } } });
    assert.deepStrictEqual(env.calls.navigateTo, ['/pages/legal/index?doc=privacy']);
  } finally { env.restore(); }
});
