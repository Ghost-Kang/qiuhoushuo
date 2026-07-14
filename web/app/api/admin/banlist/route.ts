import { z } from 'zod';
import { delValue, scanPrefix, setValue } from '@/lib/api/quota-store';
import { ok, unauthorized, withZod } from '@/lib/api/respond';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';

const Ban = z.object({ ip: z.string().min(3), reason: z.string().min(1).optional().default('manual') }).strict();
const Unban = z.object({ ip: z.string().min(3) }).strict();

export async function GET(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const items = await scanPrefix('ban:ip:');
  return ok({ items: items.map((i) => ({ ip: i.key.replace('ban:ip:', ''), reason: i.value })) });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const parsed = withZod(Ban, await req.json().catch(() => null));
  if ('error' in parsed) return parsed.error;
  await setValue(`ban:ip:${parsed.data.ip}`, parsed.data.reason ?? 'manual', 30 * 24 * 60 * 60);
  return ok({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const parsed = withZod(Unban, await req.json().catch(() => null));
  if ('error' in parsed) return parsed.error;
  await delValue(`ban:ip:${parsed.data.ip}`);
  return ok({ ok: true });
}

function isAdmin(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return timingSafeTokenEqual(req.headers.get('x-admin-token'), expected);
}
