const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const root = join('miniprogram');

test('report detail renders highlight moment cards from API payload', () => {
  const wxml = readFileSync(join(root, 'pages/report-detail/index.wxml'), 'utf8');
  assert.match(wxml, /report\.highlight_moments/);
  assert.match(wxml, /bindtouchstart="onHorizontalTouchStart"/);
  assert.match(wxml, /bindtouchend="onHorizontalTouchEnd"/);
  assert.match(wxml, /item\.image_url/);
  assert.match(wxml, /class="moment-image"/);
  assert.match(wxml, /bindtap="onMomentImageTap"/);
  assert.match(wxml, /data-url="{{item\.image_url}}"/);
  assert.match(wxml, /item\.description/);
  assert.match(wxml, /moment-card/);
  assert.match(wxml, /精彩镜头/);
  // 一图看懂改为直接显示服务端新版 PNG(briefImageSrc),不再 WXML 重搭 brief_card 老布局
  assert.match(wxml, /wx:if="{{briefImageSrc}}"/);
  assert.match(wxml, /bindtap="saveBriefCardImage"/);
  assert.match(wxml, /class="brief-image"/);
  assert.match(wxml, /src="{{briefImageSrc}}"/);
  assert.match(wxml, /binderror="onBriefError"/);
  assert.match(wxml, /一图看懂/);
  assert.match(wxml, /点击保存一图看懂/);
  // 不应再残留旧的 WXML 重搭(防回归到双渲染分叉)
  assert.doesNotMatch(wxml, /report\.brief_card\.key_reasons/);
});

test('report detail has stable highlight card styles', () => {
  const wxss = readFileSync(join(root, 'pages/report-detail/index.wxss'), 'utf8');
  assert.match(wxss, /\.moment-card/);
  assert.match(wxss, /\.moment-image/);
  assert.match(wxss, /\.moment-visual/);
  assert.match(wxss, /\.moment-title/);
  assert.match(wxss, /\.brief-card/);
  assert.match(wxss, /\.brief-image/);
  assert.match(wxss, /\.brief-download/);
});
