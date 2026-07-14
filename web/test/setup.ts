import { beforeEach } from 'vitest';
import { _clearDedupCacheForTest } from '@/lib/alerts/dedup-cache';

beforeEach(() => {
  _clearDedupCacheForTest();
});
