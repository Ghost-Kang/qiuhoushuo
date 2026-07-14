const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const root = join('miniprogram');

test('fan-avatar page is registered in app.json', () => {
  const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  assert.ok(appJson.pages.includes('pages/fan-avatar/index'));
});

test('fan-avatar page requires explicit consent and explains photo usage', () => {
  const wxml = readFileSync(join(root, 'pages/fan-avatar/index.wxml'), 'utf8');
  // 隐私说明三要素：用途 / 不保存 / 未成年人不可用
  assert.match(wxml, /仅用于本次形象生成/);
  assert.match(wxml, /不会被保存/);
  assert.match(wxml, /未成年人账号不可使用/);
  // consent 必须是用户动作（checkbox），且默认不勾选
  assert.match(wxml, /checkbox-group bindchange="onConsentChange"/);
  assert.match(wxml, /checked="{{consent}}"/);
  // 漏斗重设计:生成由确认半屏主 CTA 触发(选完图 openConfirm → 同意后 onConfirmCta)
  assert.match(wxml, /bindtap="openConfirm"/);
  assert.match(wxml, /bindtap="onConfirmCta"/);
  assert.match(wxml, /小于 4MB/);

  const js = readFileSync(join(root, 'pages/fan-avatar/index.js'), 'utf8');
  assert.match(js, /consent: false/); // data 初始值不默认同意
  assert.match(js, /if \(!consent\)/); // generate 前有 consent 守卫
  assert.match(js, /MAX_SELFIE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(js, /prepareSelfie\(file\)/);
  assert.match(js, /wx\.compressImage/);
  assert.match(js, /getFileSize\(filePath/);
  assert.match(js, /FEATURE_DISABLED/); // 灰度关闭的可解释提示
});

test('fan-avatar generation waits for login and maps backend errors to actionable toasts', () => {
  const js = readFileSync(join(root, 'pages/fan-avatar/index.js'), 'utf8');
  assert.match(js, /ensureOpenid/);
  assert.match(js, /ensureOpenid\(\{ force: true \}\)/);
  assert.match(js, /登录中，请稍后重试/);
  assert.match(js, /PAYLOAD_TOO_LARGE/);
  assert.match(js, /图片太大，请换一张/);
  assert.match(js, /MINOR_BLOCKED/);
  assert.match(js, /未成年人账号暂不可用/);
  assert.match(js, /BAD_REQUEST/);
  assert.match(js, /JPG\/PNG/);
});

test('app exposes ensureOpenid so fan-avatar can avoid x-openid race', () => {
  const js = readFileSync(join(root, 'app.js'), 'utf8');
  assert.match(js, /ensureOpenid\(\)/);
  assert.match(js, /loginPromise/);
  assert.match(js, /wx\.setStorageSync\('openid'/);
  assert.match(js, /wx\.getStorageSync\('openid'\)/);
});

test('api.generateFanAvatar posts to /avatar and passes consent through (never hardcodes it)', () => {
  const js = readFileSync(join(root, 'utils/api.js'), 'utf8');
  assert.match(js, /function generateFanAvatar\(\{ apiBase, team, imageBase64, consent, style, mode, star, success, fail \}\)/);
  assert.match(js, /\$\{apiBase\}\/avatar/);
  assert.match(js, /data: \{ image_b64: imageBase64, team, consent, style, mode, star \}/);
  // 反向验证：api 层不许出现 consent: true 写死
  assert.doesNotMatch(js, /consent:\s*true/);
});

test('mock /avatar route honors the consent contract', () => {
  const { resolveMock } = require('../utils/api');
  const granted = resolveMock('/avatar', 'POST', { image_b64: 'x', team: '巴西', consent: true });
  assert.ok(granted.data && granted.data.url.includes('fan-avatars'));
  const denied = resolveMock('/avatar', 'POST', { image_b64: 'x', team: '巴西', consent: false });
  assert.ok(denied.error && denied.error.errMsg === 'CONSENT_REQUIRED');
});

test('report detail renders the tactics card with graceful degradation', () => {
  const wxml = readFileSync(join(root, 'pages/report-detail/index.wxml'), 'utf8');
  assert.match(wxml, /wx:if="{{showTactics && tacticsImageSrc}}"/);
  assert.match(wxml, /binderror="onTacticsError"/);
  assert.match(wxml, /bindtap="saveTacticsCardImage"/);
  assert.match(wxml, /战术图解/);
  // 反向验证：<image> 不许直接吃 API URL——302→CDN 时 image 组件不跟随（6/11 模拟器实测）
  assert.doesNotMatch(wxml, /src="{{tacticsUrl}}"/);

  const js = readFileSync(join(root, 'pages/report-detail/index.js'), 'utf8');
  assert.match(js, /\/card\/tactics\//);
  // 必须经 downloadFile 拿临时文件再喂 image；inline=1 避免 302 到 CDN 域名后被真机下载域名校验挡住。
  assert.match(js, /\?inline=1/);
  assert.match(js, /loadTacticsImage\(reportId\)/);
  assert.match(js, /statusCode === 200 && tempFilePath/);
  assert.match(js, /onTacticsError\(\)/);
  assert.match(js, /showTactics: false/); // 兜底整块隐藏
  // 保存相册复用本地临时文件,不二次下载
  assert.match(js, /filePath: tacticsImageSrc/);

  const wxss = readFileSync(join(root, 'pages/report-detail/index.wxss'), 'utf8');
  assert.match(wxss, /\.tactics-card/);
  assert.match(wxss, /\.tactics-image/);
});

test('me page 不再重复球迷形象入口(底部 tabBar 已有,避免重复)', () => {
  const wxml = readFileSync(join(root, 'pages/me/index.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /goFanAvatar|球迷形象生成/, '「我的」不再放球迷形象入口');
  // 球迷形象入口在底部 tabBar(唯一入口)
  const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  const tab = (appJson.tabBar.list || []).find((t) => t.pagePath === 'pages/fan-avatar/index');
  assert.ok(tab && tab.text === '球迷形象', '球迷形象在底部 tabBar');
});
