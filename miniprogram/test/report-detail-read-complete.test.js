const test = require('node:test');
const assert = require('node:assert');

function loadPage({ track, previewImage = () => {}, downloadFile, saveImageToPhotosAlbum, showToast = () => {} }) {
  const previousPage = global.Page;
  const previousWx = global.wx;
  delete require.cache[require.resolve('../pages/report-detail/index.js')];
  // 页面用惰性 app()（修 Finding B：避免模块顶层缓存 undefined）→ getApp 需在“方法调用期”
  // 仍指向 mock，故此处不恢复 getApp（node --test 进程隔离，文件内不泄漏到其它文件）。
  global.getApp = () => ({
    globalData: { apiBase: 'https://qiuhoushuo.com/api', aiNotice: 'AI 生成' },
    track,
  });
  global.wx = {
    showToast,
    previewImage,
    downloadFile: downloadFile || (() => {}),
    saveImageToPhotosAlbum: saveImageToPhotosAlbum || (() => {}),
  };
  let pageDef;
  global.Page = (definition) => {
    pageDef = definition;
  };
  require('../pages/report-detail/index.js');
  global.Page = previousPage;
  global.wx = previousWx;
  pageDef.setData = function setData(patch) {
    this.data = { ...this.data, ...patch };
  };
  return pageDef;
}

test('report-detail fires E054 once after 60s visible reading', () => {
  const tracks = [];
  const timers = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = (fn, ms) => {
    timers.push({ fn, ms, cleared: false });
    return timers.length;
  };
  global.clearTimeout = (id) => {
    timers[id - 1].cleared = true;
  };

  try {
    const page = loadPage({
      track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
    });
    page.data = {
      ...page.data,
      reportId: 'r-final',
      style: 'hardcore',
      report: { is_premium: true },
    };
    page.onShow();
    assert.strictEqual(timers[0].ms, 60_000);
    timers[0].fn();
    page.onShow();
    if (timers[1]) timers[1].fn();

    assert.deepStrictEqual(tracks, [{
      eventId: 'E054',
      eventName: 'report_read_completed',
      properties: {
        report_id: 'r-final',
        style: 'hardcore',
        sku: 'deep_report',
        reading_seconds: 60,
      },
    }]);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('report-detail clears read-complete timer when hidden before 60s', () => {
  const tracks = [];
  const timers = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = (fn, ms) => {
    timers.push({ fn, ms, cleared: false });
    return timers.length;
  };
  global.clearTimeout = (id) => {
    timers[id - 1].cleared = true;
  };

  try {
    const page = loadPage({
      track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
    });
    page.data = {
      ...page.data,
      reportId: 'r-free',
      style: 'duanzi',
      report: { is_premium: false },
    };
    page.onShow();
    page.onHide();
    assert.strictEqual(timers[0].cleared, true);
    if (!timers[0].cleared) timers[0].fn();
    assert.deepStrictEqual(tracks, []);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('report-detail previews generated highlight image with sibling image urls', () => {
  const previews = [];
  const page = loadPage({
    track: () => {},
    previewImage: (payload) => previews.push(payload),
  });
  const previousWx = global.wx;
  global.wx = { previewImage: (payload) => previews.push(payload) };
  try {
    page.data = {
      ...page.data,
      report: {
        highlight_moments: [
          { id: 'score-turn', image_url: 'https://img.example/score.png' },
          { id: 'pressure-wave', image_url: 'https://img.example/pressure.png' },
          { id: 'final-whistle' },
        ],
      },
    };
    page.onMomentImageTap({ currentTarget: { dataset: { url: 'https://img.example/pressure.png' } } });
    assert.deepStrictEqual(previews, [{
      current: 'https://img.example/pressure.png',
      urls: ['https://img.example/score.png', 'https://img.example/pressure.png'],
    }]);
  } finally {
    global.wx = previousWx;
  }
});

test('report-detail downloads one-image-understand card when brief card is tapped', () => {
  const tracks = [];
  const downloads = [];
  const saves = [];
  const toasts = [];
  const page = loadPage({
    track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
    downloadFile: ({ url, success }) => {
      downloads.push(url);
      success({ tempFilePath: '/tmp/brief-card.png' });
    },
    saveImageToPhotosAlbum: ({ filePath, success }) => {
      saves.push(filePath);
      success();
    },
    showToast: (payload) => toasts.push(payload),
  });
  const previousWx = global.wx;
  global.wx = {
    downloadFile: ({ url, success }) => {
      downloads.push(url);
      success({ tempFilePath: '/tmp/brief-card.png' });
    },
    saveImageToPhotosAlbum: ({ filePath, success }) => {
      saves.push(filePath);
      success();
    },
    showToast: (payload) => toasts.push(payload),
    previewImage: () => {},
  };
  try {
    page.data = { ...page.data, reportId: 'match-1' };
    page.saveBriefCardImage();

    // inline=1(真机 wx.downloadFile 不跟 302)+ &_t= 缓存破除(动态),断言时剥 _t 再比对。
    assert.strictEqual(downloads.length, 1);
    assert.strictEqual(downloads[0].split('&_t=')[0], 'https://qiuhoushuo.com/api/card/match-1?style=duanzi&platform=xhs&variant=brief&inline=1');
    assert.match(downloads[0], /&_t=\d+$/);
    assert.deepStrictEqual(saves, ['/tmp/brief-card.png']);
    assert.deepStrictEqual(toasts, [{ title: '已保存到相册', icon: 'success' }]);
    assert.deepStrictEqual(tracks, [
      { eventId: 'E012', eventName: 'share_platform_select', properties: { platform: 'brief_xhs', report_id: 'match-1' } },
      { eventId: 'E014', eventName: 'share_complete', properties: { platform: 'brief_xhs', report_id: 'match-1' } },
    ]);
  } finally {
    global.wx = previousWx;
  }
});

test('report-detail switches style on horizontal swipe and tracks the transition', () => {
  const tracks = [];
  const page = loadPage({
    track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
  });
  page.data = {
    ...page.data,
    reportId: 'r-swipe',
    style: 'duanzi',
    styleIndex: 1,
    report: {
      hardcore: { stats: { shots: { home: 15, away: 3 } } },
      duanzi: { stats: { shots: { home: 10, away: 8 } } },
      emotion: { stats: { shots: { home: 6, away: 12 } } },
    },
  };

  page.onHorizontalTouchStart({ touches: [{ clientX: 280, clientY: 120 }] });
  page.onHorizontalTouchEnd({ changedTouches: [{ clientX: 180, clientY: 126 }] });

  assert.strictEqual(page.data.style, 'emotion');
  assert.strictEqual(page.data.styleIndex, 2);
  assert.deepStrictEqual(tracks, [{
    eventId: 'E008',
    eventName: 'style_switch',
    properties: {
      from_style: 'duanzi',
      to_style: 'emotion',
      report_id: 'r-swipe',
    },
  }]);
});

test('report-detail ignores vertical gestures and edge swipes', () => {
  const tracks = [];
  const page = loadPage({
    track: (eventId, eventName, properties) => tracks.push({ eventId, eventName, properties }),
  });
  page.data = {
    ...page.data,
    reportId: 'r-edge',
    style: 'hardcore',
    styleIndex: 0,
    report: {
      hardcore: { stats: { shots: { home: 15, away: 3 } } },
      duanzi: { stats: { shots: { home: 10, away: 8 } } },
      emotion: { stats: { shots: { home: 6, away: 12 } } },
    },
  };

  page.onHorizontalTouchStart({ touches: [{ clientX: 180, clientY: 120 }] });
  page.onHorizontalTouchEnd({ changedTouches: [{ clientX: 90, clientY: 240 }] });
  assert.strictEqual(page.data.style, 'hardcore');

  page.onHorizontalTouchStart({ touches: [{ clientX: 120, clientY: 100 }] });
  page.onHorizontalTouchEnd({ changedTouches: [{ clientX: 220, clientY: 108 }] });
  assert.strictEqual(page.data.style, 'hardcore');
  assert.deepStrictEqual(tracks, []);
});
