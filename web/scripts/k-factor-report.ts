#!/usr/bin/env tsx
/**
 * K 因子日报（Metabase fallback）。
 *
 * L02 / Metabase 真实落库未到位时的兜底：直接查 shares + landings 表，
 * 算出 K 因子、分享/回流/落地转化、平台分布、KOL 归因，输出文本或 JSON 日报。
 * 6/11 KOL Alpha 当天若 Metabase 未就绪，用 `pnpm kfactor` 出数（北极星 K≥0.8）。
 *
 * 用法：
 *   pnpm kfactor                       # 最近 24h
 *   pnpm kfactor --since 2026-06-11T00:00:00Z --until 2026-06-12T00:00:00Z
 *   pnpm kfactor --json                # JSON 输出（喂下游）
 */

import { pathToFileURL } from 'node:url';
import { getSupabaseService } from '@/lib/api/mode';

export interface ShareRow {
  user_id: string | null;
  platform: string;
  short_code: string;
  utm_kol: string | null;
  shared_at: string;
}

export interface LandingRow {
  short_code: string;
  utm_kol: string | null;
  registered: boolean;
  user_id: string | null;
  visited_at: string;
}

export interface KFactorReport {
  window: { since: string; until: string };
  shares: { total: number; sharers: number; byPlatform: Record<string, number> };
  landings: { total: number; registered: number };
  k: { kFactor: number; sharesPerSharer: number; registerPerLanding: number };
  byKol: Array<{ kol: string; shares: number; landings: number; registered: number }>;
}

type KFactorClient = {
  from(table: string): {
    select(columns: string): {
      gte(column: string, value: string): {
        lte(column: string, value: string): PromiseLike<{ data: Record<string, unknown>[] | null; error?: { message: string } | null }>;
      };
    };
  };
};

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function computeKFactor(shares: ShareRow[], landings: LandingRow[], window: { since: string; until: string }): KFactorReport {
  const sharers = new Set(shares.filter((s) => s.user_id).map((s) => s.user_id)).size;
  const totalShares = shares.length;
  const totalLandings = landings.length;
  const registered = landings.filter((l) => l.registered).length;

  const byPlatform: Record<string, number> = {};
  for (const s of shares) byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1;

  const kolMap = new Map<string, { shares: number; landings: number; registered: number }>();
  const ensure = (k: string) => {
    const existing = kolMap.get(k);
    if (existing) return existing;
    const fresh = { shares: 0, landings: 0, registered: 0 };
    kolMap.set(k, fresh);
    return fresh;
  };
  for (const s of shares) if (s.utm_kol) ensure(s.utm_kol).shares += 1;
  for (const l of landings) {
    if (!l.utm_kol) continue;
    const e = ensure(l.utm_kol);
    e.landings += 1;
    if (l.registered) e.registered += 1;
  }
  const byKol = [...kolMap.entries()]
    .map(([kol, v]) => ({ kol, shares: v.shares, landings: v.landings, registered: v.registered }))
    .sort((a, b) => b.registered - a.registered);

  return {
    window,
    shares: { total: totalShares, sharers, byPlatform },
    landings: { total: totalLandings, registered },
    k: {
      // K 因子 = 分享带来的新注册 / 分享用户数（每个分享者带来几个新用户；北极星 ≥ 0.8）
      kFactor: sharers > 0 ? round(registered / sharers) : 0,
      sharesPerSharer: sharers > 0 ? round(totalShares / sharers) : 0,
      registerPerLanding: totalLandings > 0 ? round(registered / totalLandings) : 0,
    },
    byKol,
  };
}

export function formatKFactorReport(r: KFactorReport): string {
  const lines: string[] = [
    '== 球后说 · K 因子日报（Metabase fallback）==',
    `窗口：${r.window.since} ~ ${r.window.until}`,
    '',
    `分享总数：${r.shares.total}（分享用户 ${r.shares.sharers} 人）`,
    `短链访问：${r.landings.total}，注册回流：${r.landings.registered}`,
    '',
    `K 因子（每个分享用户带来的新注册）：${r.k.kFactor}  ${r.k.kFactor >= 0.8 ? '✅ ≥ 北极星 0.8' : '⚠️ < 北极星 0.8'}`,
    `  · 人均分享 i = ${r.k.sharesPerSharer}`,
    `  · 落地转化 c = ${pct(r.k.registerPerLanding)}`,
    '',
    '分享平台分布：',
  ];
  const platforms = Object.entries(r.shares.byPlatform).sort((a, b) => b[1] - a[1]);
  if (platforms.length === 0) lines.push('  （无）');
  for (const [p, n] of platforms) lines.push(`  · ${p}: ${n}`);
  if (r.byKol.length) {
    lines.push('', 'KOL 归因（按注册回流降序）：');
    for (const k of r.byKol) lines.push(`  · ${k.kol}: 分享 ${k.shares} / 访问 ${k.landings} / 注册 ${k.registered}`);
  }
  return lines.join('\n');
}

async function fetchRows(client: KFactorClient, since: string, until: string): Promise<{ shares: ShareRow[]; landings: LandingRow[] }> {
  const s = await client.from('shares').select('user_id,platform,short_code,utm_kol,shared_at').gte('shared_at', since).lte('shared_at', until);
  if (s.error) throw new Error(`shares query: ${s.error.message}`);
  const l = await client.from('landings').select('short_code,utm_kol,registered,user_id,visited_at').gte('visited_at', since).lte('visited_at', until);
  if (l.error) throw new Error(`landings query: ${l.error.message}`);
  return {
    shares: (s.data ?? []) as unknown as ShareRow[],
    landings: (l.data ?? []) as unknown as LandingRow[],
  };
}

export async function kFactorReport(
  client: KFactorClient | null,
  opts: { since: string; until: string },
): Promise<KFactorReport | null> {
  if (!client) return null;
  const { shares, landings } = await fetchRows(client, opts.since, opts.until);
  return computeKFactor(shares, landings, opts);
}

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? null) : null;
}

function runCli(): void {
  const args = process.argv.slice(2);
  const since = argValue(args, '--since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = argValue(args, '--until') ?? new Date().toISOString();
  const asJson = args.includes('--json');
  const client = getSupabaseService() as unknown as KFactorClient | null;
  if (!client) {
    console.log('[kfactor] SUPABASE 未配置（USE_DB=false）：配 SUPABASE_URL + SUPABASE_SERVICE_KEY 后重跑。');
    process.exit(0);
  }
  kFactorReport(client, { since, until })
    .then((report) => {
      if (report) console.log(asJson ? JSON.stringify(report, null, 2) : formatKFactorReport(report));
    })
    .catch((err) => {
      console.error('[kfactor] fail:', (err as Error).message);
      process.exit(1);
    });
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) runCli();
