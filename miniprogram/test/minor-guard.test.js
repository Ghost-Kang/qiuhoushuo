const test = require('node:test');
const assert = require('node:assert');

const {
  canMinorUseAt,
  isMinorUser,
  minorRestrictionNotice,
  maybeShowMinorUsageNotice,
  shouldBlockPayment,
} = require('../utils/minor-guard');

test('isMinorUser only treats explicit is_minor=true as minor mode', () => {
  assert.strictEqual(isMinorUser(null), false);
  assert.strictEqual(isMinorUser({ is_minor: false }), false);
  assert.strictEqual(isMinorUser({ is_minor: true }), true);
});

test('canMinorUseAt blocks 22:00-8:00 quiet hours', () => {
  assert.strictEqual(canMinorUseAt(new Date('2026-06-04T07:59:00')), false);
  assert.strictEqual(canMinorUseAt(new Date('2026-06-04T08:00:00')), true);
  assert.strictEqual(canMinorUseAt(new Date('2026-06-04T21:59:00')), true);
  assert.strictEqual(canMinorUseAt(new Date('2026-06-04T22:00:00')), false);
});

test('minorRestrictionNotice is empty for adults and explanatory for minors', () => {
  assert.strictEqual(minorRestrictionNotice({ is_minor: false }, new Date('2026-06-04T12:00:00')), '');
  assert.strictEqual(
    minorRestrictionNotice({ is_minor: true }, new Date('2026-06-04T12:00:00')),
    '未成年人模式：禁止付费，单日使用不超过 60 分钟',
  );
  assert.strictEqual(
    minorRestrictionNotice({ is_minor: true }, new Date('2026-06-04T23:00:00')),
    '未成年人模式：22:00-8:00 暂停使用',
  );
});

test('shouldBlockPayment blocks minor users only', () => {
  assert.strictEqual(shouldBlockPayment({ is_minor: true }), true);
  assert.strictEqual(shouldBlockPayment({ is_minor: false }), false);
});

test('maybeShowMinorUsageNotice shows one light toast per notice per day', () => {
  const calls = [];
  const wxApi = { showToast: (payload) => calls.push(payload) };
  const app = { globalData: { user: { is_minor: true }, minorNoticeShownKey: '' } };
  const date = new Date('2026-06-04T12:00:00');

  assert.strictEqual(maybeShowMinorUsageNotice({ wxApi, app, date }), true);
  assert.strictEqual(maybeShowMinorUsageNotice({ wxApi, app, date }), false);
  assert.deepStrictEqual(calls, [
    { title: '未成年人模式：禁止付费，单日使用不超过 60 分钟', icon: 'none' },
  ]);
});

test('maybeShowMinorUsageNotice does not bother adult users', () => {
  const calls = [];
  const wxApi = { showToast: (payload) => calls.push(payload) };
  const app = { globalData: { user: { is_minor: false }, minorNoticeShownKey: '' } };
  assert.strictEqual(maybeShowMinorUsageNotice({ wxApi, app, date: new Date('2026-06-04T12:00:00') }), false);
  assert.deepStrictEqual(calls, []);
});
