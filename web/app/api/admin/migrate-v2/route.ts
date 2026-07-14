import { z } from 'zod';
import { getSupabaseService } from '@/lib/api/mode';
import { withAdmin } from '@/lib/api/with-admin';
import { runSchemaV2Migration } from '@/lib/db/migration-v2';

const BodySchema = z.object({
  confirmText: z.literal('I-UNDERSTAND-MIGRATION-IS-IRREVERSIBLE'),
}).strict();

export const POST = withAdmin(BodySchema, async () => {
  const client = getSupabaseService();
  if (!client) return Response.json({ error: 'db_unavailable' }, { status: 503 });
  const summary = await runSchemaV2Migration(client);
  return Response.json(summary, { status: summary.overallOk ? 200 : 500 });
});
