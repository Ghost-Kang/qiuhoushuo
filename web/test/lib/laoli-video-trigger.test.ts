import { describe, expect, it, vi } from 'vitest';
import { triggerLaoliVideoFireAndForget } from '@/lib/api/laoli-video-trigger';

describe('laoli video auto trigger', () => {
  it('does nothing unless both auto and enabled gates are open', () => {
    const fetchImpl = vi.fn();
    triggerLaoliVideoFireAndForget('m1', { env: { NODE_ENV: 'test' }, fetchImpl });
    triggerLaoliVideoFireAndForget('m1', {
      env: { NODE_ENV: 'test', LAOLI_VIDEO_AUTO: '1', ADMIN_API_SECRET: 'secret' },
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fires the internal admin request without awaiting the long job', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    triggerLaoliVideoFireAndForget('m1', {
      env: {
        NODE_ENV: 'test',
        LAOLI_VIDEO_AUTO: '1',
        LAOLI_VIDEO_ENABLED: '1',
        ADMIN_API_SECRET: 'secret',
      },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/admin/laoli-video',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({ matchId: 'm1' }),
      }),
    );
    await Promise.resolve();
  });
});
