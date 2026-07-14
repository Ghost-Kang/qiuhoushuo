import { z } from 'zod';
import { getOpenid, ok, unauthorized, withZod } from '@/lib/api/respond';
import { mockChatRooms } from '@/lib/api/mock';

const Query = z.object({}).strict();

export async function GET(req: Request) {
  if (!getOpenid(req)) return unauthorized();
  const parsed = withZod(Query, Object.fromEntries(new URL(req.url).searchParams));
  if ('error' in parsed) return parsed.error;
  return ok(mockChatRooms());
}
