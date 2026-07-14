const REQUIRED_PAYMENT_FIELDS = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'];
const { shouldBlockPayment } = require('./minor-guard');

function hasValidPaymentParams(params) {
  if (!params || typeof params !== 'object') return false;
  return REQUIRED_PAYMENT_FIELDS.every((field) => typeof params[field] === 'string' && params[field].trim().length > 0);
}

function requestReportPayment({ wxApi = wx, app, sku, reportId, paymentParams, request, paymentId, onPaid }) {
  const user = app && app.globalData ? app.globalData.user : null;
  if (shouldBlockPayment(user)) {
    if (app && typeof app.track === 'function') {
      app.track('E023', 'payment_failed', {
        sku,
        report_id: reportId,
        error: 'minor_payment_blocked',
      });
    }
    wxApi.showToast({ title: '未成年人模式不可付费', icon: 'none' });
    return false;
  }

  if (!hasValidPaymentParams(paymentParams)) {
    if (app && typeof app.track === 'function') {
      app.track('E023', 'payment_failed', {
        sku,
        report_id: reportId,
        error: 'prepay_not_configured',
      });
    }
    wxApi.showToast({ title: '支付暂未开放', icon: 'none' });
    return false;
  }

  wxApi.requestPayment({
    ...paymentParams,
    success: () => {
      if (app && typeof app.track === 'function') {
        app.track('E022', 'payment_success', { sku, report_id: reportId });
      }
      wxApi.showToast({ title: '解锁成功', icon: 'success' });
      // 主动查单兜底:微信 notify 可能延迟/丢失,支付成功后立即查单结算,再回调刷新报告解锁内容。
      const apiBase = app && app.globalData ? app.globalData.apiBase : '';
      if (typeof request === 'function' && paymentId) {
        request({
          url: `${apiBase}/payment/query`,
          method: 'POST',
          data: { paymentId },
          complete: () => { if (typeof onPaid === 'function') onPaid(); },
        });
      } else if (typeof onPaid === 'function') {
        onPaid();
      }
    },
    fail: (err) => {
      if (app && typeof app.track === 'function') {
        app.track('E023', 'payment_failed', {
          sku,
          report_id: reportId,
          error: err && err.errMsg ? err.errMsg : 'request_payment_failed',
        });
      }
    },
  });
  return true;
}

// 完整下单链路：先调后端 /api/payment/create 拿 payParams，再调起微信支付。
// scene=jsapi_mini（安卓小程序内直购）；iOS 走服务号 H5（web 侧）。
function createReportPayment({ wxApi = wx, app, request, sku, reportId, scene = 'jsapi_mini', onPaid }) {
  const user = app && app.globalData ? app.globalData.user : null;
  if (shouldBlockPayment(user)) {
    if (app && typeof app.track === 'function') {
      app.track('E023', 'payment_failed', { sku, report_id: reportId, error: 'minor_payment_blocked' });
    }
    wxApi.showToast({ title: '未成年人模式不可付费', icon: 'none' });
    return false;
  }
  if (typeof request !== 'function') {
    wxApi.showToast({ title: '支付暂未开放', icon: 'none' });
    return false;
  }

  const apiBase = app && app.globalData ? app.globalData.apiBase : '';
  request({
    url: `${apiBase}/payment/create`,
    method: 'POST',
    data: { sku, scene, reportId },
    success: (res) => {
      const payParams = res && res.data ? res.data.payParams : null;
      const paymentId = res && res.data ? res.data.paymentId : null;
      requestReportPayment({ wxApi, app, sku, reportId, paymentParams: payParams, request, paymentId, onPaid });
    },
    fail: (err) => {
      if (app && typeof app.track === 'function') {
        app.track('E023', 'payment_failed', {
          sku,
          report_id: reportId,
          error: err && err.errMsg ? err.errMsg : 'payment_create_failed',
        });
      }
      wxApi.showToast({ title: '下单失败，请重试', icon: 'none' });
    },
  });
  return true;
}

module.exports = {
  hasValidPaymentParams,
  requestReportPayment,
  createReportPayment,
};
