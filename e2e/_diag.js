// 诊断：复用已拉起的 IDE 实例(9420)，从 app 上下文直接打后端，抓 errMsg
// 判定首页空白根因：未登录 / 域名校验 / 请求真失败
const automator = require('miniprogram-automator');
const WS = 'ws://127.0.0.1:9420';
function log(...a){ console.log('[diag]', ...a); }

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS });
    log('✅ connected', WS);
  } catch (e) {
    log('❌ connect 失败:', e && e.message ? e.message : e);
    process.exit(2);
  }
  try {
    const apiBase = await mp.evaluate(() => { try { return getApp().globalData.apiBase; } catch(e){ return 'ERR:'+e.message; } });
    const openid = await mp.evaluate(() => { try { return getApp().globalData.openid; } catch(e){ return 'ERR:'+e.message; } });
    log('apiBase =', apiBase);
    log('openid  =', openid);

    // 直接发 wx.request，抓真实回包/错误
    const reqRes = await mp.evaluate(() => new Promise((resolve) => {
      try {
        wx.request({
          url: 'http://YOUR_SERVER_IP:8080/api/matches/today',
          method: 'GET',
          success: (res) => resolve({ phase: 'success', status: res.statusCode, dataKeys: Object.keys(res.data || {}), todayLen: (res.data && res.data.today ? res.data.today.length : null) }),
          fail: (err) => resolve({ phase: 'fail', errMsg: err && err.errMsg }),
        });
      } catch (e) { resolve({ phase: 'throw', err: e.message }); }
    }));
    log('wx.request /matches/today →', JSON.stringify(reqRes));

    // 试 wx.login 拿 code（看登录态）
    const loginRes = await mp.evaluate(() => new Promise((resolve) => {
      try {
        wx.login({
          success: (r) => resolve({ phase: 'success', hasCode: !!r.code, codeLen: (r.code||'').length }),
          fail: (err) => resolve({ phase: 'fail', errMsg: err && err.errMsg }),
        });
      } catch (e) { resolve({ phase: 'throw', err: e.message }); }
    }));
    log('wx.login →', JSON.stringify(loginRes));

    log('DIAG_RESULT', JSON.stringify({ apiBase, openid: openid || null, request: reqRes, login: loginRes }));
  } catch (e) {
    log('❌ 诊断异常:', e && e.stack ? e.stack : e);
  } finally {
    // 不 close，保留实例给后续全流程 harness 复用
    log('done (实例保留)');
    process.exit(0);
  }
})();
