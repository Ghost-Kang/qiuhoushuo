import { createHash, createHmac } from 'node:crypto';
import type { LaoliAvatarInput, LaoliAvatarOutput, LaoliAvatarProvider } from './laoli-avatar';

/**
 * 火山引擎智能视觉「OmniHuman 数字人」音频驱动对口型 provider。
 * 接口实证(github min-star/omnihuman-api):
 *   host  visual.volcengineapi.com / region cn-north-1 / service cv / 签名 Signature V4(AK/SK)
 *   提交  Action=CVSubmitTask&Version=2022-08-31  body{req_key,image_url,audio_url} → data.task_id
 *   轮询  Action=CVGetResult&Version=2022-08-31   body{req_key,task_id} → data.status==='done' → data.video_url
 *   req_key  jimeng_realman_avatar_picture_omni_v15;image_url/audio_url 均需公网可达。
 * 凭证 OMNIHUMAN_ACCESS_KEY/SECRET_KEY 只进生产机 .env,禁入 git。
 */
export const OMNIHUMAN_REQ_KEY = 'jimeng_realman_avatar_picture_omni_v15';
const OMNIHUMAN_VERSION = '2022-08-31';
const SIGN_ALGORITHM = 'HMAC-SHA256';
const SIGNED_HEADERS = 'content-type;host;x-content-sha256;x-date';

export interface OmnihumanConfig {
  accessKey: string;
  secretKey: string;
  host: string;
  region: string;
  service: string;
  reqKey: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

export function loadOmnihumanConfig(env: NodeJS.ProcessEnv = process.env): OmnihumanConfig {
  const accessKey = env.OMNIHUMAN_ACCESS_KEY;
  const secretKey = env.OMNIHUMAN_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error('[laoli-omnihuman] OMNIHUMAN_ACCESS_KEY / OMNIHUMAN_SECRET_KEY missing（火山控制台开通后注入生产机 .env）');
  }
  return {
    accessKey,
    secretKey,
    host: env.OMNIHUMAN_HOST || 'visual.volcengineapi.com',
    region: env.OMNIHUMAN_REGION || 'cn-north-1',
    service: env.OMNIHUMAN_SERVICE || 'cv',
    reqKey: env.OMNIHUMAN_REQ_KEY || OMNIHUMAN_REQ_KEY,
    pollIntervalMs: positiveInt(env.OMNIHUMAN_POLL_INTERVAL_MS, 3_000),
    timeoutMs: positiveInt(env.OMNIHUMAN_TIMEOUT_MS, 600_000),
  };
}

export interface SignedVisualRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Action/Version 排序后拼成 querystring(火山要求按 key 字典序)。 */
export function formatVisualQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

/**
 * 火山 Signature V4 签名。与 AWS V4 的关键差异：派生密钥种子直接是 secretKey(无 "AWS4" 前缀)。
 * clock 注入以便单测确定性复算签名。
 */
export function signVolcVisualV4(input: {
  cfg: Pick<OmnihumanConfig, 'accessKey' | 'secretKey' | 'host' | 'region' | 'service'>;
  query: string;
  body: string;
  clock?: () => Date;
}): SignedVisualRequest {
  const { cfg } = input;
  const now = (input.clock ?? (() => new Date()))();
  const currentDate = formatAmzDate(now);
  const dateStamp = currentDate.slice(0, 8);
  const contentType = 'application/json';
  const payloadHash = sha256Hex(input.body);

  const canonicalHeaders =
    `content-type:${contentType}\n`
    + `host:${cfg.host}\n`
    + `x-content-sha256:${payloadHash}\n`
    + `x-date:${currentDate}\n`;
  const canonicalRequest = [
    'POST',
    '/',
    input.query,
    canonicalHeaders,
    SIGNED_HEADERS,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${cfg.region}/${cfg.service}/request`;
  const stringToSign = [
    SIGN_ALGORITHM,
    currentDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(cfg.secretKey, dateStamp, cfg.region, cfg.service);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization =
    `${SIGN_ALGORITHM} Credential=${cfg.accessKey}/${credentialScope}, `
    + `SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`;

  return {
    url: `https://${cfg.host}/?${input.query}`,
    headers: {
      'X-Date': currentDate,
      'X-Content-Sha256': payloadHash,
      'Content-Type': contentType,
      Authorization: authorization,
    },
    body: input.body,
  };
}

export function createOmnihumanAvatarProvider(
  cfg: OmnihumanConfig = loadOmnihumanConfig(),
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => Date = () => new Date(),
): LaoliAvatarProvider {
  return {
    name: 'omnihuman',
    // 官方:音频须<60s,建议≤15s(超 15s 结构稳定性衰退)。与 Seedance 同甜区,按 15s 分段。
    maxClipSec: 15,
    async generate(input: LaoliAvatarInput): Promise<LaoliAvatarOutput> {
      if (!input.imageUrl) throw new Error('[laoli-omnihuman] requires public imageUrl');
      if (!input.audioUrl) throw new Error('[laoli-omnihuman] requires public audioUrl');

      const taskId = await submitTask(cfg, input, fetchImpl, clock);
      const videoUrl = await pollTask(cfg, taskId, fetchImpl, wait, clock);
      const videoRes = await fetchImpl(videoUrl);
      if (!videoRes.ok) throw new Error(`[laoli-omnihuman] video download failed: ${videoRes.status}`);
      return {
        video: Buffer.from(await videoRes.arrayBuffer()),
        contentType: 'video/mp4',
        provider: 'omnihuman',
        taskId,
      };
    },
  };
}

async function submitTask(
  cfg: OmnihumanConfig,
  input: LaoliAvatarInput,
  fetchImpl: typeof fetch,
  clock: () => Date,
): Promise<string> {
  const query = formatVisualQuery({ Action: 'CVSubmitTask', Version: OMNIHUMAN_VERSION });
  // 官方建议在 prompt 里写明「角色说话」提高口型表现;≤300 字、单主体跳过主体检测。
  const requestBody: Record<string, string> = { req_key: cfg.reqKey, image_url: input.imageUrl ?? '', audio_url: input.audioUrl };
  if (input.prompt) requestBody.prompt = input.prompt.slice(0, 300);
  const body = JSON.stringify(requestBody);
  const signed = signVolcVisualV4({ cfg, query, body, clock });
  const res = await fetchImpl(signed.url, { method: 'POST', headers: signed.headers, body: signed.body });
  if (!res.ok) throw new Error(`[laoli-omnihuman] submit failed: ${res.status} ${await safeText(res)}`);
  const payload = await res.json() as { data?: { task_id?: string }; message?: string };
  const taskId = payload.data?.task_id;
  if (!taskId) throw new Error(`[laoli-omnihuman] submit response missing task_id: ${payload.message || ''}`.trim());
  return taskId;
}

async function pollTask(
  cfg: OmnihumanConfig,
  taskId: string,
  fetchImpl: typeof fetch,
  wait: (ms: number) => Promise<void>,
  clock: () => Date,
): Promise<string> {
  const query = formatVisualQuery({ Action: 'CVGetResult', Version: OMNIHUMAN_VERSION });
  const body = JSON.stringify({ req_key: cfg.reqKey, task_id: taskId });
  const startedAt = Date.now();
  while (Date.now() - startedAt < cfg.timeoutMs) {
    const signed = signVolcVisualV4({ cfg, query, body, clock });
    const res = await fetchImpl(signed.url, { method: 'POST', headers: signed.headers, body: signed.body });
    if (!res.ok) throw new Error(`[laoli-omnihuman] poll failed: ${res.status} ${await safeText(res)}`);
    const payload = await res.json() as { data?: { status?: string; video_url?: string }; message?: string };
    const status = payload.data?.status;
    if (status === 'done') {
      const url = payload.data?.video_url;
      if (!url) throw new Error('[laoli-omnihuman] done task missing video_url');
      return url;
    }
    if (status === 'failed' || status === 'not_found' || status === 'expired') {
      throw new Error(`[laoli-omnihuman] task ${status}: ${payload.message || taskId}`);
    }
    await wait(cfg.pollIntervalMs);
  }
  throw new Error(`[laoli-omnihuman] task timeout after ${cfg.timeoutMs}ms`);
}

function deriveSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', secretKey).update(dateStamp, 'utf8').digest();
  const kRegion = createHmac('sha256', kDate).update(region, 'utf8').digest();
  const kService = createHmac('sha256', kRegion).update(service, 'utf8').digest();
  return createHmac('sha256', kService).update('request', 'utf8').digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function formatAmzDate(date: Date): string {
  const iso = date.toISOString(); // 2026-06-22T08:09:10.123Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
