import { NextResponse } from 'next/server';
import { z } from 'zod';

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

export function badRequest(details: unknown) {
  return NextResponse.json({ error: 'BAD_REQUEST', details }, { status: 400 });
}

export function unauthorized() {
  return NextResponse.json({ error: 'NO_AUTH' }, { status: 401 });
}

export function internal(requestId: string) {
  return NextResponse.json({ error: 'INTERNAL', requestId }, { status: 500 });
}

export function getOpenid(req: Request): string | null {
  return req.headers.get('x-openid');
}

export function withZod<T>(schema: z.ZodType<T>, raw: unknown): { data: T } | { error: ReturnType<typeof badRequest> } {
  const r = schema.safeParse(raw);
  return r.success ? { data: r.data } : { error: badRequest(r.error.flatten()) };
}

export function requestId() {
  return crypto.randomUUID();
}
