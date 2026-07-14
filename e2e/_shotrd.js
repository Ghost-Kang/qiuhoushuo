const path = require('path');
const automator = require('miniprogram-automator');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram');
const ARG = '155ae496-9cb1-46fe-a447-2bedaa531061';
(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 90000 });
  console.log('[rd] launched');
  try {
    await new Promise(r => setTimeout(r, 5000));
    const p = await mp.reLaunch('/pages/report-detail/index?id=' + ARG);
    await p.waitFor(5000);
    const pd = await p.data();
    console.log('[rd] report=', pd.report ? 'Y':'N', 'statBars=', JSON.stringify(pd.statBars));
    await mp.pageScrollTo(780, 0); await p.waitFor(1500);
    await mp.screenshot({ path: '/path/to/qhs-v2-report-lower.png' });
    console.log('[rd] 📸 lower done');
  } catch (e) { console.log('[rd] ERR', e && e.message); }
  finally { try { await mp.close(); } catch(e){} process.exit(0); }
})();
