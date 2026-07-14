import { flagSnapshot } from '@/lib/api/feature-flags';
import { ok } from '@/lib/api/respond';
import { withAdminGet } from '@/lib/api/with-admin';

export const GET = withAdminGet(async () => {
  const flags = flagSnapshot();
  return ok({ flags, loaded_at: new Date().toISOString() });
});
