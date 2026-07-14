import { z } from 'zod';
import { currentThresholds } from '@/lib/api/finals-mode';
import { getSupabaseService } from '@/lib/api/mode';
import { setValue } from '@/lib/api/quota-store';
import { ok } from '@/lib/api/respond';
import { trackServerEvent } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';

const Body = z.object({
  cap_cny: z.number().min(100).max(50000),
  ttl_seconds: z.number().int().min(60).max(86400),
  reason: z.string().min(1).max(200),
}).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  const { cap_cny: cap, ttl_seconds: ttl, reason } = body;
  const previousCap = currentThresholds().costCapCny;
  await setValue('cost-cap-override', String(cap), ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  trackServerEvent(getSupabaseService(), { eventId: 'E095', properties: { cap_cny: cap, previous_cap_cny: previousCap, ttl_seconds: ttl, reason, expires_at: expiresAt } });
  return ok({ active_cap_cny: cap, previous_cap_cny: previousCap, expires_at: expiresAt });
});
