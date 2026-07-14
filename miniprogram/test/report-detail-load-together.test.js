const test = require('node:test');
const assert = require('node:assert');

// 加载策略(6/14 改):正文(DB 读,快)就绪即解除整页 loading 立刻显示;一图看懂(服务端 PNG,冷渲染可能 ~5~7s)
// 异步加载、不阻塞整页——加载中显骨架占位(briefLoading),图到了原位替换(briefImageSrc),失败/超时收起骨架。
// 旧设计"正文+图都 settle 才显"会被慢图拖住整页(用户报修:点进去加载非常久)。
//
// 该套件实走页面方法:mock wx.request / wx.downloadFile / setTimeout,手动控回调时序,断言 loading/骨架翻转。

function setupEnv() {
  const tracks = [];
  const timers = [];
  let reqOpts = null;
  let briefOpts = null;
  let tacticsOpts = null;

  const prev = {
    Page: global.Page,
    wx: global.wx,
    getApp: global.getApp,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  };

  global.setTimeout = (fn, ms) => {
    timers.push({ fn, ms, cleared: false });
    return timers.length;
  };
  global.clearTimeout = (id) => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  global.getApp = () => ({
    globalData: { apiBase: 'https://api.test', aiNotice: 'AI 生成' },
    track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
  });
  global.wx = {
    request: (opts) => { reqOpts = opts; },
    downloadFile: (opts) => {
      if (opts.url.includes('variant=brief')) briefOpts = opts;
      else tacticsOpts = opts;
    },
    showToast: () => {},
  };

  let pageDef;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../pages/report-detail/index.js')];
  require('../pages/report-detail/index.js');
  pageDef.setData = function setData(patch) { this.data = { ...this.data, ...patch }; };

  return {
    page: pageDef,
    tracks,
    timers,
    get reqOpts() { return reqOpts; },
    get briefOpts() { return briefOpts; },
    get tacticsOpts() { return tacticsOpts; },
    restore() {
      global.Page = prev.Page;
      global.wx = prev.wx;
      global.getApp = prev.getApp;
      global.setTimeout = prev.setTimeout;
      global.clearTimeout = prev.clearTimeout;
    },
  };
}

const VALID_REPORT = { competition: 'WC', date: 'd', match: 'm', duanzi: { title: 't', lead: 'l', body: ['p'], tags: [], share_quote: 'q' } };

test('正文就绪即解除 loading 立刻显示(不等一图看懂);图加载中显骨架占位', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    assert.strictEqual(env.page.data.loading, true, '初始未就绪 → loading');
    assert.strictEqual(env.page.data.briefLoading, true, '一图看懂加载中 → 骨架占位');

    // 正文回来(200)→ 立刻解除 loading,不等图
    env.reqOpts.success({ statusCode: 200, data: VALID_REPORT });
    assert.ok(env.page.data.report, 'report 数据已写入');
    assert.strictEqual(env.page.data.loading, false, '正文就绪 → 立刻显示,不被慢图拖住');
    assert.strictEqual(env.page.data.briefLoading, true, '图还没回 → 仍显骨架(预留空间)');

    // 一图看懂回来 → 原位替换骨架
    env.briefOpts.success({ statusCode: 200, tempFilePath: '/tmp/brief.png' });
    assert.strictEqual(env.page.data.briefImageSrc, '/tmp/brief.png');
    assert.strictEqual(env.page.data.briefLoading, false, '图到了 → 收起骨架');
  } finally {
    env.restore();
  }
});

test('图先到也不影响:正文未到仍 loading,正文到才显', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });

    env.briefOpts.success({ statusCode: 200, tempFilePath: '/tmp/brief.png' });
    assert.strictEqual(env.page.data.briefImageSrc, '/tmp/brief.png');
    assert.strictEqual(env.page.data.briefLoading, false);
    assert.strictEqual(env.page.data.loading, true, 'loading 只由正文门控,正文未到仍 loading');

    env.reqOpts.success({ statusCode: 200, data: VALID_REPORT });
    assert.strictEqual(env.page.data.loading, false, '正文就绪 → 显示');
  } finally {
    env.restore();
  }
});

test('图加载失败(非 200)收起骨架、不显一图看懂块;正文不受影响', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    env.reqOpts.success({ statusCode: 200, data: VALID_REPORT });
    assert.strictEqual(env.page.data.loading, false, '正文就绪即显示');

    env.briefOpts.success({ statusCode: 403, tempFilePath: '' }); // 灰度关/无图
    assert.strictEqual(env.page.data.briefImageSrc, '', '失败 → 不显示一图看懂块');
    assert.strictEqual(env.page.data.briefLoading, false, '失败 → 收起骨架(不占位)');
  } finally {
    env.restore();
  }
});

test('report 404(noReport)直接进生成中态', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    env.reqOpts.success({ statusCode: 404, data: { error: 'NOT_FOUND' } });

    assert.strictEqual(env.page.data.noReport, true);
    assert.strictEqual(env.page.data.loading, false, 'noReport → 直接出"生成中"态');
    assert.strictEqual(env.page.data.briefImageSrc, '');
  } finally {
    env.restore();
  }
});

test('图既不 success 也不 fail 时,22s 兜底计时器收起骨架(整页早已显)', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    env.reqOpts.success({ statusCode: 200, data: VALID_REPORT });
    assert.strictEqual(env.page.data.loading, false, '正文就绪即显示,不被图拖住');
    assert.strictEqual(env.page.data.briefLoading, true, '图未回 → 仍显骨架');

    // onLoad 内 loadBriefImage 注册的兜底计时器应为 22000ms
    assert.strictEqual(env.timers[0].ms, 22000);
    env.timers[0].fn(); // 触发兜底
    assert.strictEqual(env.page.data.briefLoading, false, '兜底超时 → 收起骨架');
    assert.strictEqual(env.page.data.briefImageSrc, '');
  } finally {
    env.restore();
  }
});

test('brief 成功回调会清掉兜底计时器(避免重复 settle / 计时器泄漏)', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    env.reqOpts.success({ statusCode: 200, data: VALID_REPORT });
    env.briefOpts.success({ statusCode: 200, tempFilePath: '/tmp/brief.png' });

    assert.strictEqual(env.timers[0].cleared, true, '成功后兜底计时器被 clear');
    // 计时器迟到触发不应重复操作 / 改回骨架
    env.timers[0].fn();
    assert.strictEqual(env.page.data.briefLoading, false);
    assert.strictEqual(env.page.data.briefImageSrc, '/tmp/brief.png');
  } finally {
    env.restore();
  }
});

test('downloadFile 带 20s 主动超时,brief 走 inline + 稳定版本号 buster(非时间戳)', () => {
  const env = setupEnv();
  try {
    env.page.onLoad({ id: 'r1', style: 'duanzi' });
    assert.strictEqual(env.briefOpts.timeout, 20000, 'downloadFile 主动 20s 超时(冷渲染够时间)');
    assert.match(env.briefOpts.url, /variant=brief/);
    assert.match(env.briefOpts.url, /inline=1/);
    // buster 改稳定卡版本号(非 Date.now 时间戳)→ 同版本内 wx 缓存命中秒显,不每次重下
    assert.match(env.briefOpts.url, /&_t=v\d+/);
    assert.doesNotMatch(env.briefOpts.url, /&_t=\d{10,}/, '不应是时间戳');
  } finally {
    env.restore();
  }
});
