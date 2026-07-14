import { z } from 'zod';

export const StoryLeadBody = z.object({
  role: z.enum(['client', 'employer', 'developer', 'other']),
  industry: z.string().trim().max(80).optional(),
  need: z.string().trim().max(500).optional(),
  contact: z.string().trim().min(5).max(80),
}).strict();

export type StoryLeadInput = z.infer<typeof StoryLeadBody>;

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function takeStoryLeadSlot(ip: string, now = Date.now()): boolean {
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= LIMIT) return false;
  current.count += 1;
  return true;
}

export function __resetStoryLeadRateLimitForTests(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || '127.0.0.1';
}

export function storyLeadWebhookConfigured(): boolean {
  return Boolean(process.env.WECOM_BOT_WEBHOOK);
}

export async function sendStoryLead(input: StoryLeadInput): Promise<{ ok: true } | { ok: false; status: 'missing-webhook' | 'send-failed' }> {
  const url = process.env.WECOM_BOT_WEBHOOK;
  if (!url) return { ok: false, status: 'missing-webhook' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content: formatStoryLeadMarkdown(input) },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: 'send-failed' };
    return { ok: true };
  } catch {
    return { ok: false, status: 'send-failed' };
  } finally {
    clearTimeout(timer);
  }
}

function formatStoryLeadMarkdown(input: StoryLeadInput): string {
  return [
    '### Story lead',
    `role: ${input.role}`,
    `industry: ${input.industry || '-'}`,
    `need: ${input.need || '-'}`,
    `contact: ${input.contact}`,
  ].join('\n');
}
