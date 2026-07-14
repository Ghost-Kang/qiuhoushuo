const MINOR_DAILY_LIMIT_MINUTES = 60;
const QUIET_HOUR_START = 22;
const QUIET_HOUR_END = 8;

function isMinorUser(user) {
  return !!(user && user.is_minor === true);
}

function canMinorUseAt(date = new Date()) {
  const hour = date.getHours();
  return hour >= QUIET_HOUR_END && hour < QUIET_HOUR_START;
}

function minorRestrictionNotice(user, date = new Date()) {
  if (!isMinorUser(user)) return '';
  if (!canMinorUseAt(date)) return '未成年人模式：22:00-8:00 暂停使用';
  return `未成年人模式：禁止付费，单日使用不超过 ${MINOR_DAILY_LIMIT_MINUTES} 分钟`;
}

function shouldBlockPayment(user) {
  return isMinorUser(user);
}

function maybeShowMinorUsageNotice({ wxApi = wx, app, date = new Date() }) {
  const user = app && app.globalData ? app.globalData.user : null;
  const notice = minorRestrictionNotice(user, date);
  if (!notice) return false;
  const key = `${date.toISOString().slice(0, 10)}:${notice}`;
  if (app.globalData.minorNoticeShownKey === key) return false;
  app.globalData.minorNoticeShownKey = key;
  wxApi.showToast({ title: notice, icon: 'none' });
  return true;
}

module.exports = {
  MINOR_DAILY_LIMIT_MINUTES,
  QUIET_HOUR_END,
  QUIET_HOUR_START,
  canMinorUseAt,
  isMinorUser,
  maybeShowMinorUsageNotice,
  minorRestrictionNotice,
  shouldBlockPayment,
};
