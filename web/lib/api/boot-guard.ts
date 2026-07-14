export interface BootGuardOptions {
  guard: string;
  consequence: string;
  missing: string[];
  context?: Record<string, string | undefined>;
}

export function ensureBootGuard(opts: BootGuardOptions): void {
  if (opts.missing.length === 0) return;
  const message = `${opts.guard} 配置不全（${opts.consequence}）：缺 ${opts.missing.join(', ')}`;
  const structured = {
    level: 'P0',
    guard: `${opts.guard}-boot`,
    consequence: opts.consequence,
    missing: opts.missing,
    context: opts.context ?? {},
    timestamp: new Date().toISOString(),
  };
  console.error(`[${opts.guard}-boot] P0 ${message}`);
  console.error(`[${opts.guard}-boot] structured ${JSON.stringify(structured)}`);
  throw new Error(message);
}
