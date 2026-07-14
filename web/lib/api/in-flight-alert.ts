import { notifyOpsFireAndForget } from '@/lib/alerts';
import { getValue, setValue } from './quota-store';

const KEY = 'inflight:alert:5m';
const TTL_SECONDS = 5 * 60;

export async function maybeAlertInFlightCap(currentInFlight: number, cap: number): Promise<void> {
  try {
    if (await getValue(KEY)) return;
    await setValue(KEY, '1', TTL_SECONDS);
    notifyOpsFireAndForget({
      severity: 'P1',
      title: 'API in-flight 容量打满',
      body: `in_flight=${currentInFlight}\ncap=${cap}`,
      tags: ['in-flight', 'middleware'],
    }, {
      dedupKey: 'middleware:in-flight-cap',
      dedupWindowMs: TTL_SECONDS * 1000,
    });
  } catch (err) {
    console.warn('[in-flight-alert] failed:', (err as Error).message);
  }
}
