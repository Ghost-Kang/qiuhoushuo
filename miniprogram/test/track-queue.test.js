const test = require('node:test');
const assert = require('node:assert');

let storage = {};
const warnLog = [];
global.wx = {
  getStorageSync: (key) => (storage[key] !== undefined ? storage[key] : ''),
  setStorageSync: (key, value) => {
    storage[key] = value;
  },
  removeStorageSync: (key) => {
    delete storage[key];
  },
};

const originalWarn = console.warn;
console.warn = (...args) => {
  warnLog.push(args);
};

test.beforeEach(() => {
  storage = {};
  warnLog.length = 0;
  delete require.cache[require.resolve('../utils/track-queue')];
});

test.after(() => {
  console.warn = originalWarn;
});

function makeEvt(id) {
  return { event_id: id, event_name: 'test', properties: {}, openid: 'oxxx', ts: Date.now() };
}

test('enqueue stores single event in storage', () => {
  const q = require('../utils/track-queue');
  q.enqueue(makeEvt('E001'));
  assert.strictEqual(q.peek().length, 1);
  assert.strictEqual(q.peek()[0].event_id, 'E001');
});

test('enqueue beyond max drops oldest FIFO and warns', () => {
  const q = require('../utils/track-queue');
  q.setMaxSizeForTest(3);
  q.enqueue(makeEvt('E001'));
  q.enqueue(makeEvt('E002'));
  q.enqueue(makeEvt('E003'));
  q.enqueue(makeEvt('E004'));
  const queue = q.peek();
  assert.strictEqual(queue.length, 3);
  assert.deepStrictEqual(queue.map((evt) => evt.event_id), ['E002', 'E003', 'E004']);
  assert.ok(warnLog.length >= 1, 'expected warn for drop');
});

test('flush calls sender for each event and clears on full success', () => {
  const q = require('../utils/track-queue');
  q.enqueue(makeEvt('E001'));
  q.enqueue(makeEvt('E002'));
  const sent = [];
  q.flush((evt, onSuccess) => {
    sent.push(evt.event_id);
    onSuccess();
  });
  assert.deepStrictEqual(sent, ['E001', 'E002']);
  assert.strictEqual(q.peek().length, 0);
});

test('flush stops at first failure and keeps remaining', () => {
  const q = require('../utils/track-queue');
  q.enqueue(makeEvt('E001'));
  q.enqueue(makeEvt('E002'));
  q.enqueue(makeEvt('E003'));
  const sent = [];
  q.flush((evt, onSuccess, onFail) => {
    sent.push(evt.event_id);
    if (evt.event_id === 'E002') onFail();
    else onSuccess();
  });
  assert.deepStrictEqual(sent, ['E001', 'E002']);
  assert.deepStrictEqual(q.peek().map((evt) => evt.event_id), ['E002', 'E003']);
});

test('flush on empty queue does not call sender', () => {
  const q = require('../utils/track-queue');
  let called = false;
  q.flush(() => {
    called = true;
  });
  assert.strictEqual(called, false);
});

test('clear empties the queue', () => {
  const q = require('../utils/track-queue');
  q.enqueue(makeEvt('E001'));
  q.clear();
  assert.strictEqual(q.peek().length, 0);
});

test('setStorageSync throw is caught and does not propagate', () => {
  const q = require('../utils/track-queue');
  const originalSet = global.wx.setStorageSync;
  global.wx.setStorageSync = () => {
    throw new Error('storage full');
  };
  assert.doesNotThrow(() => q.enqueue(makeEvt('E001')));
  global.wx.setStorageSync = originalSet;
});
