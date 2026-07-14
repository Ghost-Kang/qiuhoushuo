import { COST_CAP_CNY, getDailyCost } from './cost-meter';
import { getValue, scanPrefix } from './quota-store';

export async function quotaSnapshot() {
  const users = await scanPrefix('rl:user:');
  return {
    in_flight: Number(await getValue('global:inflight') || 0),
    today_cost_estimate_cny: await getDailyCost(),
    cost_cap_cny: COST_CAP_CNY,
    top_users_by_req: users
      .map((u) => ({ openid: u.key.replace('rl:user:', ''), count: Number(u.value) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    rate_limited_count_5min: Number(await getValue('meter:limited:5m') || 0),
  };
}
