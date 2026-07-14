const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 赛事 tab「赛事榜单」入口(置顶):射手榜/助攻榜 + 小组积分榜,点进端内详情页(页内看内容 + 存图)。

function makeEnv() {
  const navs = [];
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: { apiBase: 'https://api.test' }, track: () => {} });
  global.wx = { navigateTo: (o) => navs.push(o.url) };
  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/home/index.js')];
  require('../pages/home/index.js');
  pageDef.setData = function (patch) { this.data = { ...this.data, ...patch }; };
  pageDef.data = { ...pageDef.data };
  return { page: pageDef, navs, restore() { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; } };
}

test('goLeaderboard → 跳射手榜/助攻榜页', () => {
  const env = makeEnv();
  try { env.page.goLeaderboard(); assert.deepStrictEqual(env.navs, ['/pages/leaderboard/index']); }
  finally { env.restore(); }
});

test('goStandings → 跳小组积分榜页', () => {
  const env = makeEnv();
  try { env.page.goStandings(); assert.deepStrictEqual(env.navs, ['/pages/standings/index']); }
  finally { env.restore(); }
});

test('goBracket → 跳淘汰赛对阵图页', () => {
  const env = makeEnv();
  try { env.page.goBracket(); assert.deepStrictEqual(env.navs, ['/pages/bracket/index']); }
  finally { env.restore(); }
});

test('WXML 淘汰赛对阵图入口可点进', () => {
  const wxml = readFileSync(join('miniprogram', 'pages/home/index.wxml'), 'utf8');
  assert.match(wxml, /淘汰赛对阵图/);
  assert.match(wxml, /bindtap="goBracket"/);
});

test('WXML 赛事榜单置顶(在「今天的比赛」之前)+ 两入口可点进', () => {
  const wxml = readFileSync(join('miniprogram', 'pages/home/index.wxml'), 'utf8');
  assert.match(wxml, /赛事榜单/);
  assert.match(wxml, /bindtap="goLeaderboard"/);
  assert.match(wxml, /bindtap="goStandings"/);
  // 置顶:赛事榜单标题应出现在「今天的比赛」之前
  assert.ok(wxml.indexOf('赛事榜单') < wxml.indexOf('今天的比赛'), '赛事榜单应在今天的比赛之前(置顶)');
});

test('详情页已注册到 app.json(含淘汰赛对阵图)', () => {
  const appJson = JSON.parse(readFileSync(join('miniprogram', 'app.json'), 'utf8'));
  assert.ok(appJson.pages.includes('pages/leaderboard/index'));
  assert.ok(appJson.pages.includes('pages/standings/index'));
  assert.ok(appJson.pages.includes('pages/bracket/index'));
});
