import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { runFfmpeg, ffprobeDurationSec } from '@/lib/api/laoli-ffmpeg';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function asSpawn(child: FakeChild): typeof spawn {
  return (() => child) as unknown as typeof spawn;
}

describe('runFfmpeg', () => {
  it('exit 0 → resolve', async () => {
    const child = fakeChild();
    const p = runFfmpeg(['-i', 'x'], 'ffmpeg', { spawnImpl: asSpawn(child) });
    queueMicrotask(() => child.emit('exit', 0));
    await expect(p).resolves.toBeUndefined();
  });

  it('非 0 退出 → 抛带 stderr 尾串', async () => {
    const child = fakeChild();
    const p = runFfmpeg(['x'], 'ffmpeg', { spawnImpl: asSpawn(child) });
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('boom-detail'));
      child.emit('exit', 1);
    });
    await expect(p).rejects.toThrow(/exited 1.*boom-detail/);
  });

  it('超时 → SIGKILL + 抛 timeout', async () => {
    const child = fakeChild();
    const p = runFfmpeg(['x'], 'ffmpeg', { spawnImpl: asSpawn(child), timeoutMs: 5 });
    await expect(p).rejects.toThrow(/timeout after 5ms/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('ffprobeDurationSec', () => {
  it('解析 12.34 → 12.34', async () => {
    const child = fakeChild();
    const p = ffprobeDurationSec('/x.mp4', 'ffprobe', { spawnImpl: asSpawn(child) });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('12.34\n'));
      child.emit('exit', 0);
    });
    await expect(p).resolves.toBe(12.34);
  });

  it('坏输出(N/A) → 抛 bad duration', async () => {
    const child = fakeChild();
    const p = ffprobeDurationSec('/x', 'ffprobe', { spawnImpl: asSpawn(child) });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('N/A'));
      child.emit('exit', 0);
    });
    await expect(p).rejects.toThrow(/bad duration/);
  });
});
