const MOCK_DATA = require('./mock-data.js');

// 6/4 内测：默认 false → 走真后端(apiBase 指腾讯云 8080)。true=纯本地 mock(离线 dev)。
// 测试用 _setUseMockForTest(true) 显式切 mock 层(api.test.js 验 mock 契约)。
let USE_MOCK = false;

// 惰性获取 app：入口页 / lazyCodeLoading 时序下，模块求值时 getApp() 可能尚未就绪。
// 若在模块顶层 `const app = getApp()` 缓存，会永久拿到 undefined → 后续 app.globalData 抛
// （实测冷启动首页白屏卡"加载中"）。改为每次调用时取，调用期 getApp() 必已就绪。
function currentApp() {
  return typeof getApp === 'function' ? getApp() : null;
}

function defaultFail(url, err) {
  const errMsg = err && err.errMsg ? err.errMsg : String(err || 'unknown');
  wx.showToast({ title: '网络异常,请重试', icon: 'none' });
  const app = currentApp();
  if (app && typeof app.track === 'function') {
    app.track('E099', 'api_fail', { url, errMsg });
  }
}

// complete:无论成功/失败都回调(微信支付查单结算后靠它触发 onPaid)。此前漏转发 → onPaid 永不触发
// → 球迷形象付费成功后不生成(6/13 真因);deep_report 靠重载解锁掩盖了。务必转发给 wx.request / mock。
function request({ url, method = 'GET', data, success, fail, complete, _skipEnsure }) {
  const onFail = fail || ((err) => defaultFail(url, err));
  const app = currentApp();
  if (USE_MOCK) {
    const base = app && app.globalData ? app.globalData.apiBase : '';
    const path = url.replace(base, '');
    const mockResp = resolveMock(path, method, data);
    setTimeout(() => {
      if (mockResp.error) onFail(mockResp.error);
      else success && success({ data: mockResp.data, statusCode: 200 });
      if (typeof complete === 'function') complete();
    }, 200);
    return undefined;
  }
  // 发送时再读 openid(可能刚由 ensureOpenid 写入)。鉴权接口(/report、/me 等)缺 x-openid 会 401。
  const fire = () => {
    const openid = app && app.globalData ? app.globalData.openid : null;
    return wx.request({
      url,
      method,
      data,
      header: openid ? { 'x-openid': openid } : {},
      success: (res) => {
        const statusCode = res && res.statusCode ? res.statusCode : 0;
        if (statusCode >= 200 && statusCode < 300) {
          success && success(res);
          return;
        }
        onFail({
          errMsg: `HTTP_${statusCode}`,
          statusCode,
          data: res && res.data,
        });
      },
      fail: onFail,
      complete, // 转发:wx.request 在 success/fail 后必调 complete → onPaid 触发生成
    });
  };
  // 冷启动竞态修复:wx.login 尚未回来时 globalData.openid 为空 → 直发会缺 x-openid → 鉴权接口 401
  // → 战报页误显「生成中」(用户报修:首进一直生成,刷新才正常)。故 openid 未就绪且非登录请求时,
  // 先 ensureOpenid 拿到 openid 再发;拿不到也照发(走 401→fail,不劣于旧)。_skipEnsure 给 /wx/login 自身防递归死锁。
  const hasOpenid = !!(app && app.globalData && app.globalData.openid);
  if (!hasOpenid && !_skipEnsure && app && typeof app.ensureOpenid === 'function') {
    app.ensureOpenid().then(fire).catch(fire);
    return undefined;
  }
  return fire();
}

function requestSubscribeMessage({ tmplIds, success, fail, complete }) {
  if (USE_MOCK) {
    const res = tmplIds.reduce((acc, id) => ({ ...acc, [id]: 'accept' }), {});
    success && success(res);
    complete && complete(res);
    return undefined;
  }
  return wx.requestSubscribeMessage({ tmplIds, success, fail, complete });
}

function resolveMock(path, method, data) {
  for (const [pattern, handler] of MOCK_DATA.routes) {
    const m = path.match(pattern);
    if (m) return handler(m, method, data);
  }
  return { error: { errMsg: `mock 404: ${path}` } };
}

// 球迷形象生成。consent 必须由调用方在用户显式勾选后传 true——这里不代填,
// 保证"单独同意"动作真实发生在 UI 层（人脸属敏感个人信息）。
function generateFanAvatar({ apiBase, team, imageBase64, consent, style, mode, star, success, fail }) {
  return request({
    url: `${apiBase}/avatar`,
    method: 'POST',
    // mode=costar 时带 star(与球星合影);solo 时 star 省略,后端按 mode 选 prompt。
    data: { image_b64: imageBase64, team, consent, style, mode, star },
    success,
    fail,
  });
}

function _setUseMockForTest(v) { USE_MOCK = v; }

module.exports = { request, requestSubscribeMessage, generateFanAvatar, resolveMock, USE_MOCK, _setUseMockForTest };
