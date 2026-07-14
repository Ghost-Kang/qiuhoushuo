import { notifyOpsFireAndForget } from '../alerts';

export function triggerLaoliVideoFireAndForget(
  matchId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {},
): void {
  const env = options.env || process.env;
  const autoFlag = options.env?.LAOLI_VIDEO_AUTO ?? process.env.LAOLI_VIDEO_AUTO;
  const enabledFlag = options.env?.LAOLI_VIDEO_ENABLED ?? process.env.LAOLI_VIDEO_ENABLED;
  if (autoFlag !== '1' && autoFlag !== 'true') return;
  if (enabledFlag !== '1' && enabledFlag !== 'true') return;
  const secret = env.ADMIN_API_SECRET;
  if (!secret) {
    console.warn('[laoli-video] auto trigger skipped: ADMIN_API_SECRET missing');
    return;
  }
  const fetchImpl = options.fetchImpl || fetch;
  // fire-and-forget: Seedance 可能运行数分钟，绝不阻塞 auto-report 主链路。
  void fetchImpl('http://127.0.0.1:3000/api/admin/laoli-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ matchId }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }).catch((error) => {
    notifyOpsFireAndForget(
      {
        severity: 'P1',
        title: '老李赛后视频自动生成异常',
        body: `match=${matchId}\n${(error as Error).message}`,
        tags: ['laoli-video', 'auto-report'],
      },
      { dedupKey: `laoli-video-auto:${matchId}`, dedupWindowMs: 10 * 60 * 1000 },
    );
  });
}
