// 客户端流程 sweep（注入数据绕过 401）：home 再确认 + report-detail 渲染/切风格/分享/付费降级
const automator = require('miniprogram-automator');
const WS = 'ws://127.0.0.1:9420';
const ARG = '155ae496-9cb1-46fe-a447-2bedaa531061';
function log(...a){ console.log('[sweep]', ...a); }
async function safe(label, fn){ try { return await fn(); } catch(e){ log(label, '抛:', e && e.message); return null; } }

const REPORT = {
  competition: '世界杯', date: '2026-06-04', match: '阿根廷 vs 沙特', is_premium: false,
  hardcore: { title: '硬核·传控败给 xG', subtitle: '副', lead: '导语段', body: ['p1','p2'], share_quote: '金句', tags: ['战术','xG'], premium_locked: true },
  duanzi:   { title: '段子·门将今晚梦游', subtitle: '副', lead: '导语段', body: ['p1'], share_quote: '金句', tags: ['梗'], premium_locked: true },
  emotion:  { title: '情绪·老将的最后一舞', subtitle: '副', lead: '导语段', body: ['p1'], share_quote: '金句', tags: ['泪'], premium_locked: true },
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS }); log('connected');

  // A0 home 再确认
  const h = await mp.reLaunch('/pages/home/index'); await h.waitFor(2000);
  const hd = await h.data();
  log('A0 HOME loading=', hd.loading, 'today=', (hd.today||[]).length, '→', hd.loading && (hd.today||[]).length===0 ? '❌ 确认卡死(Finding B)' : '✅ 正常');

  // A1 report-detail 渲染路径
  const p = await mp.reLaunch('/pages/report-detail/index?id=' + ARG); await p.waitFor(2500);
  let pd = await p.data();
  log('A1 report-detail 初始: loading=', pd.loading, 'report=', pd.report ? '有' : 'null（401 预期，登录闸）');

  await safe('A1 setData', () => p.setData({ report: REPORT, loading: false, style: 'duanzi' }));
  await p.waitFor(500);
  const tabs = await safe('A1 $$.style-tab', () => p.$$('.style-tab'));
  const titleEl = await safe('A1 $.title', () => p.$('.title'));
  const titleText = titleEl ? await safe('A1 title.text', () => titleEl.text()) : null;
  const paywallBtn = await safe('A1 $.paywall-btn', () => p.$('.paywall-btn'));
  const bodyPs = await safe('A1 $$.body-p', () => p.$$('.body-p'));
  log('A1 渲染: style-tab=', tabs ? tabs.length : 'n/a', '| title=', JSON.stringify(titleText), '| body-p=', bodyPs?bodyPs.length:'n/a', '| paywall=', paywallBtn ? '有' : '无');

  // 切风格
  await safe('switchStyle', () => p.callMethod('switchStyle', { currentTarget: { dataset: { style: 'hardcore' } } }));
  await p.waitFor(300); pd = await p.data();
  const titleEl2 = await safe('title2', () => p.$('.title'));
  const titleText2 = titleEl2 ? await safe('title2.text', () => titleEl2.text()) : null;
  log('A1 切 hardcore: style=', pd.style, '| title=', JSON.stringify(titleText2), '→', pd.style==='hardcore' && titleText2 && titleText2.indexOf('硬核')>=0 ? '✅' : '⚠️');

  // A2 分享面板
  await safe('openShareSheet', () => p.callMethod('openShareSheet'));
  await p.waitFor(300); pd = await p.data();
  const sheet = await safe('$.sheet', () => p.$('.sheet'));
  const sheetItems = await safe('$$.sheet-item', () => p.$$('.sheet-item'));
  log('A2 分享面板: showShareSheet=', pd.showShareSheet, '| .sheet=', sheet ? '渲染' : '无', '| 分享项=', sheetItems?sheetItems.length:'n/a', '→', pd.showShareSheet && sheet ? '✅ UI 正常(存图 URL 走 card→见 F53)' : '⚠️');
  await safe('closeShareSheet', () => p.callMethod('closeShareSheet'));

  // A4 付费降级(prepay 未配 → 期望 toast 支付暂未开放，不抛、不发起支付)
  const payThrew = await safe('onPaywallTap', () => p.callMethod('onPaywallTap', { currentTarget: { dataset: { sku: 'deep_report' } } }));
  await p.waitFor(600);
  log('A4 付费点击: callMethod', payThrew === null ? '抛了(见上)' : '未抛 → payment.js 应已 toast「支付暂未开放」并埋 E023(L04 未到的安全降级)');

  log('SWEEP_DONE'); process.exit(0);
})().catch(e => { log('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
