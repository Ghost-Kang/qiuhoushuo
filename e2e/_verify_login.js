// 验 #1 登录闸：launch → 真 wx.login → POST /wx/login,期望 200 + openid（不再 REGISTRATION_CLOSED）
const path = require('path');
const automator = require('miniprogram-automator');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram');
const BASE = 'http://YOUR_SERVER_IP:8080/api';
function log(...a){ console.log('[login]', ...a); }
(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 70000 });
  log('launched');
  try {
    await new Promise(r => setTimeout(r, 6000));
    const login = await mp.evaluate((base) => new Promise((resolve) => {
      wx.login({
        success: ({ code }) => wx.request({
          url: base + '/wx/login', method: 'POST', data: { code },
          success: (res) => resolve({ status: res.statusCode, hasOpenid: !!(res.data && res.data.openid), body: res.data }),
          fail: (e) => resolve({ reqFail: e && e.errMsg }),
        }),
        fail: (e) => resolve({ loginFail: e && e.errMsg }),
      });
    }), BASE);
    log('POST /wx/login →', JSON.stringify(login));
    // app onLaunch 的 openid
    const oid = await mp.evaluate(() => { try { return getApp().globalData.openid; } catch(e){ return null; } });
    log('app.globalData.openid =', oid || '(onLaunch 尚未回填或失败)');
    const home = await mp.currentPage();
    const hd = await home.data();
    log('home today =', (hd.today||[]).length, 'loading =', hd.loading);
    const ok = login.status === 200 && login.hasOpenid;
    log('VERDICT', ok ? '✅ #1 登录闸已解(返 openid)' : '❌ 仍被挡: ' + JSON.stringify(login.body || login));
  } catch (e) { log('FATAL', e && e.message); }
  finally { try { await mp.close(); } catch(e){} process.exit(0); }
})();
