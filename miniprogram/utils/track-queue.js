const DEFAULT_MAX_SIZE = 100;
const STORAGE_KEY = 'track_queue';

let maxSize = DEFAULT_MAX_SIZE;

function enqueue(event) {
  const queue = readQueue();
  queue.push(event);
  const dropped = [];
  while (queue.length > maxSize) {
    dropped.push(queue.shift());
  }
  if (dropped.length > 0) {
    console.warn('[track-queue] dropped oldest event(s):', dropped.map((evt) => evt && evt.event_id).join(','));
  }
  writeQueue(queue);
}

function flush(sender) {
  const queue = readQueue();
  if (queue.length === 0) return;

  let index = 0;
  function next() {
    if (index >= queue.length) {
      writeQueue([]);
      return;
    }
    const event = queue[index];
    sender(
      event,
      () => {
        index += 1;
        next();
      },
      () => {
        writeQueue(queue.slice(index));
      },
    );
  }
  next();
}

function peek() {
  return readQueue().slice();
}

function clear() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (err) {
    console.warn('[track-queue] clear failed:', err && err.message ? err.message : String(err));
  }
}

function setMaxSizeForTest(n) {
  maxSize = n;
}

function readQueue() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY) || [];
    return Array.isArray(raw) ? raw.slice() : [];
  } catch (err) {
    console.warn('[track-queue] read failed:', err && err.message ? err.message : String(err));
    return [];
  }
}

function writeQueue(queue) {
  try {
    wx.setStorageSync(STORAGE_KEY, queue);
  } catch (err) {
    console.warn('[track-queue] write failed:', err && err.message ? err.message : String(err));
  }
}

module.exports = { enqueue, flush, peek, clear, setMaxSizeForTest, DEFAULT_MAX_SIZE };
