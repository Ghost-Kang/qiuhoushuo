import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { ok } from '@/lib/api/respond';
import { trackServerEventGlobal } from '@/lib/api/tracker';
import { withAdmin } from '@/lib/api/with-admin';
import { PROMPT_VERSION } from '@/lib/prompts';

const Params = z.object({ id: z.string().uuid() });

const Body = z.object({
  title: z.string().min(8).max(40).optional(),
  subtitle: z.string().max(80).optional(),
  lead: z.string().min(40).max(300).optional(),
  body: z.array(z.string().min(60).max(500)).min(1).optional(),
  ending: z.string().min(40).max(300).optional(),
  share_quote: z.string().min(8).max(40).optional(),
  tags: z.array(z.string().min(1).max(20)).min(2).max(6).optional(),
  reviewer_note: z.string().min(5).max(500),
}).strict();

type EditableField = Exclude<keyof z.infer<typeof Body>, 'reviewer_note'>;

const EDITABLE_FIELDS: EditableField[] = ['title', 'subtitle', 'lead', 'body', 'ending', 'share_quote', 'tags'];

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  const reportId = parsed.data.id;
  return withAdmin(Body, async ({ body }) => updateReport(reportId, body), { bodyLimitBytes: 16 * 1024 })(req);
}

async function updateReport(reportId: string, body: z.infer<typeof Body>) {
  const fieldsUpdated = EDITABLE_FIELDS.filter((field) => body[field] !== undefined);
  if (!fieldsUpdated.length) return Response.json({ error: 'NO_FIELDS_TO_UPDATE' }, { status: 422 });

  const db = getSupabaseService();
  if (!db) return Response.json({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  const { data: existing } = await db.from('reports').select('id,tags').eq('id', reportId).maybeSingle();
  if (!existing) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

  const now = new Date().toISOString();
  const tags = appendReviewerTag(
    Array.isArray(body.tags) ? body.tags : Array.isArray(existing.tags) ? existing.tags : [],
    body.reviewer_note,
  );
  const update: Record<string, unknown> = {
    human_reviewed: true,
    is_fallback: false,
    prompt_version: `manual-edit-${PROMPT_VERSION}`,
    updated_at: now,
    tags,
  };
  for (const field of fieldsUpdated) {
    if (field !== 'tags') update[field] = body[field];
  }

  const { data: updated } = await db.from('reports').update(update).eq('id', reportId).select('id').maybeSingle();
  if (!updated) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

  trackServerEventGlobal({
    eventId: 'E046',
    properties: {
      report_id: reportId,
      fields_updated: fieldsUpdated,
      reviewer_note_redacted: `${body.reviewer_note.slice(0, 2)}**`,
    },
  });

  return ok({ report_id: reportId, fields_updated: fieldsUpdated, human_reviewed_at: now });
}

function appendReviewerTag(tags: string[], note: string) {
  const reviewerTag = `reviewer:${note.slice(0, 30)}`;
  return [...tags.filter((tag) => !tag.startsWith('reviewer:')).slice(0, 5), reviewerTag];
}
