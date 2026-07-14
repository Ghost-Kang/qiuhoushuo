const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 国旗实现全局复用回归:模板单一来源 + 样式提到 app.wxss + 三处页面都 import 同一模板(不重复造轮子)。
const mp = (...p) => readFileSync(join('miniprogram', ...p), 'utf8');

test('国旗模板单一来源:templates/flag.wxml 定义 template name="flag" + 用 code 走国旗图、emoji 兜底', () => {
  const tpl = mp('templates', 'flag.wxml');
  assert.match(tpl, /<template name="flag">/);
  assert.match(tpl, /flags\/{{flag\.code}}\.png/);
  assert.match(tpl, /class="flag-emoji">{{flag\.emoji}}/);
});

test('国旗基础样式提到 app.wxss(全局),各页不再各自定义', () => {
  const app = mp('app.wxss');
  assert.match(app, /\.flag \{/);
  assert.match(app, /\.flag-sm/);
  assert.match(app, /\.flag-md/);
  assert.match(app, /\.flag-lg/);
  assert.match(app, /\.flag-img/);
  assert.match(app, /\.flag-ring/);
  // 赛事页不应再重复定义基础 .flag(只保留 live 红环覆写)
  assert.doesNotMatch(mp('pages', 'home', 'index.wxss'), /\.flag-img \{/);
});

test('赛事/战报列表/战报详情 三页都 import 同一国旗模板并用 is="flag"', () => {
  for (const page of [['home'], ['reports'], ['report-detail']]) {
    const wxml = mp('pages', ...page, 'index.wxml');
    assert.match(wxml, /import src="\/templates\/flag.wxml"/, `${page} 应 import 共享国旗模板`);
    assert.match(wxml, /is="flag"/, `${page} 应用 is="flag" 渲染国旗`);
  }
});

test('战报详情:头部国旗 VS(队名/比分来自结构化字段),JS 复用 flagOf 注入', () => {
  const wxml = mp('pages', 'report-detail', 'index.wxml');
  assert.match(wxml, /class="matchup"/);
  assert.match(wxml, /is="flag" data="{{flag: report\.home_flag/);
  assert.match(wxml, /is="flag" data="{{flag: report\.away_flag/);
  assert.match(wxml, /{{report\.home_team}}/);
  assert.match(wxml, /{{report\.home_score}}/);
  const js = mp('pages', 'report-detail', 'index.js');
  assert.match(js, /flagOf/);
  assert.match(js, /report\.home_flag = flagOf\(report\.home_team\)/);
});
