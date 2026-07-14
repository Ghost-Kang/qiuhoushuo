// 内测最小连通探针：拉起微信开发者工具 → reLaunch 首页 → 等 openid → 列赛事卡 → 截图
// 用途：确认 automator 能连上 + 真后端登录是否过两道 flag 闸（INTERNAL_TEST_ONLY / REGISTRATION_CLOSED）
// 跑：node miniprogram/test/e2e/_probe.js
const path = require('path');
const automator = require('miniprogram-automator');

const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '../miniprogram'); // miniprogram/
const SHOT_DIR = path.resolve(__dirname, 'shots');

function log(...a) { console.log('[probe]', ...a); }

async function pollOpenid(mp, ms = 18000) {
  const start = Date.now();
  // automator 不可用 Date.now? 这是普通 node 脚本，可以用
  while (Date.now() - start < ms) {
    try {
      const oid = await mp.evaluate(() => {
        try { return getApp().globalData.openid; } catch (e) { return null; }
      });
      if (oid) return oid;
    } catch (e) { /* ignore transient */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

(async () => {
  require('fs').mkdirSync(SHOT_DIR, { recursive: true });
  let mp;
  try {
    log('launching IDE via cli:', CLI);
    log('project:', PROJECT);
    mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, timeout: 60000 });
    log('✅ connected to automation port');
  } catch (e) {
    log('❌ launch 失败:', e && e.message ? e.message : e);
    log('   → 常见原因：① 设置-安全设置-服务端口未开 ② 已有 IDE 实例占用 9420 ③ 未登录');
    process.exit(2);
  }

  try {
    const page = await mp.reLaunch('/pages/home/index');
    await page.waitFor(800);
    log('reLaunched /pages/home/index');

    const openid = await pollOpenid(mp);
    log('openid =', openid || '（无 → 登录被两道闸之一挡住，或 wx/login 未通）');

    // 等首页 today 数据
    let cards = [];
    const start = Date.now();
    while (Date.now() - start < 12000) {
      cards = await page.$$('.match-card');
      if (cards.length > 0) break;
      await page.waitFor(800);
    }
    const data = await page.data();
    log('home today =', JSON.stringify((data.today || []).map((m) => `${m.home_team} v ${m.away_team}[${m.status}]`)));
    log('home loading flag =', data.loading, '| match-card 元素数 =', cards.length);

    await mp.screenshot({ path: path.join(SHOT_DIR, '01-home.png') });
    log('📸 shots/01-home.png');

    log('PROBE_RESULT', JSON.stringify({
      connected: true,
      openid: openid || null,
      todayCount: (data.today || []).length,
      cardCount: cards.length,
      homeLoading: data.loading,
    }));
  } catch (e) {
    log('❌ 流程异常:', e && e.stack ? e.stack : e);
  } finally {
    try { await mp.close(); log('closed'); } catch (e) {}
  }
})();
