import { checkAdminRateLimit } from '@/lib/api/admin-rate-limit';
import { ok, unauthorized } from '@/lib/api/respond';
import { quotaSnapshot } from '@/lib/api/quota-snapshot';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

export async function GET(req: Request) {
  const limited = await checkAdminRateLimit(req);
  if (limited) return limited;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !timingSafeTokenEqual(req.headers.get('x-admin-token'), expected)) {
    return unauthorized();
  }
  return ok(await quotaSnapshot());
}
