import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pcmToWav } from '../lib/api/laoli-tts';

const SAMPLE_RATE = 24000;
const DURATION_SEC = 35;

const tracks = [
  { id: 'heat', notes: [110, 146.83, 164.81, 220], pulse: 2 },
  { id: 'warm', notes: [130.81, 164.81, 196, 246.94], pulse: 1 },
  { id: 'comic', notes: [146.83, 185, 220, 293.66], pulse: 3 },
] as const;

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'assets', 'bgm');
  await mkdir(outDir, { recursive: true });

  for (const track of tracks) {
    const samples = Buffer.alloc(SAMPLE_RATE * DURATION_SEC * 2);
    for (let i = 0; i < SAMPLE_RATE * DURATION_SEC; i += 1) {
      const second = i / SAMPLE_RATE;
      const note = track.notes[Math.floor(second * track.pulse) % track.notes.length]!;
      const envelope = Math.min(1, (second % (1 / track.pulse)) * 10) * 0.12;
      const bass = Math.sin(2 * Math.PI * note * second);
      const shimmer = Math.sin(2 * Math.PI * note * 2 * second) * 0.18;
      const kickPhase = second % (1 / track.pulse);
      const kick = kickPhase < 0.08 ? Math.sin(2 * Math.PI * 60 * second) * (1 - kickPhase / 0.08) : 0;
      const value = Math.max(-1, Math.min(1, (bass + shimmer) * envelope + kick * 0.16));
      samples.writeInt16LE(Math.round(value * 32767), i * 2);
    }
    await writeFile(path.join(outDir, `${track.id}.wav`), pcmToWav(samples, SAMPLE_RATE, 1));
  }
}

void main();
