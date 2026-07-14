import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDoubaoHighlightImageConfig } from '../lib/api/highlight-image';
import { buildLaoliReferenceRequest } from '../lib/api/laoli-reference';

async function main(): Promise<void> {
  const config = loadDoubaoHighlightImageConfig();
  const output = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), 'public', 'persona', 'laoli-ref-candidate.png');
  const response = await fetch(`${config.baseURL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildLaoliReferenceRequest(config)),
  });
  if (!response.ok) throw new Error(`Seedream generation failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> };
  const first = payload.data?.[0];
  if (!first) throw new Error('Seedream response missing data[0]');
  const image = first.b64_json
    ? Buffer.from(first.b64_json, 'base64')
    : await download(first.url);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, image);
  console.log(`[gen-laoli-ref] candidate written: ${output}`);
  console.log('[gen-laoli-ref] founder review required; do not replace approved laoli-ref.png automatically');
}

async function download(url: string | undefined): Promise<Buffer> {
  if (!url) throw new Error('Seedream response missing image URL');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Seedream image download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

void main();
