// 截图验收 Increment 1：launch → 首页截图 → 战报详情截图(真登录+真战报)
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram');
const ARG = '155ae496-9cb1-46fe-a447-2bedaa531061';
const OUT = '/path/to';
function log(...a){ console.log('[shot]', ...a); }
(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 70000 });
  log('launched');
  try {
    await new Promise(r => setTimeout(r, 6000));
    const home = await mp.currentPage();
    const hd = await home.data();
    log('home today=', (hd.today||[]).length, 'loading=', hd.loading);
    await mp.screenshot({ path: `${OUT}/qhs-v2-home.png` });
    log('📸 qhs-v2-home.png');

    const p = await mp.reLaunch('/pages/report-detail/index?id=' + ARG);
    await p.waitFor(4000); // 登录 + 真战报加载
    const pd = await p.data();
    log('report-detail loading=', pd.loading, 'report=', pd.report ? '有' : 'null');
    log('statBars=', JSON.stringify(pd.statBars), 'styleIndex=', pd.styleIndex);
    await mp.screenshot({ path: `${OUT}/qhs-v2-report.png` });
    log('📸 qhs-v2-report.png (top)');
    await mp.pageScrollTo(820, 0); await p.waitFor(1200);
    await mp.screenshot({ path: `${OUT}/qhs-v2-report-lower.png` });
    log('📸 qhs-v2-report-lower.png (数据条+出图卡)');

    // 战报列表 tab
    const rp = await mp.reLaunch('/pages/reports/index'); await rp.waitFor(2500);
    await mp.screenshot({ path: `${OUT}/qhs-v2-reports.png` });
    log('📸 qhs-v2-reports.png');
    log('SHOT_DONE');
  } catch (e) { log('FATAL', e && e.message); }
  finally { try { await mp.close(); } catch(e){} process.exit(0); }
})();
