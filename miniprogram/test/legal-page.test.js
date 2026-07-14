const test = require('node:test');
const assert = require('node:assert');

// 用户协议三件套页面 + 「我的」页可点链接。钉死:① 三份文档都能加载;② 隐私政策含球迷形象人脸采集披露(按实际代码补);
// ③ 占位已回填(无 [PENDING_ / ⚖️ / ⚙️ 残留、经营者=META 单点值插值、联系邮箱真实);④ 我的页点击跳对应 doc。

const { META, DOCS } = require('../utils/legal-text');

test('三份文档结构完整(title + 非空 blocks)', () => {
  for (const key of ['agreement', 'privacy', 'minor']) {
    const doc = DOCS[key];
    assert.ok(doc && doc.title, `${key} 有标题`);
    assert.ok(Array.isArray(doc.blocks) && doc.blocks.length > 5, `${key} 有正文`);
    for (const b of doc.blocks) {
      assert.ok(['h', 'p', 'li', 'note'].includes(b.t), `${key} block 类型合法`);
      assert.ok(typeof b.x === 'string' && b.x.length > 0, `${key} block 有文本`);
    }
  }
});

test('隐私政策含球迷形象人脸采集披露(B.2 + B.4)', () => {
  const txt = DOCS.privacy.blocks.map((b) => b.x).join('\n');
  assert.match(txt, /球迷形象/, '提到球迷形象功能');
  assert.match(txt, /人脸/, '披露人脸采集');
  assert.match(txt, /不存储您上传的人脸原图|不留存原图/, '说明原图不落盘');
  assert.match(txt, /单独同意/, '人脸属敏感信息需单独同意');
});

test('占位已回填:无 PENDING/起草标记残留,主体/联系方式正确', () => {
  const all = ['agreement', 'privacy', 'minor']
    .flatMap((k) => DOCS[k].blocks.map((b) => b.x))
    .concat(Object.values(META))
    .join('\n');
  assert.doesNotMatch(all, /PENDING/, '无 [PENDING_*] 残留');
  assert.doesNotMatch(all, /⚖️|⚙️|🔴/, '无内部起草标记残留');
  // 经营者/信用代码单点维护于 META,正文插值引用——断言正文确实带上了 META 值(防漏插值回归)
  assert.ok(all.includes(`经营者 ${META.operator}`), '正文含经营者(META 插值)');
  assert.ok(all.includes(META.creditCode), '正文含信用代码(META 插值)');
  assert.match(all, /wangxukang@superframe\.cn/, '公示真实联系邮箱');
  assert.strictEqual(META.contact, 'wangxukang@superframe.cn');
});

function loadLegalPage() {
  const prev = { Page: global.Page, wx: global.wx };
  let titleSet = '';
  global.wx = { setNavigationBarTitle: (o) => { titleSet = o.title; } };
  let def;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve('../pages/legal/index.js')];
  require('../pages/legal/index.js');
  def.setData = function (p) { this.data = { ...this.data, ...p }; };
  def.data = { ...def.data };
  const restore = () => { global.Page = prev.Page; global.wx = prev.wx; };
  return { page: def, getTitle: () => titleSet, restore };
}

test('legal 页:doc=privacy 加载隐私政策 + 设导航标题', () => {
  const env = loadLegalPage();
  try {
    env.page.onLoad({ doc: 'privacy' });
    assert.strictEqual(env.page.data.title, '隐私政策');
    assert.ok(env.page.data.blocks.length > 5);
    assert.strictEqual(env.getTitle(), '隐私政策');
  } finally { env.restore(); }
});

test('legal 页:无参/非法 doc 兜底为用户协议', () => {
  for (const q of [{}, { doc: 'bogus' }, undefined]) {
    const env = loadLegalPage();
    try {
      env.page.onLoad(q);
      assert.strictEqual(env.page.data.title, '用户协议');
    } finally { env.restore(); }
  }
});

test('我的页 openLegal 跳对应文档', () => {
  const prev = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const navs = [];
  global.wx = {
    navigateTo: (o) => navs.push(o.url), switchTab: () => {}, showToast: () => {},
    getStorageSync: () => undefined, setStorageSync: () => {}, request: () => {},
  };
  global.getApp = () => ({ globalData: { apiBase: 'x', aiNotice: '' }, track: () => {} });
  let def;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve('../pages/me/index.js')];
  require('../pages/me/index.js');
  def.setData = function (p) { this.data = { ...this.data, ...p }; };
  def.data = { ...def.data };
  try {
    def.openLegal({ currentTarget: { dataset: { doc: 'privacy' } } });
    def.openLegal({ currentTarget: { dataset: { doc: 'minor' } } });
    assert.deepStrictEqual(navs, ['/pages/legal/index?doc=privacy', '/pages/legal/index?doc=minor']);
  } finally { global.Page = prev.Page; global.wx = prev.wx; global.getApp = prev.getApp; }
});
