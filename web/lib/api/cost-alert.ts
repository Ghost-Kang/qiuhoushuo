import { notifyOpsFireAndForget } from '@/lib/alerts';
import { costKey } from './cost-meter';
import { getValue, setValue } from './quota-store';
import { trackServerEvent } from './tracker';

const TTL_SECONDS = 36 * 60 * 60;

export async function maybeAlertCostCap(currentCnyCost: number, cap: number): Promise<void> {
  try {
    if (!Number.isFinite(currentCnyCost) || !Number.isFinite(cap) || cap <= 0) return;
    if (currentCnyCost >= cap) {
      await fireOnce('cost:alert:fired', 'P0', 'LLM 成本已触顶', currentCnyCost, cap);
      return;
    }
    if (currentCnyCost >= cap * 0.8) {
      await fireOnce('cost:alert:warn80', 'P1', 'LLM 成本达到 80% 预警线', currentCnyCost, cap);
    }
  } catch (err) {
    console.warn('[cost-alert] failed:', (err as Error).message);
  }
}

async function fireOnce(prefix: string, severity: 'P0' | 'P1', title: string, currentCnyCost: number, cap: number) {
  const day = costKey().replace('cost:', '');
  const key = `${prefix}:${day}`;
  if (await getValue(key)) return;
  await setValue(key, '1', TTL_SECONDS);
  if (severity === 'P0') {
    trackServerEvent(null, { eventId: 'E092', properties: { daily_cost: currentCnyCost, cap } });
  }
  try {
    notifyOpsFireAndForget({
      severity,
      title,
      body: `current=${currentCnyCost.toFixed(2)} CNY\ncap=${cap.toFixed(2)} CNY\nbucket=${day}`,
      tags: ['cost-cap', 'middleware'],
    });
  } catch (err) {
    console.warn('[cost-alert] notify failed:', (err as Error).message);
  }
}
