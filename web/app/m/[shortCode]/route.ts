import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { isValidShortCode } from '@/lib/api/shortcode';
import { trackServerEventGlobal } from '@/lib/api/tracker';

const Params = z.object({ shortCode: z.string().refine(isValidShortCode) });

export async function GET(req: Request, ctx: { params: Promise<{ shortCode: string }> }) {
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  const shortCode = parsed.data.shortCode;
  const { data: match } = await db.from('matches').select('id').eq('short_code', shortCode).maybeSingle();
  if (!match?.id) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  void db.from('landings').insert({
    short_code: shortCode,
    match_id: match.id,
    utm_source: new URL(req.url).searchParams.get('utm_source') ?? 'shortlink',
    utm_kol: new URL(req.url).searchParams.get('utm_kol'),
    ua_fingerprint: req.headers.get('user-agent'),
    ip_hash: hashIp(clientIp(req)),
  });
  const { data: report } = await db.from('reports').select('id').eq('match_id', match.id).eq('style', 'hardcore').maybeSingle();
  if (!report?.id) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  trackServerEventGlobal({ eventId: 'E013', properties: { short_code: shortCode, match_id: match.id, report_id: report.id } });
  return NextResponse.redirect(new URL(`/report/${report.id}?utm_source=shortlink`, req.url), 302);
}

function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
}

function hashIp(ip: string) {
  return createHash('sha256').update(ip).digest('hex');
}
