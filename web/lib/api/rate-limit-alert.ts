import { notifyOpsFireAndForget } from '@/lib/alerts';
import { quotaSnapshot } from './quota-snapshot';
import { scanPrefix } from './quota-store';

const FLOOD_THRESHOLD = 100;

export async function maybeAlertRateLimitFlood(currentCount: number): Promise<void> {
  try {
    if (currentCount !== FLOOD_THRESHOLD) return;
    const snapshot = await quotaSnapshot();
    const topIps = await scanPrefix('rl:ip:');
    notifyOpsFireAndForget({
      severity: 'P1',
      title: '5 分钟限流命中突增',
      body:
        `limited_count_5m=${currentCount}\n` +
        `top_openid=${snapshot.top_users_by_req[0]?.openid ?? 'n/a'}:${snapshot.top_users_by_req[0]?.count ?? 0}\n` +
        `top_ip=${topIp(topIps)}`,
      tags: ['rate-limit', 'middleware'],
    }, {
      dedupKey: 'middleware:rate-limit-flood',
      dedupWindowMs: 5 * 60 * 1000,
    });
  } catch (err) {
    console.warn('[rate-limit-alert] failed:', (err as Error).message);
  }
}

function topIp(items: Array<{ key: string; value: string }>) {
  const first = items
    .map((i) => ({ ip: i.key.replace('rl:ip:', ''), count: Number(i.value) }))
    .sort((a, b) => b.count - a.count)[0];
  return first ? `${first.ip}:${first.count}` : 'n/a';
}
