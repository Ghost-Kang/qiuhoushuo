const test = require('node:test');
const assert = require('node:assert');

// 隐私授权弹窗组件:微信「用户隐私保护指引」框架适配。钉死:① 注册 onNeedPrivacyAuthorization;
// ② 触发回调→弹窗 visible;③ 同意/拒绝把 resolve 以 agree/disagree 回传并关弹窗;④ 老基础库(无该接口)不注册不抛。

function loadComponent({ hasPrivacyApi = true } = {}) {
  const prev = { Component: global.Component, wx: global.wx };
  let captured = null;
  const opened = { contract: 0, page: '' };
  global.wx = {
    onNeedPrivacyAuthorization: hasPrivacyApi ? (cb) => { captured = cb; } : undefined,
    openPrivacyContract: () => { opened.contract += 1; },
    navigateTo: (o) => { opened.page = o.url; },
  };
  let def;
  global.Component = (d) => { def = d; };
  delete require.cache[require.resolve('../components/privacy-popup/index.js')];
  require('../components/privacy-popup/index.js');
  const inst = { data: { ...def.data }, setData(p) { this.data = { ...this.data, ...p }; } };
  Object.assign(inst, def.methods);
  const restore = () => { global.Component = prev.Component; global.wx = prev.wx; };
  return { inst, def, getCaptured: () => captured, opened, restore };
}

test('attached 注册 onNeedPrivacyAuthorization;触发→弹窗显示', () => {
  const env = loadComponent();
  try {
    env.def.lifetimes.attached.call(env.inst);
    const cb = env.getCaptured();
    assert.strictEqual(typeof cb, 'function', '已注册回调');
    let resolved = null;
    cb((r) => { resolved = r; });
    assert.strictEqual(env.inst.data.visible, true, '触发后弹窗显示');
    env.inst.onAgree();
    assert.deepStrictEqual(resolved, { event: 'agree', buttonId: 'agree-btn' }, '同意回传 agree + buttonId(微信要求,否则授权不生效)');
    assert.strictEqual(env.inst.data.visible, false, '同意后关弹窗');
  } finally { env.restore(); }
});

test('拒绝回传 disagree 并关弹窗', () => {
  const env = loadComponent();
  try {
    env.def.lifetimes.attached.call(env.inst);
    let resolved = null;
    env.getCaptured()((r) => { resolved = r; });
    env.inst.onDisagree();
    assert.deepStrictEqual(resolved, { event: 'disagree' });
    assert.strictEqual(env.inst.data.visible, false);
  } finally { env.restore(); }
});

test('查看指引/隐私页:openContract 调微信指引、openPrivacyPage 跳隐私政策', () => {
  const env = loadComponent();
  try {
    env.inst.openContract();
    assert.strictEqual(env.opened.contract, 1);
    env.inst.openPrivacyPage();
    assert.strictEqual(env.opened.page, '/pages/legal/index?doc=privacy');
  } finally { env.restore(); }
});

test('pageLifetimes.show 重注册(导航返回也生效)', () => {
  const env = loadComponent();
  try {
    env.def.pageLifetimes.show.call(env.inst);
    assert.strictEqual(typeof env.getCaptured(), 'function');
  } finally { env.restore(); }
});

test('老基础库无 onNeedPrivacyAuthorization → 不注册不抛', () => {
  const env = loadComponent({ hasPrivacyApi: false });
  try {
    assert.doesNotThrow(() => env.def.lifetimes.attached.call(env.inst));
    assert.strictEqual(env.getCaptured(), null);
    assert.strictEqual(env.inst.data.visible, false);
  } finally { env.restore(); }
});
