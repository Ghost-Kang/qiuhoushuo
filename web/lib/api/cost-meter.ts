import { getValue, incrBy } from './quota-store';

const CNY_PER_1K: Record<string, number> = {
  doubao: 0.008,
  deepseek: 0.014,
  fallback: 0,
};
const DEFAULT_CNY_PER_1K = 0.008;

export const COST_CAP_CNY = Number(process.env.COST_CAP_CNY || 500);

export function costKey(date = new Date()) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `cost:${utc8.toISOString().slice(0, 10)}`;
}

export async function recordCost(provider: string, tokens: number) {
  const price = CNY_PER_1K[provider] ?? DEFAULT_CNY_PER_1K;
  const cents = Math.ceil((tokens / 1000) * price * 100);
  await incrBy(costKey(), cents, 36 * 60 * 60);
}

export async function getDailyCost() {
  const cents = Number((await getValue(costKey())) || 0);
  return cents / 100;
}
