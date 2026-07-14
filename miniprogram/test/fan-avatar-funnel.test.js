const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// 球迷形象漏斗式重设计回归:步骤流转、机型判定、确认半屏主 CTA 的合规/未成年人/付费门控。
// payLive=false(默认收费关)→ 安卓/iOS 站内都直接免费生成;收费链路已验证,翻 true 可恢复(本套件两态都钉)。

const root = join('miniprogram', 'pages', 'fan-avatar');
const wxml = readFileSync(join(root, 'index.wxml'), 'utf8');
const js = readFileSync(join(root, 'index.js'), 'utf8');
const wxss = readFileSync(join(root, 'index.wxss'), 'utf8');
const appWxss = readFileSync(join('miniprogram', 'app.wxss'), 'utf8');

function loadPage({ track = () => {}, wx, globalData = {}, ensureOpenid } = {}) {
  const timers = [];
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  global.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  global.getApp = () => {
    const appObj = { globalData: Object.assign({ apiBase: 'https://api.test', aiNotice: 'AI', followedTeams: [] }, globalData), track };
    if (ensureOpenid) appObj.ensureOpenid = ensureOpenid;
    return appObj;
  };
  global.wx = Object.assign({ showToast: () => {}, showModal: () => {}, getDeviceInfo: () => ({ platform: 'android' }) }, wx || {});
  let def;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve('../pages/fan-avatar/index.js')];
  require('../pages/fan-avatar/index.js');
  def.setData = function (p) { this.data = { ...this.data, ...p }; };
  def.data = { ...def.data };
  const restore = () => { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; global.setTimeout = prev.setTimeout; global.clearTimeout = prev.clearTimeout; };
  return { page: def, timers, restore };
}

test('收费开关默认关(AVATAR_PAYMENT_LIVE=false)→ 免费;价格行/支付 CTA 仍受 payLive 门控(翻 true 即恢复)', () => {
  assert.match(js, /const AVATAR_PAYMENT_LIVE = false/); // 默认关:先免费让用户用起来,收费链路已验证可随时翻 true
  assert.match(js, /AVATAR_SKU = 'avatar_card'/);
  // 价格行与 CTA 文案受 payLive && !isIOS 门控(翻 true 后安卓显示 ¥1,iOS 不显示价格)
  assert.match(wxml, /wx:if="{{payLive && !isIOS}}"/);
  assert.match(wxml, /payLive && !isIOS \? '同意并支付 ¥1 生成' : '同意并生成'/);
});

test('AIGC 显著标识:顶部强提示横幅含"AI 生成"+"人工智能生成",贯穿全步骤(微信版本审核失败原因1修复)', () => {
  // 微信审核要求 AI 生成页面增加显著说明"AI 生成、人工智能生成"或同等含义字样
  assert.match(wxml, /class="aigc-banner"/, '需有显著 AIGC 横幅(非页脚弱标识)');
  assert.match(wxml, /AI 生成/, '横幅含"AI 生成"');
  assert.match(wxml, /人工智能生成/, '横幅含"人工智能生成"(对齐审核原话)');
  // 横幅置于 container 内、所有 step 之前 → entry/team/photo/generating/result 全程可见
  const bannerIdx = wxml.indexOf('aigc-banner');
  const firstStepIdx = wxml.indexOf("step === 'entry'");
  assert.ok(bannerIdx > -1 && bannerIdx < firstStepIdx, '横幅在首个 step 之前,审核截图的 entry 页即可见');
  // 全局样式存在且"显著"(品牌色描边,非 faint 弱标识)
  assert.match(appWxss, /\.aigc-banner\s*\{[^}]*border:[^}]*var\(--brand\)/s, '横幅描边用品牌色,确保显著');
  // 页脚弱标识不再 faint+2xs(读不清),回退全局可读样式
  assert.doesNotMatch(wxss, /\.ai-notice\s*\{[^}]*--text-faint/s, '页脚标识不再 faint 读不清');
});

test('Step0 诱饵用真实示例成品图 + 自动连续轮播(洗衣机转筒)', () => {
  assert.match(wxml, /class="example-img"/);
  assert.match(wxml, /wx:for="{{exampleLoop}}"/);
  assert.match(js, /avatar-samples/);
  // 三风格混排 9 张
  assert.match(js, /\[1, 2, 3, 4, 5, 6, 7, 8, 9\]/);
  // 无缝循环轨(同图复制一份) + marquee 动画
  assert.match(js, /EXAMPLE_LOOP/);
  assert.match(wxml, /class="example-track"/);
  assert.match(wxss, /@keyframes example-marquee/);
  assert.match(wxss, /animation: example-marquee/);
  assert.match(wxss, /translateX\(-50%\)/);
  // 不应再残留占位渐变卡(防回归)
  assert.doesNotMatch(wxml, /class="example-emoji"/);
});

test('Step2 选照片后可选形象风格(3 选项,tag 选中=青蓝),默认卡通,传到生成', () => {
  // 三选项 + 选择交互
  assert.match(wxml, /class="style-tag/);
  assert.match(wxml, /wx:for="{{styleOptions}}"/);
  assert.match(wxml, /bindtap="selectStyle"/);
  assert.match(js, /key: 'cartoon'/);
  assert.match(js, /key: 'figure'/);
  assert.match(js, /key: 'painterly'/);
  assert.match(js, /avatarStyle: 'cartoon'/); // 默认
  // 选中态沿用本页青蓝描边+glow
  assert.match(wxss, /\.style-tag\.is-selected/);
  assert.match(wxss, /--glow-accent/);
  // 风格传到生成请求(submitGenerate 内 const { avatarStyle } = this.data → style: avatarStyle)
  assert.match(js, /const \{ mode, star, avatarStyle \} = this\.data/);
  assert.match(js, /style: avatarStyle/);
});

test('选风格后 avatarStyle 切换', () => {
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    assert.strictEqual(page.data.avatarStyle, 'cartoon');
    page.selectStyle({ currentTarget: { dataset: { key: 'figure' } } });
    assert.strictEqual(page.data.avatarStyle, 'figure');
    assert.strictEqual(page.data.avatarStyleLabel, '3D 潮玩');
  } finally { restore(); }
});

test('确认半屏 catchtap 非空 noop(防点内部 checkbox 冒泡误关半屏跳回选照片页)', () => {
  assert.match(wxml, /class="confirm-sheet" catchtap="noop"/);
  assert.doesNotMatch(wxml, /catchtap=""/); // 空 handler 在部分基础库不阻冒泡
  assert.match(js, /noop\(\) \{\}/);
});

test('漏斗六态 + 确认半屏结构齐全', () => {
  assert.match(wxml, /step === 'entry'/);
  assert.match(wxml, /step === 'team'/);
  assert.match(wxml, /step === 'photo'/);
  assert.match(wxml, /step === 'generating'/);
  assert.match(wxml, /step === 'result'/);
  assert.match(wxml, /class="confirm-mask"/);
  assert.match(wxml, /bindtap="onConfirmCta"/);
  // 国旗卡替代手填 + "其他"兜底
  assert.match(wxml, /class="team-card/);
  assert.match(wxml, /bindtap="selectTeam"/);
  assert.match(wxml, /bindinput="onOtherTeamInput"/);
});

test('步骤流转:entry → team → photo;无球队不能进选图', () => {
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    assert.strictEqual(page.data.step, 'entry');
    page.goTeam();
    assert.strictEqual(page.data.step, 'team');
    page.data.team = ''; // 清掉默认
    page.goPhoto();
    assert.strictEqual(page.data.step, 'team', '无球队 → 不前进');
    page.data.team = '阿根廷';
    page.goPhoto();
    assert.strictEqual(page.data.step, 'photo');
  } finally { restore(); }
});

test('_isIOSPlatform:ios→true,android→false,异常→false', () => {
  let env = loadPage({ wx: { getDeviceInfo: () => ({ platform: 'ios' }) } });
  assert.strictEqual(env.page._isIOSPlatform(), true); env.restore();
  env = loadPage({ wx: { getDeviceInfo: () => ({ platform: 'android' }) } });
  assert.strictEqual(env.page._isIOSPlatform(), false); env.restore();
  env = loadPage({ wx: { getDeviceInfo: () => { throw new Error('x'); } } });
  assert.strictEqual(env.page._isIOSPlatform(), false); env.restore();
});

test('确认 CTA:未勾同意 → 提示且不生成', () => {
  const toasts = [];
  const { page, restore } = loadPage({ wx: { showToast: (o) => toasts.push(o) } });
  try {
    page.onLoad();
    let generated = false;
    page.submitGenerate = () => { generated = true; };
    page.data = { ...page.data, team: '阿根廷', selfieBase64: 'b64', consent: false };
    page.onConfirmCta();
    assert.match(toasts[0].title, /勾选同意/);
    assert.strictEqual(generated, false, '未同意不生成');
    assert.notStrictEqual(page.data.step, 'generating');
  } finally { restore(); }
});

test('确认 CTA:未成年人 → 拦截,不付费不生成(埋 E023)', () => {
  const toasts = [];
  const tracks = [];
  const { page, restore } = loadPage({
    track: (eventId, eventName, props) => tracks.push({ eventId, eventName, props }),
    wx: { showToast: (o) => toasts.push(o) },
    globalData: { user: { is_minor: true } },
  });
  try {
    page.onLoad();
    let generated = false;
    page.submitGenerate = () => { generated = true; };
    page.data = { ...page.data, team: '阿根廷', selfieBase64: 'b64', consent: true };
    page.onConfirmCta();
    assert.match(toasts[toasts.length - 1].title, /未成年人/);
    assert.strictEqual(generated, false);
    assert.ok(tracks.some((t) => t.eventId === 'E023' && t.props.error === 'minor_blocked'));
  } finally { restore(); }
});

test('确认 CTA:收费关(默认)+ 安卓 + 同意非未成年 → 直接免费生成(不下单)', () => {
  const reqCalls = [];
  const { page, restore } = loadPage({
    globalData: { openid: 'o1' },
    wx: { request: (o) => reqCalls.push(o), getDeviceInfo: () => ({ platform: 'android' }) },
  });
  try {
    page.onLoad(); // payLive=false(默认收费关)
    assert.strictEqual(page.data.payLive, false, '默认收费关');
    let genCalled = 0;
    page._startGenerate = () => { genCalled += 1; };
    page.data = { ...page.data, team: '巴西', selfieBase64: 'b64', consent: true, showConfirm: true };
    page.onConfirmCta();
    assert.strictEqual(genCalled, 1, '收费关:直接免费生成');
    assert.ok(!reqCalls.some((o) => /\/payment\/create/.test(o.url)), '收费关:不发起下单');
  } finally { restore(); }
});

test('确认 CTA:payLive 开 + 安卓 + 同意非未成年 → 走站内 ¥1 下单(不直接生成,等支付成功)', () => {
  const reqCalls = [];
  const { page, restore } = loadPage({
    globalData: { openid: 'o1' },
    wx: { request: (o) => reqCalls.push(o), getDeviceInfo: () => ({ platform: 'android' }) },
  });
  try {
    page.onLoad(); // isIOS=false(android)
    let genCalled = 0;
    page._startGenerate = () => { genCalled += 1; };
    page.data = { ...page.data, team: '巴西', selfieBase64: 'b64', consent: true, showConfirm: true, payLive: true }; // 模拟翻开收费
    page.onConfirmCta();
    // 安卓 + payLive → 发起 /payment/create 站内下单(jsapi_mini),不直接生成(等支付成功 onPaid 再生成)
    assert.ok(reqCalls.some((o) => /\/payment\/create/.test(o.url)), '应发起站内 ¥1 下单');
    assert.strictEqual(genCalled, 0, '未支付不直接生成');
    // 支付期间不提前关半屏(微信支付 UI 盖在上,取消可留半屏重试;成功后由 _startGenerate 关)
    assert.strictEqual(page.data.showConfirm, true, '点支付不立即跳回上一页');
  } finally { restore(); }
});

test('确认 CTA(安卓):先 ensureOpenid 再下单(修"下单失败"=openid 未就绪致 401)', async () => {
  const reqCalls = [];
  let ensured = 0;
  const { page, restore } = loadPage({
    globalData: { openid: 'o1' },
    ensureOpenid: () => { ensured += 1; return Promise.resolve('o1'); },
    wx: { request: (o) => reqCalls.push(o), getDeviceInfo: () => ({ platform: 'android' }) },
  });
  try {
    page.onLoad();
    page.data = { ...page.data, team: '巴西', selfieBase64: 'b64', consent: true, payLive: true }; // 模拟翻开收费
    page.onConfirmCta();
    await Promise.resolve(); await Promise.resolve(); // 等 ensureOpenid().then 落地
    assert.strictEqual(ensured, 1, '下单前先 ensureOpenid(force)');
    assert.ok(reqCalls.some((o) => /\/payment\/create/.test(o.url)), 'ensure 后才发起下单');
  } finally { restore(); }
});

test('确认 CTA:payLive 开 + iOS → 复制服务号名 + 弹窗引导(站内不付费、不生成)', () => {
  const clips = [];
  const modals = [];
  const reqCalls = [];
  const { page, restore } = loadPage({
    globalData: { openid: 'o1' },
    wx: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      setClipboardData: (o) => { clips.push(o.data); if (o.success) o.success(); },
      showModal: (o) => modals.push(o),
      request: (o) => reqCalls.push(o),
    },
  });
  try {
    page.onLoad(); // isIOS=true
    let genCalled = 0;
    page._startGenerate = () => { genCalled += 1; };
    page.data = { ...page.data, team: '阿根廷', selfieBase64: 'b64', consent: true, showConfirm: true, payLive: true }; // 模拟翻开收费
    page.onConfirmCta();
    // iOS 红线:站内不付费,复制服务号名 + 弹窗引导去服务号(H5 收 ¥1)
    assert.deepStrictEqual(clips, ['球后说'], 'iOS 复制服务号名(注册名,非品牌展示名)');
    assert.strictEqual(modals.length, 1, '弹一次引导');
    assert.doesNotMatch(modals[0].title + modals[0].content, /即将开放/, '不再是占位');
    assert.match(modals[0].content, /服务号/, '引导去服务号');
    assert.strictEqual(genCalled, 0, 'iOS 站内不直接生成');
    assert.ok(!reqCalls.some((o) => /\/payment\/create/.test(o.url)), 'iOS 站内不下单');
    assert.strictEqual(page.data.showConfirm, false, '关确认半屏');
  } finally { restore(); }
});

test('源码:iOS 已去"即将开放"占位,改服务号引导(复制注册名)', () => {
  assert.doesNotMatch(js, /即将开放/);
  assert.match(js, /SERVICE_ACCOUNT_NAME = '球后说'/);
  assert.match(js, /setClipboardData/);
});

// —— costar:与球星合影(写实高风险路径,founder 2026-06-23 拍板) ——

test('costar:entry 第二入口 + star 步骤结构齐全 + AI 合成披露', () => {
  // entry 有"和球星合影"第二入口
  assert.match(wxml, /bindtap="goCostar"/);
  // 新增 star 步(entry → star → photo)
  assert.match(wxml, /step === 'star'/);
  assert.match(wxml, /bindtap="selectStar"/);
  assert.match(wxml, /bindtap="goPhotoFromStar"/);
  assert.match(wxml, /bindinput="onOtherStarInput"/);
  // 如实披露:AI 合成、非真实合影(避免误导/软化肖像观感)
  assert.match(wxml, /合影由 AI 合成 · 非本人、非真实合影/);
  assert.match(wxml, /非本人、非真实合影/);
  // 风格选择仅 solo 显示(costar 是写实合影,无插画风格)
  assert.match(wxml, /wx:if="{{mode === 'solo'}}" class="style-picker"/);
});

test('costar:STAR_OPTIONS 带球队映射 + 默认 mode=solo', () => {
  assert.match(js, /const STAR_OPTIONS = \[/);
  assert.match(js, /name: 'C罗', team: '葡萄牙'/);
  assert.match(js, /mode: 'solo'/); // 默认 solo
});

test('costar:goCostar → mode=costar,step=star', () => {
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    assert.strictEqual(page.data.mode, 'solo');
    page.goCostar();
    assert.strictEqual(page.data.mode, 'costar');
    assert.strictEqual(page.data.step, 'star');
  } finally { restore(); }
});

test('costar:selectStar 选中球星即带出对应球队(球衣)', () => {
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    page.selectStar({ currentTarget: { dataset: { name: 'C罗' } } });
    assert.strictEqual(page.data.star, 'C罗');
    assert.strictEqual(page.data.starLabel, 'C罗');
    assert.strictEqual(page.data.team, '葡萄牙', '选中球星带出其球队');
  } finally { restore(); }
});

test('costar:无球星不能进选图(goPhotoFromStar 守卫)', () => {
  const toasts = [];
  const { page, restore } = loadPage({ wx: { showToast: (o) => toasts.push(o) } });
  try {
    page.onLoad();
    page.goCostar();
    page.data.star = '';
    page.goPhotoFromStar();
    assert.strictEqual(page.data.step, 'star', '无球星 → 不前进');
    page.data.star = 'C罗';
    page.goPhotoFromStar();
    assert.strictEqual(page.data.step, 'photo');
  } finally { restore(); }
});

test('costar:submitGenerate 传 mode=costar + star;solo 不传 star', () => {
  const reqCalls = [];
  const { page, restore } = loadPage({
    globalData: { apiBase: 'https://api.test', openid: 'o1' },
    wx: { request: (o) => reqCalls.push(o) },
  });
  try {
    page.onLoad();
    page.data = { ...page.data, mode: 'costar', star: 'C罗', team: '葡萄牙', avatarStyle: 'cartoon' };
    page.submitGenerate('葡萄牙', 'b64');
    const call = reqCalls.find((o) => /\/avatar$/.test(o.url));
    assert.ok(call, '应打 /avatar');
    assert.strictEqual(call.data.mode, 'costar');
    assert.strictEqual(call.data.star, 'C罗');

    reqCalls.length = 0;
    page.data = { ...page.data, mode: 'solo', star: '', team: '巴西' };
    page.submitGenerate('巴西', 'b64');
    const call2 = reqCalls.find((o) => /\/avatar$/.test(o.url));
    assert.strictEqual(call2.data.mode, 'solo');
    assert.strictEqual(call2.data.star, undefined, 'solo 不传 star');
  } finally { restore(); }
});

test('costar 入口门:wxml 入口按钮 + 「或」分隔受 costarEntry 门控(默认隐藏)', () => {
  const costarBtnLine = wxml.split('\n').find((l) => /entry-cta-costar/.test(l));
  assert.ok(costarBtnLine, '存在合影入口按钮');
  assert.match(costarBtnLine, /wx:if="{{costarEntry}}"/, '入口按钮受 costarEntry 门控');
  assert.match(js, /costarEntry: false/, '默认隐藏');
  assert.match(js, /\/avatar\/config/, 'onLoad 拉入口可见性 config');
});

test('costar 入口门:config 返回 costar_entry=true → costarEntry 置 true', () => {
  const { page, restore } = loadPage({
    globalData: { apiBase: 'https://api.test', openid: 'o1' },
    wx: { request: (o) => { if (/\/avatar\/config$/.test(o.url)) o.success({ data: { costar_entry: true }, statusCode: 200 }); } },
  });
  try {
    assert.strictEqual(page.data.costarEntry, false, '默认隐藏');
    page.onLoad();
    assert.strictEqual(page.data.costarEntry, true, 'config 返回 true → 入口显示');
  } finally { restore(); }
});

test('costar 入口门:config 失败/未开 → costarEntry 保持 false(fail-closed)', () => {
  const { page, restore } = loadPage({
    globalData: { apiBase: 'https://api.test', openid: 'o1' },
    wx: { request: (o) => { if (o.fail) o.fail({ errMsg: 'down' }); } },
  });
  try {
    page.onLoad();
    assert.strictEqual(page.data.costarEntry, false);
  } finally { restore(); }
});
