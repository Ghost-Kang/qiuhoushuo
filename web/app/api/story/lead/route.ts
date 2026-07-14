import { storyEnabled } from '@/lib/api/feature-flags';
import { clientIp, sendStoryLead, storyLeadWebhookConfigured, StoryLeadBody, takeStoryLeadSlot } from '@/lib/story/lead';

export async function POST(req: Request): Promise<Response> {
  if (!storyEnabled()) return new Response('Not found', { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const parsed = StoryLeadBody.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });

  if (!storyLeadWebhookConfigured()) return Response.json({ error: 'WEBHOOK_UNAVAILABLE' }, { status: 503 });

  if (!takeStoryLeadSlot(clientIp(req))) {
    return Response.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  const sent = await sendStoryLead(parsed.data);
  if (!sent.ok) return Response.json({ error: 'SEND_FAILED' }, { status: 502 });
  return Response.json({ ok: true });
}
