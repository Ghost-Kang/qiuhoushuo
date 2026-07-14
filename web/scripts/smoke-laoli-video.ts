import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMockLaoliTtsProvider } from '../lib/api/laoli-tts';
import { composeLaoliVideo } from '../lib/api/laoli-video-compose';
import { buildLaoliVideoScript } from '../lib/api/laoli-video-script';
import { detectReferenceImageType } from '../lib/api/laoli-video';

async function main(): Promise<void> {
  process.env.LAOLI_VIDEO_RENDER_PROGRESS = '1';
  const output = path.resolve(process.argv[2] || path.join(process.cwd(), 'laoli-video-smoke.mp4'));
  const referenceImage = await readFile(path.join(process.cwd(), 'public', 'persona', 'laoli-ref.png'));
  const bgm = await readFile(path.join(process.cwd(), 'assets', 'bgm', 'heat.wav'));
  const script = buildLaoliVideoScript({
    match: '韩国 2:1 捷克',
    competition: '国际大赛',
    date: '2026-06-12',
    final_score: '2-1',
    events: [
      { minute: 59, type: 'yellow_card', team: '捷克', player: 'Krejci' },
      { minute: 80, type: 'goal', team: '韩国', player: '金球员' },
    ],
    stats: {
      possession: { home: 52, away: 48 },
      shots: { home: 13, away: 9 },
      shots_on_target: { home: 6, away: 3 },
    },
  }, {
    hardcore: {
      style: 'hardcore',
      title: '替补席改变了比赛走势',
      subtitle: '关键回合效率决定赛果',
      lead: '第80分钟的进球把反超写进了终场比分。',
      share_quote: '落后不是结局，换人之后才是正片。',
    },
  });
  const tts = await createMockLaoliTtsProvider().synthesize({ text: script.narration });
  const result = await composeLaoliVideo(script, {
    referenceImage,
    referenceImageType: detectReferenceImageType(referenceImage),
    ttsAudio: tts.audio,
    bgm,
  });
  await writeFile(output, result.video);
  console.log(JSON.stringify({ output, bytes: result.video.length, degraded: result.degraded }));
}

void main();
