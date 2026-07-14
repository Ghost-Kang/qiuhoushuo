import { createHash } from 'crypto';
import { z } from 'zod';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { getSupabaseAnon, getSupabaseService, USE_DB, USE_WECHAT } from '@/lib/api/mode';
import { mockLogin } from '@/lib/api/mock';
import { badRequest, internal, ok, requestId, withZod } from '@/lib/api/respond';
import { ensureUserByOpenid, type EnsureUserClient } from '@/lib/api/users';

const Body = z.object({ code: z.string().min(1) }).strict();

export async function POST(req: Request) {
  const rid = requestId();
  try {
    const parsed = withZod(Body, await req.json().catch(() => null));
    if ('error' in parsed) return parsed.error;
    const { code } = parsed.data;
    let openid: string;
    if (!USE_WECHAT) {
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
      openid = `mock_${hash}`;
    } else {
      const qs = new URLSearchParams({
        appid: process.env.WX_APPID!,
        secret: process.env.WX_SECRET!,
        js_code: code,
        grant_type: 'authorization_code',
      });
      const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${qs}`);
      const data = await res.json();
      if (!data.openid) return badRequest({ wx: data.errcode || 'NO_OPENID' });
      openid = data.openid;
    }

    const whitelisted = isInternalAllowed(openid);
    if (isFeatureEnabled('feature.internal_only', { openid }) && !whitelisted) {
      return badRequest({ phase: 'INTERNAL_TEST_ONLY' });
    }
    if (!isFeatureEnabled('feature.public_register', { openid }) && !whitelisted) {
      const existing = await isRegisteredUser(openid);
      if (!existing) return badRequest({ phase: 'REGISTRATION_CLOSED' });
    }
    await ensureLoginUser(openid);
    return ok(mockLogin(openid));
  } catch {
    return internal(rid);
  }
}

function isInternalAllowed(openid: string): boolean {
  return (process.env.INTERNAL_ALLOWED_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .includes(openid);
}

async function isRegisteredUser(openid: string): Promise<boolean> {
  if (!USE_DB) return true;
  const db = getSupabaseAnon();
  if (!db) return true;
  const { data } = await db.from('users').select('id').eq('wx_openid', openid).maybeSingle();
  return Boolean(data);
}

async function ensureLoginUser(openid: string): Promise<void> {
  if (!USE_DB) return;
  const db = getSupabaseService();
  if (!db) return;
  await ensureUserByOpenid(db as unknown as EnsureUserClient, openid);
}
