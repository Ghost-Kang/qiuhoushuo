import { checkAdminRateLimit } from './admin-rate-limit';
import { readJsonWithLimit } from './body-limit';
import { internal, unauthorized, withZod } from './respond';
import { timingSafeTokenEqual } from './token-compare';
import type { z } from 'zod';

export interface AdminContext<TBody> {
  req: Request;
  body: TBody;
  ip: string;
}

export type AdminHandler<TBody> = (ctx: AdminContext<TBody>) => Promise<Response>;
export type AdminGetHandler = (ctx: { req: Request; ip: string }) => Promise<Response>;

export function withAdmin<TBody>(
  bodySchema: z.ZodType<TBody>,
  handler: AdminHandler<TBody>,
  opts: { bodyLimitBytes?: number } = {},
): (req: Request) => Promise<Response> {
  const limit = opts.bodyLimitBytes ?? 2 * 1024;
  return async (req: Request) => {
    try {
      const limited = await checkAdminRateLimit(req);
      if (limited) return limited;
      if (!isAdmin(req)) return unauthorized();
      const body = await readJsonWithLimit<unknown>(req, limit);
      if (!body.ok) {
        return Response.json(
          body.error === 'PAYLOAD_TOO_LARGE' ? body : { error: 'invalid json' },
          { status: body.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400 },
        );
      }
      const parsed = withZod(bodySchema, body.data);
      if ('error' in parsed) return parsed.error;
      return await handler({ req, body: parsed.data, ip: adminIp(req) });
    } catch (err) {
      console.error('[admin] handler failed:', (err as Error).message);
      return internal(crypto.randomUUID());
    }
  };
}

export function withAdminGet(handler: AdminGetHandler): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      const limited = await checkAdminRateLimit(req);
      if (limited) return limited;
      if (!isAdmin(req)) return unauthorized();
      return await handler({ req, ip: adminIp(req) });
    } catch (err) {
      console.error('[admin] handler failed:', (err as Error).message);
      return internal(crypto.randomUUID());
    }
  };
}

function isAdmin(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return timingSafeTokenEqual(req.headers.get('x-admin-token'), expected);
}

function adminIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
}
