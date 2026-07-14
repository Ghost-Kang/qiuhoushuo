// 干净冷启动判定：fresh launch → 读入口页(home)自然渲染，不 reLaunch
// 目的：区分 Finding B 是「真冷启动 bug」还是「automator reLaunch 夹具假象」
const path = require('path');
const automator = require('miniprogram-automator');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram');
function log(...a){ console.log('[cold]', ...a); }

(async () => {
  let mp;
  try {
    mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 70000 });
    log('launched (fresh)');
  } catch (e) { log('launch fail:', e && e.message); process.exit(2); }
  try {
    // 不 reLaunch，等入口页自然渲染 + app onLaunch 完成
    await new Promise(r => setTimeout(r, 6000));
    const cur = await mp.currentPage();
    const route = cur ? cur.path : '(none)';
    log('自然入口页 =', route);
    let data = {};
    try { data = await cur.data(); } catch(e){ log('读 data 抛:', e.message); }
    log('入口页 loading=', data.loading, 'today=', (data.today||[]).length);

    // 再等 3s 看异步加载是否补上
    await new Promise(r => setTimeout(r, 3000));
    try { data = await cur.data(); } catch(e){}
    log('+3s 后 loading=', data.loading, 'today=', (data.today||[]).length);

    // 读 runtime getApp 是否就绪
    const appReady = await mp.evaluate(() => { try { return !!(getApp() && getApp().globalData); } catch(e){ return 'ERR:'+e.message; } });
    log('runtime getApp().globalData 就绪?', appReady);

    const verdict = (data.today||[]).length > 0 ? '✅ 自然冷启动首页正常 → Finding B 是 automator reLaunch 夹具假象'
                  : (data.loading === true ? '❌ 自然冷启动也卡死 → Finding B 是真 bug'
                  : '⚠️ 既非卡死也无数据，需细看');
    log('COLD_VERDICT', verdict);
  } catch (e) { log('异常:', e && e.stack ? e.stack : e); }
  finally { try { await mp.close(); } catch(e){} log('done'); process.exit(0); }
})();
