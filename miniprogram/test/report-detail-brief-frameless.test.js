const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 一图看懂是一张"已经画好的完整卡片"PNG(深色底/圆角/徽标都在图内)。
// 历史问题:WXML 又在图外套了一层 .brief-card 大框(渐变背景+边框+阴影+内边距+装饰光斑),
// 形成"框中框",用户反馈看着不舒服。修复:.brief-card 退化为纯布局容器(只留外边距+点击区),
// 不再有任何视觉外框。本测试钉住该意图,防回归。

const wxss = readFileSync(join('miniprogram', 'pages', 'report-detail', 'index.wxss'), 'utf8');

// CSS 规则无嵌套花括号,[^}]* 即可截出 .brief-card 规则体
function ruleBody(selector) {
  const m = wxss.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

test('.brief-card 是无外框的纯容器(不再套大框)', () => {
  const body = ruleBody('.brief-card');
  assert.ok(body, '.brief-card 规则应存在(仍作为点击保存命中区)');
  assert.doesNotMatch(body, /background\s*:/, '不应有背景(外框)');
  assert.doesNotMatch(body, /border\s*:/, '不应有边框(外框)');
  assert.doesNotMatch(body, /box-shadow\s*:/, '不应有阴影(外框)');
  assert.doesNotMatch(body, /padding\s*:/, '不应有内边距(图直接平铺,无框内留白)');
});

test('.brief-card 的装饰光斑 ::before 已移除', () => {
  assert.doesNotMatch(wxss, /\.brief-card::before/, '装饰光斑属外框元素,应一并移除');
});

test('一图看懂图片本身仍占满宽度直接显示', () => {
  const body = ruleBody('.brief-image');
  assert.ok(body, '.brief-image 规则应存在');
  assert.match(body, /width\s*:\s*100%/, '图片满宽自适应,主体仍是这张图');
});
