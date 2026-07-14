import { ensureBootGuard } from './boot-guard';

export function assertSupabaseConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (!env.SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  ensureBootGuard({
    guard: 'supabase',
    consequence: 'production DB 写入与 anon 读路径（reports/recent / matches/today）会降级到 mock',
    missing,
    context: { NODE_ENV: env.NODE_ENV },
  });
}
