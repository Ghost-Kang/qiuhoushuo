const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join('miniprogram', 'pages', 'reports');

test('reports 列表 WXML:分组渲染 + 比分主视觉卡 + 焦点战 + 标签', () => {
  const wxml = readFileSync(join(root, 'index.wxml'), 'utf8');
  // 分组 + 段标题(今天/昨天/更早)
  assert.match(wxml, /wx:for="{{groups}}"/);
  assert.match(wxml, /class="section-label"/);
  // 复用 report-card 模板渲染标准卡 + 焦点卡
  assert.match(wxml, /<template name="report-card">/);
  assert.match(wxml, /is="report-card"/);
  assert.match(wxml, /data="{{\.\.\.group\.featured, featured: true}}"/); // 焦点战
  // 比分主视觉:国旗 + 中文队名 + 大比分(复用赛事 tab 国旗模板)
  assert.match(wxml, /class="score-row"/);
  assert.match(wxml, /import src="\/templates\/flag.wxml"/);
  assert.match(wxml, /is="flag" data="{{flag: home_flag/);
  assert.match(wxml, /is="flag" data="{{flag: away_flag/);
  assert.match(wxml, /{{home_team}}/);
  assert.match(wxml, /class="score"/);
  // 看点标签 + 金句
  assert.match(wxml, /class="tags"/);
  assert.match(wxml, /class="quote"/);
  // 更早组二级日期分段
  assert.match(wxml, /group\.subgroups/);
  // 不应再有旧的扁平字段
  assert.doesNotMatch(wxml, /item\.competition/);
  assert.doesNotMatch(wxml, /{{item\.date}}/);
});

test('reports 列表 JS:读 groups,空态判定改 groups,跳详情带 style/from', () => {
  const js = readFileSync(join(root, 'index.js'), 'utf8');
  assert.match(js, /res\.data\.groups/);
  assert.match(js, /style=duanzi/);
  assert.match(js, /from=reports_list/);
  // data 用 groups 不再用 reports 数组
  assert.match(js, /groups: \[\]/);
  // 复用 flagOf 给列表项注入国旗(焦点战 + 标准卡 + 二级分段都要走)
  assert.match(js, /require\('\.\.\/\.\.\/utils\/teams'\)/);
  assert.match(js, /flagOf\(item\.home_team\)/);
  assert.match(js, /enrichGroups/);
});
