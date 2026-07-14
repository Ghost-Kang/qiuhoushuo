const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { hasValidPaymentParams, requestReportPayment, createReportPayment } = require('../utils/payment');

function validParams() {
  return {
    timeStamp: '1716000000',
    nonceStr: 'nonce',
    package: 'prepay_id=wx123',
    signType: 'MD5',
    paySign: 'signed',
  };
}

test('hasValidPaymentParams rejects missing or blank prepay fields', () => {
  assert.strictEqual(hasValidPaymentParams(null), false);
  assert.strictEqual(hasValidPaymentParams({}), false);
  assert.strictEqual(hasValidPaymentParams({ ...validParams(), package: '' }), false);
  assert.strictEqual(hasValidPaymentParams(validParams()), true);
});

test('report paywall copy matches deep_report SKU pricing', () => {
  const wxml = fs.readFileSync(path.join('miniprogram', 'pages', 'report-detail', 'index.wxml'), 'utf8');
  assert.match(wxml, /赛事通 · 解锁全程深度战报/);
  assert.match(wxml, /¥19 开通赛事通/);
  assert.doesNotMatch(wxml, /¥3 解锁完整版/);
});

test('requestReportPayment does not call wx.requestPayment when prepay params are missing', () => {
  const calls = [];
  const wxApi = {
    showToast: (payload) => calls.push(['toast', payload]),
    requestPayment: () => calls.push(['pay']),
  };
  const app = {
    globalData: { user: { is_minor: false } },
    track: (eventId, eventName, properties) => calls.push(['track', eventId, eventName, properties]),
  };

  const started = requestReportPayment({
    wxApi,
    app,
    sku: 'deep_report',
    reportId: 'r1',
    paymentParams: { ...validParams(), paySign: '' },
  });

  assert.strictEqual(started, false);
  assert.deepStrictEqual(calls[0], [
    'track',
    'E023',
    'payment_failed',
    { sku: 'deep_report', report_id: 'r1', error: 'prepay_not_configured' },
  ]);
  assert.deepStrictEqual(calls[1], ['toast', { title: '支付暂未开放', icon: 'none' }]);
  assert.strictEqual(calls.some((call) => call[0] === 'pay'), false);
});

test('requestReportPayment blocks minor users before checking prepay params', () => {
  const calls = [];
  const wxApi = {
    showToast: (payload) => calls.push(['toast', payload]),
    requestPayment: () => calls.push(['pay']),
  };
  const app = {
    globalData: { user: { is_minor: true } },
    track: (eventId, eventName, properties) => calls.push(['track', eventId, eventName, properties]),
  };

  const started = requestReportPayment({
    wxApi,
    app,
    sku: 'deep_report',
    reportId: 'r-minor',
    paymentParams: validParams(),
  });

  assert.strictEqual(started, false);
  assert.deepStrictEqual(calls[0], [
    'track',
    'E023',
    'payment_failed',
    { sku: 'deep_report', report_id: 'r-minor', error: 'minor_payment_blocked' },
  ]);
  assert.deepStrictEqual(calls[1], ['toast', { title: '未成年人模式不可付费', icon: 'none' }]);
  assert.strictEqual(calls.some((call) => call[0] === 'pay'), false);
});

test('requestReportPayment forwards valid params and tracks success', () => {
  const calls = [];
  const wxApi = {
    showToast: (payload) => calls.push(['toast', payload]),
    requestPayment: (payload) => {
      calls.push(['pay', payload]);
      payload.success();
    },
  };
  const app = {
    globalData: { user: { is_minor: false } },
    track: (eventId, eventName, properties) => calls.push(['track', eventId, eventName, properties]),
  };

  const started = requestReportPayment({
    wxApi,
    app,
    sku: 'final_column',
    reportId: 'r2',
    paymentParams: validParams(),
  });

  assert.strictEqual(started, true);
  assert.strictEqual(calls[0][0], 'pay');
  assert.deepStrictEqual(calls[1], [
    'track',
    'E022',
    'payment_success',
    { sku: 'final_column', report_id: 'r2' },
  ]);
  assert.deepStrictEqual(calls[2], ['toast', { title: '解锁成功', icon: 'success' }]);
});

test('requestReportPayment 支付成功后主动查单 + 回调刷新(notify 兜底)', () => {
  const calls = [];
  const wxApi = {
    showToast: () => {},
    requestPayment: (payload) => payload.success(),
  };
  const app = { globalData: { user: { is_minor: false }, apiBase: 'https://x/api' }, track: () => {} };
  let onPaidCalled = false;
  const request = (opts) => { calls.push(['request', opts.url, opts.data]); if (opts.complete) opts.complete(); };

  requestReportPayment({
    wxApi, app, sku: 'deep_report', reportId: 'r9',
    paymentParams: validParams(), request, paymentId: 'pay-123',
    onPaid: () => { onPaidCalled = true; },
  });

  // 支付成功 → 打查单接口
  assert.deepStrictEqual(calls[0], ['request', 'https://x/api/payment/query', { paymentId: 'pay-123' }]);
  // 查单 complete 后回调刷新
  assert.strictEqual(onPaidCalled, true);
});

test('requestReportPayment tracks wx.requestPayment failure with report id', () => {
  const calls = [];
  const wxApi = {
    showToast: () => calls.push(['toast']),
    requestPayment: (payload) => {
      payload.fail({ errMsg: 'requestPayment:fail cancel' });
    },
  };
  const app = {
    globalData: { user: { is_minor: false } },
    track: (eventId, eventName, properties) => calls.push(['track', eventId, eventName, properties]),
  };

  const started = requestReportPayment({
    wxApi,
    app,
    sku: 'deep_report',
    reportId: 'r3',
    paymentParams: validParams(),
  });

  assert.strictEqual(started, true);
  assert.deepStrictEqual(calls[0], [
    'track',
    'E023',
    'payment_failed',
    { sku: 'deep_report', report_id: 'r3', error: 'requestPayment:fail cancel' },
  ]);
});

function validPayParams() {
  return {
    appId: 'wxapp',
    timeStamp: '1716000000',
    nonceStr: 'nonce',
    package: 'prepay_id=wx123',
    signType: 'RSA',
    paySign: 'signed',
  };
}

test('createReportPayment blocks minors before any network call', () => {
  const calls = [];
  const wxApi = { showToast: (p) => calls.push(['toast', p]), requestPayment: () => calls.push(['pay']) };
  const app = {
    globalData: { user: { is_minor: true }, apiBase: 'https://api/x' },
    track: (id, name, props) => calls.push(['track', id, name, props]),
  };
  const request = () => calls.push(['request']);

  const started = createReportPayment({ wxApi, app, request, sku: 'deep_report', reportId: 'r1' });

  assert.strictEqual(started, false);
  assert.deepStrictEqual(calls[0], ['track', 'E023', 'payment_failed', { sku: 'deep_report', report_id: 'r1', error: 'minor_payment_blocked' }]);
  assert.strictEqual(calls.some((c) => c[0] === 'request'), false);
  assert.strictEqual(calls.some((c) => c[0] === 'pay'), false);
});

test('createReportPayment fetches payParams then invokes wx.requestPayment', () => {
  const calls = [];
  const wxApi = {
    showToast: (p) => calls.push(['toast', p]),
    requestPayment: (payload) => { calls.push(['pay', payload.package]); payload.success(); },
  };
  const app = {
    globalData: { user: { is_minor: false }, apiBase: 'https://api/x' },
    track: (id, name, props) => calls.push(['track', id, name, props]),
  };
  const request = ({ url, method, data, success }) => {
    calls.push(['request', url, method, data]);
    success({ data: { ok: true, payParams: validPayParams() } });
  };

  const started = createReportPayment({ wxApi, app, request, sku: 'final_column', reportId: 'r2', scene: 'jsapi_mini' });

  assert.strictEqual(started, true);
  assert.deepStrictEqual(calls[0], ['request', 'https://api/x/payment/create', 'POST', { sku: 'final_column', scene: 'jsapi_mini', reportId: 'r2' }]);
  assert.deepStrictEqual(calls[1], ['pay', 'prepay_id=wx123']);
  assert.deepStrictEqual(calls[2], ['track', 'E022', 'payment_success', { sku: 'final_column', report_id: 'r2' }]);
});

test('createReportPayment tracks E023 and toasts when create request fails', () => {
  const calls = [];
  const wxApi = { showToast: (p) => calls.push(['toast', p]), requestPayment: () => calls.push(['pay']) };
  const app = {
    globalData: { user: { is_minor: false }, apiBase: 'https://api/x' },
    track: (id, name, props) => calls.push(['track', id, name, props]),
  };
  const request = ({ fail }) => fail({ errMsg: 'request:fail timeout' });

  const started = createReportPayment({ wxApi, app, request, sku: 'deep_report', reportId: 'r3' });

  assert.strictEqual(started, true);
  assert.deepStrictEqual(calls[0], ['track', 'E023', 'payment_failed', { sku: 'deep_report', report_id: 'r3', error: 'request:fail timeout' }]);
  assert.deepStrictEqual(calls[1], ['toast', { title: '下单失败，请重试', icon: 'none' }]);
  assert.strictEqual(calls.some((c) => c[0] === 'pay'), false);
});

test('createReportPayment toasts when request fn missing', () => {
  const calls = [];
  const wxApi = { showToast: (p) => calls.push(['toast', p]), requestPayment: () => calls.push(['pay']) };
  const app = { globalData: { user: { is_minor: false }, apiBase: '' }, track: () => {} };

  const started = createReportPayment({ wxApi, app, request: null, sku: 'deep_report', reportId: 'r4' });

  assert.strictEqual(started, false);
  assert.deepStrictEqual(calls[0], ['toast', { title: '支付暂未开放', icon: 'none' }]);
});
