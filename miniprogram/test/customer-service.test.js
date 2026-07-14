const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 客服/反馈:小程序自带客服(open-type=contact)。留言落小程序后台「客服消息」,手机「小程序客服」助手可回。
const root = join('miniprogram');

test('客服页是小程序自带客服(open-type=contact),不再是占位', () => {
  const wxml = readFileSync(join(root, 'pages/customer-service/index.wxml'), 'utf8');
  assert.match(wxml, /open-type="contact"/, '有原生客服按钮');
  assert.match(wxml, /bindcontact="onContact"/, '进入客服会话有埋点回调');
  assert.doesNotMatch(wxml, /即将上线/, '不再是「即将上线」占位');
});

test('客服页 onContact 记一次有效埋点', () => {
  const prev = { Page: global.Page, getApp: global.getApp };
  const tracks = [];
  global.getApp = () => ({ globalData: { aiNotice: 'AI' }, track: (id, name) => tracks.push({ id, name }) });
  let def;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve('../pages/customer-service/index.js')];
  require('../pages/customer-service/index.js');
  try {
    def.onContact();
    assert.strictEqual(tracks.length, 1, '点客服记一次');
    assert.match(tracks[0].id, /^E(00[1-9]|0[1-9]\d|099)$/, 'event_id 在 /track 允许的 E001-E099 范围');
    assert.strictEqual(tracks[0].name, 'customer_service_open');
  } finally {
    global.Page = prev.Page; global.getApp = prev.getApp;
  }
});
