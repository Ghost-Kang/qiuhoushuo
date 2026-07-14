import { NextResponse } from 'next/server';
import { incrWindow } from './quota-store';

const LIMIT_PER_MIN = 10;

export async function checkAdminRateLimit(req: Request): Promise<Response | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
  const { count, retryAfter } = await incrWindow(`rl:admin:${ip}`, 60);
  if (count <= LIMIT_PER_MIN) return null;
  return NextResponse.json({ error: 'RATE_LIMIT_ADMIN', retryAfter }, { status: 429 });
}
