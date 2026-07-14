// 诊断2：抓 /wx/login 的确切返回(哪道闸) + 复测首页 loadMatches 真实结果
const automator = require('miniprogram-automator');
const WS = 'ws://127.0.0.1:9420';
const BASE = 'http://YOUR_SERVER_IP:8080/api';
function log(...a){ console.log('[diag2]', ...a); }

(async () => {
  let mp;
  try { mp = await automator.connect({ wsEndpoint: WS }); log('connected'); }
  catch (e) { log('connect fail', e.message); process.exit(2); }
  try {
    // 1. 完整登录 round-trip，抓 /wx/login 返回
    const login = await mp.evaluate((base) => new Promise((resolve) => {
      wx.login({
        success: ({ code }) => {
          wx.request({
            url: base + '/wx/login', method: 'POST', data: { code },
            success: (res) => resolve({ status: res.statusCode, body: res.data }),
            fail: (err) => resolve({ reqFail: err && err.errMsg }),
          });
        },
        fail: (e) => resolve({ loginFail: e && e.errMsg }),
      });
    }), BASE);
    log('POST /wx/login →', JSON.stringify(login));

    // 2. 复测首页：reLaunch home，等 2s，读 data；若空则手动调 loadMatches
    const page = await mp.reLaunch('/pages/home/index');
    await page.waitFor(2500);
    let d = await page.data();
    log('home after reLaunch: loading=', d.loading, 'today.len=', (d.today||[]).length, 'upcoming.len=', (d.upcoming||[]).length);
    if ((d.today||[]).length === 0) {
      try {
        await page.callMethod('loadMatches');
        await page.waitFor(2500);
        d = await page.data();
        log('home after callMethod loadMatches: loading=', d.loading, 'today.len=', (d.today||[]).length);
      } catch (e) { log('callMethod loadMatches 抛:', e.message); }
    }
    log('home today sample =', JSON.stringify((d.today||[]).slice(0,2).map(m=>m.home_team+' v '+m.away_team)));

    log('DIAG2_RESULT', JSON.stringify({ login, homeLoading: d.loading, todayLen: (d.today||[]).length }));
  } catch (e) {
    log('异常:', e && e.stack ? e.stack : e);
  } finally { log('done'); process.exit(0); }
})();
