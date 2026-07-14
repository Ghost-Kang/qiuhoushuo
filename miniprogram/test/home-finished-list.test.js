const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const root = join('miniprogram');

test('home renders the finished list with scores', () => {
  const wxml = readFileSync(join(root, 'pages/home/index.wxml'), 'utf8');
  assert.match(wxml, /往期战报/);
  // 区块顺序(三分区):今天的比赛 → 近期赛程 → 往期战报。
  // 注:"往期战报"在空态链接里也出现一次(顶部),故用分区锚点 id="sec-finished" 判顺序。
  assert.ok(wxml.indexOf('今天的比赛') < wxml.indexOf('近期赛程'));
  assert.ok(wxml.indexOf('近期赛程') < wxml.indexOf('id="sec-finished"'));
  assert.match(wxml, /wx:for="{{finished}}"/);
  // VS 对决卡(template vsCard,mode='score'):比分按 num/colon/num 三段渲染
  assert.match(wxml, /class="num">{{item\.home_score}}/);
  assert.match(wxml, /class="num">{{item\.away_score}}/);
  assert.match(wxml, /item\.date_text/); // 往期日期进 spine-sub
  assert.match(wxml, /bindtap="goMatch"/); // 点击进战报
  // 空态"往期战报"可点(不做死胡同)
  assert.match(wxml, /catchtap="goFinished"/);
  assert.match(wxml, /id="sec-finished"/);

  const js = readFileSync(join(root, 'pages/home/index.js'), 'utf8');
  assert.match(js, /const finished = \(data\.finished \|\| \[\]\)\.map\(mapMatch\)/); // 队名中文化同 today

  const wxss = readFileSync(join(root, 'pages/home/index.wxss'), 'utf8');
  assert.match(wxss, /\.score\b/);
  assert.match(wxss, /\.num\b/);
});

test('mock /matches/today exposes the finished contract', () => {
  const { resolveMock } = require('../utils/api');
  const res = resolveMock('/matches/today', 'GET');
  assert.ok(Array.isArray(res.data.finished) && res.data.finished.length > 0);
  const item = res.data.finished[0];
  assert.equal(typeof item.home_score, 'number');
  assert.equal(typeof item.away_score, 'number');
  assert.equal(typeof item.date_text, 'string');
});
