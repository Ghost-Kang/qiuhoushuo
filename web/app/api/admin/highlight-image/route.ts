import { z } from 'zod';
import { getCardStorage } from '@/lib/api/card-storage';
import { createHighlightImageProviderFromEnv, generateHighlightImage } from '@/lib/api/highlight-image';
import { withAdmin } from '@/lib/api/with-admin';

const Body = z.object({
  matchId: z.string().min(1).max(128),
  moment: z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    image_prompt: z.string().min(1).max(1000),
    minute: z.string().max(40).optional(),
  }),
}).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  const result = await generateHighlightImage(body, {
    provider: createHighlightImageProviderFromEnv(),
    storage: getCardStorage(),
  });
  return Response.json(result);
}, { bodyLimitBytes: 8 * 1024 });
