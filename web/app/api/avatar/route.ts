/**
 * POST /api/avatar → 球迷形象生成（图生图，豆包 Seedream）
 *
 * 合规闸门（顺序即防线层级，全部过了才会碰生图）：
 * 1. feature.fan_avatar 灰度门（默认关；备案回执 + 律师评估前不得开启）
 *    1b. mode=costar(与真实球星合影,写实高风险)再叠一道 feature.fan_avatar_costar 独立门（默认关，可单独 kill）
 * 2. x-openid 鉴权（小程序 wx.login 链路）
 * 3. consent === true 显式同意（人脸属 PIPL 敏感个人信息，须单独同意）
 * 4. 未成年人拦截（users.is_minor → 403，与 payment/create 同口径）
 * 5. 体积/格式校验（≤4MB 解码后,仅 jpeg/png）
 *
 * 输入自拍不落任何存储（fan-avatar lib 红线 1）；结果 PNG 落 COS 后返回 URL。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { badRequest, getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { verifyOpenidToken } from '@/lib/api/openid-token';
import { readJsonWithLimit } from '@/lib/api/body-limit';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { findUserByOpenid, type UsersClient } from '@/lib/api/users';
import { asEntitlementClient, asPaymentsClient, findUnfulfilledPaidPayment, markPaymentFulfilled } from '@/lib/api/payments';
import { getCardStorage } from '@/lib/api/card-storage';
import { trackServerEvent } from '@/lib/api/tracker';
import { createFanAvatarProviderFromEnv, generateFanAvatar } from '@/lib/api/fan-avatar';
import { MP_QR_BADGE_PNG } from '@/lib/api/mp-qr-badge';

/** base64 解码后上限 4MB；JSON 体上限给到 6MB（base64 膨胀 ~4/3 + 字段开销） */
const MAX_SELFIE_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
// 球迷形象付费闸(默认关):=1 且 DB 模式时,生成前须有"已付未兑付"的 avatar_card 权益。
// 与客户端 AVATAR_PAYMENT_LIVE + WXPAY_ENABLED 协调上线(见 GO-LIVE-RUNBOOK);关时免费生成不变。
const AVATAR_PAYMENT_REQUIRED = process.env.AVATAR_PAYMENT_REQUIRED === '1';

const Body = z.object({
  image_b64: z.string().min(1),
  team: z.string().min(1).max(30),
  consent: z.boolean(),
  // 形象风格(用户在 Step2 选);仅锁定的三种非写实风格,默认 cartoon。红线 3 由 prompt 统一约束。
  style: z.enum(['cartoon', 'figure', 'painterly']).optional(),
  // 生成意图:solo=插画球迷(默认);costar=与球星合影(写实,高风险,额外受 feature.fan_avatar_costar 门控)。
  mode: z.enum(['solo', 'costar']).optional(),
  // costar 模式下的球星名(展示名);solo 忽略。sanitize 在 lib 内统一,防注入。
  star: z.string().min(1).max(30).optional(),
});

const PNG_MAGIC = '89504e470d0a1a0a';
const JPEG_MAGIC = 'ffd8ff';

export async function POST(req: Request) {
  const rid = requestId();

  const identity = {
    openid: req.headers.get('x-openid') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined,
  };
  if (!isFeatureEnabled('feature.fan_avatar', identity)) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  // 鉴权:小程序走 x-openid;服务号 H5(iOS)走 x-openid-token(HMAC 验签,不可伪造),token 优先。
  const token = req.headers.get('x-openid-token');
  const openid = token ? verifyOpenidToken(token, Date.now()) : getOpenid(req);
  if (!openid) return unauthorized();

  const body = await readJsonWithLimit<unknown>(req, MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.error === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', limit: body.limit }, { status: 413 });
    }
    return badRequest({ body: 'INVALID_JSON' });
  }
  const parsed = withZod(Body, body.data);
  if ('error' in parsed) return parsed.error;
  const { image_b64, team, consent, style, star } = parsed.data;
  const mode = parsed.data.mode ?? 'solo';

  // costar(与球星合影,写实高风险)走独立灰度门——即便 fan_avatar 已开,costar 默认仍关,
  // 须显式 FEATURE_FLAG_FAN_AVATAR_COSTAR 才放行(founder 拍板的高风险路径需可单独 kill)。
  if (mode === 'costar') {
    if (!isFeatureEnabled('feature.fan_avatar_costar', identity)) {
      return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
    }
    if (!star) return badRequest({ star: 'REQUIRED' });
  }

  // 人脸是 PIPL 敏感个人信息：没有显式单独同意直接拒,不进任何后续处理
  if (consent !== true) {
    return NextResponse.json({ error: 'CONSENT_REQUIRED' }, { status: 400 });
  }

  const selfie = decodeSelfie(image_b64);
  if (!selfie) return badRequest({ image_b64: 'UNSUPPORTED_IMAGE' });
  if (selfie.buffer.byteLength > MAX_SELFIE_BYTES) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', limit: MAX_SELFIE_BYTES }, { status: 413 });
  }

  try {
    let fulfillPaymentId: string | null = null;
    if (USE_DB) {
      const db = getSupabaseService();
      if (!db) return internal(rid);
      const user = await findUserByOpenid(db as unknown as UsersClient, openid);
      if (user?.is_minor) return NextResponse.json({ error: 'MINOR_BLOCKED' }, { status: 403 });
      // 付费闸(默认关;AVATAR_PAYMENT_REQUIRED=1 + DB 模式才生效):
      // 须有一笔"支付成功且未兑付"的 avatar_card 订单,否则 402(前端引导先付 ¥1)。
      if (AVATAR_PAYMENT_REQUIRED) {
        const entitlement = user
          ? await findUnfulfilledPaidPayment(asEntitlementClient(db), user.id, 'avatar_card')
          : null;
        if (!entitlement) return NextResponse.json({ error: 'PAYMENT_REQUIRED' }, { status: 402 });
        fulfillPaymentId = entitlement.id;
      }
    }

    const result = await generateFanAvatar(
      { openid, team, style, mode, star, selfie: selfie.buffer, selfieContentType: selfie.contentType },
      { provider: createFanAvatarProviderFromEnv(), storage: getCardStorage(), requestId: rid },
    );

    // 生成成功才兑付(消费权益);失败不兑付 → 权益保留可重试不二次扣费(自动退款基建 createRefund 已就位,待联调启用)
    if (fulfillPaymentId) {
      const db = getSupabaseService();
      if (db) await markPaymentFulfilled(asPaymentsClient(db), fulfillPaymentId, new Date().toISOString());
    }

    // 微信带码版(引流):右下角是 Seedream 自带 AI 标识,故码放**左下角**避免遮挡显著标识。
    // best-effort:失败不影响主图返回(无码版 result.url 永远可用,站外用它);仅微信内"存微信版"用 url_qr。
    const urlQr = await composeFanAvatarQr(result.key, rid);

    trackServerEvent(USE_DB ? getSupabaseService() : null, {
      eventId: 'E055',
      properties: { team, mode, provider: result.provider, request_id: rid },
    });
    return ok({ url: result.url, url_qr: urlQr, request_id: rid });
  } catch (err) {
    console.error('[api/avatar] generate fail:', (err as Error).message);
    return internal(rid);
  }
}

function decodeSelfie(imageB64: string): { buffer: Buffer; contentType: 'image/jpeg' | 'image/png' } | null {
  const raw = imageB64.startsWith('data:')
    ? imageB64.slice(imageB64.indexOf(',') + 1)
    : imageB64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  if (buffer.byteLength < 16) return null;
  if (buffer.subarray(0, 8).toString('hex') === PNG_MAGIC) return { buffer, contentType: 'image/png' };
  if (buffer.subarray(0, 3).toString('hex') === JPEG_MAGIC) return { buffer, contentType: 'image/jpeg' };
  return null;
}

/** 把小程序码徽标合成到球迷形象**左下角**(避开 Seedream 自带右下 AI 标识),产出"微信带码版"存 COS。
 *  best-effort:任何失败返回 undefined,不影响无码主图(站外用无码版 result.url);仅微信内"存微信版"用 url_qr。 */
async function composeFanAvatarQr(avatarKey: string, rid: string): Promise<string | undefined> {
  try {
    const storage = getCardStorage();
    const bytes = await storage.getBytes?.(avatarKey);
    if (!bytes) return undefined;
    const sharp = (await import('sharp')).default;
    const src = Buffer.from(bytes);
    const meta = await sharp(src).metadata();
    const w = meta.width || 1024;
    const h = meta.height || w;
    const badgeSize = Math.round(w * 0.2);
    const margin = Math.round(w * 0.035);
    const badge = await sharp(MP_QR_BADGE_PNG).resize(badgeSize, badgeSize).png().toBuffer();
    const composed = await sharp(src)
      .composite([{ input: badge, top: h - badgeSize - margin, left: margin }])
      .png()
      .toBuffer();
    const qrKey = avatarKey.replace(/\.png$/, '-qr.png');
    return await storage.put(qrKey, composed, 'image/png');
  } catch (err) {
    console.warn(`[api/avatar] qr compose failed (rid=${rid}):`, (err as Error).message);
    return undefined;
  }
}
