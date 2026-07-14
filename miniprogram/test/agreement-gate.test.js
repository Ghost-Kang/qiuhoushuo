const test = require('node:test');
const assert = require('node:assert');

// 首启协议同意关卡(修审核失败原因1·不默认同意)。钉死:① 未同意→弹 + 收起原生 tabBar(硬门·堵 tab 切页绕过);
// ② 已同意→不弹、不动 tabBar;③ onAgree 存标志+关弹+恢复 tabBar+triggerEvent(agree);
// ④ onDisagree 弹 modal、不放行、不默认同意(退出→exitMiniProgram);⑤ openDoc 跳协议页;
// ⑥ pageLifetimes.show 复核:未同意→弹 + 收起 tabBar(防任何时序漏弹)。

function loadComponent({ agreed = false } = {}) {
  const prev = { Component: global.Component, wx: global.wx, getApp: global.getApp };
  const store = agreed ? { protocolAgreed_v1: true } : {};
  const calls = { navigate: '', modal: 0, exit: 0, triggered: '', modalOpts: null, privacyAgreed: 0, hideTab: 0, showTab: 0 };
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    navigateTo: (o) => { calls.navigate = o.url; },
    showModal: (o) => { calls.modal += 1; calls.modalOpts = o; },
    exitMiniProgram: () => { calls.exit += 1; },
    hideTabBar: () => { calls.hideTab += 1; },
    showTabBar: () => { calls.showTab += 1; },
  };
  // app.onPrivacyAgreed:同意后才触发登录/埋点(合规)。组件 onAgree 调它。
  global.getApp = () => ({ onPrivacyAgreed: () => { calls.privacyAgreed += 1; store.protocolAgreed_v1 = true; } });
  let def;
  global.Component = (d) => { def = d; };
  delete require.cache[require.resolve('../components/agreement-gate/index.js')];
  require('../components/agreement-gate/index.js');
  const inst = {
    data: { ...def.data },
    setData(p) { this.data = { ...this.data, ...p }; },
    triggerEvent(name) { calls.triggered = name; },
  };
  Object.assign(inst, def.methods);
  const restore = () => { global.Component = prev.Component; global.wx = prev.wx; global.getApp = prev.getApp; };
  return { inst, def, calls, store, restore };
}

test('未同意 → attached 弹关卡 + 收起原生 tabBar(硬门·堵 tab 切页绕过)', () => {
  const env = loadComponent({ agreed: false });
  try {
    env.def.lifetimes.attached.call(env.inst);
    assert.strictEqual(env.inst.data.visible, true);
    assert.strictEqual(env.calls.hideTab, 1, '未同意必须收起原生 tabBar,否则可点 tab 切页绕过');
  } finally { env.restore(); }
});

test('已同意 → attached 不弹、不动 tabBar(不打扰老用户)', () => {
  const env = loadComponent({ agreed: true });
  try {
    env.def.lifetimes.attached.call(env.inst);
    assert.strictEqual(env.inst.data.visible, false);
    assert.strictEqual(env.calls.hideTab, 0, '已同意不应收起 tabBar');
  } finally { env.restore(); }
});

test('未同意 → pageLifetimes.show 复核:弹关卡 + 收起 tabBar(防时序漏弹)', () => {
  const env = loadComponent({ agreed: false });
  try {
    env.def.pageLifetimes.show.call(env.inst);
    assert.strictEqual(env.inst.data.visible, true);
    assert.strictEqual(env.calls.hideTab, 1);
  } finally { env.restore(); }
});

test('已同意 → pageLifetimes.show 不弹、不动 tabBar', () => {
  const env = loadComponent({ agreed: true });
  try {
    env.def.pageLifetimes.show.call(env.inst);
    assert.strictEqual(env.inst.data.visible, false);
    assert.strictEqual(env.calls.hideTab, 0);
  } finally { env.restore(); }
});

test('onAgree:调 app.onPrivacyAgreed(同意后才采集)+ 存标志 + 关弹 + 恢复 tabBar + triggerEvent(agree)', () => {
  const env = loadComponent({ agreed: false });
  try {
    env.def.lifetimes.attached.call(env.inst);
    env.inst.onAgree();
    assert.strictEqual(env.calls.privacyAgreed, 1, 'onAgree 应通知 app.onPrivacyAgreed 才采集');
    assert.strictEqual(env.store.protocolAgreed_v1, true);
    assert.strictEqual(env.inst.data.visible, false);
    assert.strictEqual(env.calls.showTab, 1, '同意后应恢复原生 tabBar');
    assert.strictEqual(env.calls.triggered, 'agree');
  } finally { env.restore(); }
});

test('onDisagree:不放行、不默认同意(visible 仍 true、未存同意),退出→exitMiniProgram', () => {
  const env = loadComponent({ agreed: false });
  try {
    env.def.lifetimes.attached.call(env.inst);
    env.inst.onDisagree();
    assert.strictEqual(env.calls.modal, 1);
    assert.strictEqual(env.inst.data.visible, true); // 不放行
    assert.strictEqual(env.store.protocolAgreed_v1, undefined); // 关键:不默认同意
    env.calls.modalOpts.success({ cancel: true }); // 选「退出」
    assert.strictEqual(env.calls.exit, 1);
  } finally { env.restore(); }
});

test('openDoc 跳对应协议页', () => {
  const env = loadComponent();
  try {
    env.inst.openDoc({ currentTarget: { dataset: { doc: 'privacy' } } });
    assert.match(env.calls.navigate, /doc=privacy/);
  } finally { env.restore(); }
});
