// 修复后综合复验（launch 自带实例）：home 4 场 + report-detail 渲染 + A4 付费点击不再抛 + A2 分享面板
const path = require('path');
const automator = require('miniprogram-automator');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram');
const ARG = '155ae496-9cb1-46fe-a447-2bedaa531061';
function log(...a){ console.log('[verify]', ...a); }
async function safe(label, fn){ try { return await fn(); } catch(e){ log(label,'抛:', e && e.message); return '__THREW__'; } }
const REPORT = {
  competition:'世界杯', date:'2026-06-04', match:'阿根廷 vs 沙特', is_premium:false,
  hardcore:{title:'硬核·传控败给 xG',subtitle:'副',lead:'导语',body:['p1','p2'],share_quote:'金句',tags:['战术'],premium_locked:true},
  duanzi:{title:'段子·门将今晚梦游',subtitle:'副',lead:'导语',body:['p1'],share_quote:'金句',tags:['梗'],premium_locked:true},
  emotion:{title:'情绪·最后一舞',subtitle:'副',lead:'导语',body:['p1'],share_quote:'金句',tags:['泪'],premium_locked:true},
};
(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 70000 });
  log('launched');
  try {
    await new Promise(r => setTimeout(r, 5000));
    const home = await mp.currentPage();
    const hd = await home.data();
    log('A0 HOME:', 'loading=', hd.loading, 'today=', (hd.today||[]).length, (hd.today||[]).length>0 ? '✅' : '❌');

    const p = await mp.reLaunch('/pages/report-detail/index?id=' + ARG);
    await p.waitFor(2000);
    await safe('setData', () => p.setData({ report: REPORT, loading: false, style: 'duanzi' }));
    await p.waitFor(400);
    const tabs = await safe('tabs', () => p.$$('.style-tab'));
    log('A1 报告页渲染: style-tab=', Array.isArray(tabs) ? tabs.length : tabs);

    // A4 付费点击 —— 修复前这里抛 globalData of undefined
    const paywall = await safe('onPaywallTap', () => p.callMethod('onPaywallTap', { currentTarget: { dataset: { sku: 'deep_report' } } }));
    await p.waitFor(500);
    log('A4 付费点击:', paywall === '__THREW__' ? '❌ 仍抛' : '✅ 未抛(payment.js 安全降级 toast)');

    // A2 分享面板
    await safe('openShareSheet', () => p.callMethod('openShareSheet'));
    await p.waitFor(300);
    const pd = await p.data();
    const sheet = await safe('sheet', () => p.$('.sheet'));
    log('A2 分享面板: showShareSheet=', pd.showShareSheet, sheet && sheet !== '__THREW__' ? '✅' : '❌');

    log('VERIFY_DONE');
  } catch (e) { log('FATAL', e && e.message); }
  finally { try { await mp.close(); } catch(e){} process.exit(0); }
})();
