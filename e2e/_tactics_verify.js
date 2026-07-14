const automator = require('miniprogram-automator');

(async () => {
  const miniProgram = await automator.launch({
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: 'miniprogram',
  });
  const page = await miniProgram.reLaunch('/pages/report-detail/index?id=155ae496-9cb1-46fe-a447-2bedaa531061&style=duanzi');
  await new Promise((r) => setTimeout(r, 8000)); // downloadFile + 渲染
  const data = await page.data();
  console.log('showTactics:', data.showTactics, '| src:', (data.tacticsImageSrc || '').slice(0, 40));
  await miniProgram.pageScrollTo(2400);
  await new Promise((r) => setTimeout(r, 2000));
  await miniProgram.screenshot({ path: '.codex-tmp/tactics-sim-fixed.png' });
  await miniProgram.close();
  console.log('done');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
