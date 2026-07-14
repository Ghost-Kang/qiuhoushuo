import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { setValue } from '@/lib/api/quota-store';
import { ok } from '@/lib/api/respond';
import { trackServerEvent } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';

const Body = z.object({
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  ttl_seconds: z.number().int().min(60).max(86400),
  reason: z.string().min(1).max(200),
}).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  const { ip, ttl_seconds: ttl, reason } = body;
  await setValue(`ban:ip:${ip}`, '1', ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  trackServerEvent(getSupabaseService(), { eventId: 'E094', properties: { ip, ttl_seconds: ttl, reason, expires_at: expiresAt } });
  return ok({ banned: ip, expires_at: expiresAt });
});
