import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { ok } from '@/lib/api/respond';
import { withAdminGet } from '@/lib/api/with-admin';

const Params = z.object({ id: z.string().uuid() });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  const reportId = parsed.data.id;
  return withAdminGet(async () => readReport(reportId))(req);
}

async function readReport(reportId: string) {
  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  const { data } = await db
    .from('reports')
    .select('id,match_id,style,title,subtitle,lead,body,ending,share_quote,tags,prompt_version,llm_provider,is_fallback,is_premium,human_reviewed,created_at,updated_at')
    .eq('id', reportId)
    .maybeSingle();
  if (!data) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  return ok({ report_id: data.id, ...data });
}
