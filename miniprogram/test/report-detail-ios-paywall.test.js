const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 策略 C:微信小程序禁止 iOS 虚拟支付 → iOS 不在站内卖深度战报(不显示价格/不调起支付),
// 改引导关注服务号;安卓(及 devtools)仍走站内 jsapi_mini 付。本套件钉住该分支与防御。

const root = join('miniprogram', 'pages', 'report-detail');
const wxml = readFileSync(join(root, 'index.wxml'), 'utf8');
const js = readFileSync(join(root, 'index.js'), 'utf8');

function loadPage({ track = () => {}, wx } = {}) {
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test', aiNotice: 'AI' }, track });
  global.wx = wx || {};
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/report-detail/index.js')];
  require('../pages/report-detail/index.js');
  pageDef.setData = function setData(patch) { this.data = { ...this.data, ...patch }; };
  const restore = () => { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; };
  return { page: pageDef, restore };
}

test('AIGC 显著标识:战报(AI 文本生成)页顶部强提示横幅含"AI 生成"+"人工智能生成"(微信审核要求)', () => {
  assert.match(wxml, /class="aigc-banner"/, '需有显著 AIGC 横幅');
  assert.match(wxml, /AI 生成/);
  assert.match(wxml, /人工智能生成/);
});

test('付费墙按 isIOS 分支:iOS 走服务号引导,安卓保留 ¥19 站内付', () => {
  // iOS 分支
  assert.match(wxml, /wx:if="{{isIOS}}"/);
  assert.match(wxml, /bindtap="onIosFollowTap"/);
  assert.match(wxml, /关注服务号/);
  assert.match(wxml, /serviceAccountName/);
  // 安卓分支仍在(未被误删)
  assert.match(wxml, /data-sku="deep_report" bindtap="onPaywallTap"/);
  assert.match(wxml, /¥19 开通赛事通/);
});

test('iOS 默认关(非 iOS/取不到机型按安卓站内付,不误伤)', () => {
  assert.match(js, /isIOS:\s*false/);
  // onPaywallTap 顶部有 iOS 防御:即便按钮误显示也绝不在 iOS 调起站内支付
  assert.match(js, /if \(this\.data\.isIOS\) \{ this\.onIosFollowTap\(\); return; \}/);
});

test('_isIOSPlatform: ios→true, android/devtools→false, 异常→false', () => {
  // getDeviceInfo 优先
  let { page, restore } = loadPage({ wx: { getDeviceInfo: () => ({ platform: 'ios' }) } });
  assert.strictEqual(page._isIOSPlatform(), true);
  restore();

  ({ page, restore } = loadPage({ wx: { getDeviceInfo: () => ({ platform: 'android' }) } }));
  assert.strictEqual(page._isIOSPlatform(), false);
  restore();

  ({ page, restore } = loadPage({ wx: { getDeviceInfo: () => ({ platform: 'devtools' }) } }));
  assert.strictEqual(page._isIOSPlatform(), false, 'devtools 按非 iOS,便于模拟器调安卓付');
  restore();

  // 旧基础库无 getDeviceInfo → 回退 getSystemInfoSync
  ({ page, restore } = loadPage({ wx: { getSystemInfoSync: () => ({ platform: 'ios' }) } }));
  assert.strictEqual(page._isIOSPlatform(), true);
  restore();

  // 取机型抛错 → false(不误伤安卓付费)
  ({ page, restore } = loadPage({ wx: { getDeviceInfo: () => { throw new Error('boom'); } } }));
  assert.strictEqual(page._isIOSPlatform(), false);
  restore();
});

test('iOS 下 onPaywallTap 转服务号引导,绝不调起站内支付', () => {
  const calls = [];
  const { page, restore } = loadPage({ wx: { request: (...a) => calls.push(['request', ...a]) } });
  try {
    page.data = { ...page.data, isIOS: true, reportId: 'r1' };
    let followCalled = 0;
    page.onIosFollowTap = () => { followCalled += 1; };
    page.onPaywallTap({ currentTarget: { dataset: { sku: 'deep_report' } } });
    assert.strictEqual(followCalled, 1, '应转服务号引导');
    assert.strictEqual(calls.length, 0, '不应发起任何下单请求(无 wx.request)');
  } finally {
    restore();
  }
});

test('onIosFollowTap: 复制服务号名 + 弹窗指引 + 埋点带 platform=ios', () => {
  const tracks = [];
  const clips = [];
  const modals = [];
  const { page, restore } = loadPage({
    track: (eventId, eventName, props) => tracks.push({ eventId, eventName, props }),
    wx: {
      setClipboardData: ({ data, success }) => { clips.push(data); success && success(); },
      showModal: (opts) => modals.push(opts),
    },
  });
  try {
    page.data = { ...page.data, reportId: 'r-ios' };
    page.onIosFollowTap();

    assert.deepStrictEqual(clips, ['球后说'], '复制服务号名');
    assert.strictEqual(modals.length, 1);
    assert.strictEqual(modals[0].showCancel, false);
    assert.match(modals[0].content, /球后说/);
    assert.doesNotMatch(modals[0].content, /支付|付费|价格|¥/, '文案不出现支付字样,降合规风险');
    assert.deepStrictEqual(tracks, [{
      eventId: 'E021',
      eventName: 'paywall_click',
      props: { sku: 'deep_report', report_id: 'r-ios', platform: 'ios', action: 'follow_service' },
    }]);
  } finally {
    restore();
  }
});
