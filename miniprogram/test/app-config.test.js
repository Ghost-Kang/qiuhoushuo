const test = require('node:test');
const assert = require('node:assert');
const appConfig = require('../app.json');

// 6/1 决策（六视角评审 + PM）：小程序内"群聊"Tab 为空壳且不在营销路径上，
// 砍出 6/5 内测，社群导流走微信群机器人。本测试锁住该不变量，防止误回灌。
// 6/13：球迷形象生成提升为独立 tab（赛事/战报/球迷形象/我的），我的保持最右。
test('tabBar 为 4 个固定顺序，不含小程序内群聊', () => {
  const list = appConfig.tabBar.list;
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(
    list.map((t) => t.pagePath),
    ['pages/home/index', 'pages/reports/index', 'pages/fan-avatar/index', 'pages/me/index'],
  );
  assert.ok(!list.some((t) => t.pagePath.includes('chat')), '群聊 Tab 不应在 tabBar（导流走微信群机器人）');
});

test('球迷形象生成为独立 tab,图标齐全', () => {
  const fan = appConfig.tabBar.list.find((t) => t.pagePath === 'pages/fan-avatar/index');
  assert.ok(fan, '球迷形象应在 tabBar');
  assert.strictEqual(fan.text, '球迷形象');
  assert.match(fan.iconPath, /fan-avatar\.png$/);
  assert.match(fan.selectedIconPath, /fan-avatar-active\.png$/);
});

test('tabBar 数量在微信允许范围 2-5', () => {
  const n = appConfig.tabBar.list.length;
  assert.ok(n >= 2 && n <= 5, `tabBar 数量 ${n} 超出微信允许的 2-5`);
});
