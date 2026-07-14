/**
 * POST /api/payment/create
 *
 * 创建微付费订单，返回客户端调起支付参数。
 * scene=jsapi_mp（服务号 H5，iOS+安卓）/ jsapi_mini（安卓小程序）共用本路由与 payments 后端。
 *
 * 流程：x-openid 鉴权 → 解析 sku/scene → 解析用户（未成年拦截）→ 落 pending 订单 →
 *   E031 → 调微信 JSAPI 下单 → 返回 payParams。
 * 未配 WXPAY：dev/内测返回 mock payParams（链路可端到端跑）；production 返回 503。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonWithLimit } from '@/lib/api/body-limit';
import { getSupabaseService, USE_DB, USE_WXPAY } from '@/lib/api/mode';
import { asPaymentsClient, insertPendingPayment } from '@/lib/api/payments';
import { badRequest, getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { verifyOpenidToken } from '@/lib/api/openid-token';
import { getSku } from '@/lib/api/sku';
import { trackServerEvent } from '@/lib/api/tracker';
import { ensureUserByOpenid, findUserByOpenid, type EnsureUserClient, type UsersClient } from '@/lib/api/users';
import {
  appidForScene,
  buildPayParams,
  createJsapiOrder,
  loadWxPayConfig,
  type JsapiPayParams,
  type PaymentScene,
} from '@/lib/api/wechat-pay';

const Body = z
  .object({
    sku: z.enum(['deep_report', 'final_column', 'avatar_card']),
    scene: z.enum(['jsapi_mp', 'jsapi_mini']),
    // .nullish():接受 string(uuid)/ undefined / null。avatar 等账户级 SKU 客户端传 reportId:null,
    // 旧 .optional() 不接受 null → 400 "Expected string, received null"(6/13 真机"下单失败"真因)。
    // 服务端本就 report_ref 仅作分析、订单存 null,故 null 等价无 reportId。
    reportId: z.string().uuid().nullish(),
  })
  .strict();

/**
 * 取 openid（R4）：服务号 H5 走 `x-openid-token`（HMAC 验签，不可伪造）；
 * 小程序走 `x-openid`（来自 wx.login jscode2session）。token 优先。
 */
function resolveOpenid(req: Request): string | null {
  const token = req.headers.get('x-openid-token');
  if (token) return verifyOpenidToken(token, Date.now());
  return getOpenid(req);
}

export async function POST(req: Request) {
  const rid = requestId();
  const openid = resolveOpenid(req);
  if (!openid) return unauthorized();

  const body = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      body.error === 'PAYLOAD_TOO_LARGE' ? body : { error: 'invalid json' },
      { status: body.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400 },
    );
  }
  const parsed = withZod(Body, body.data);
  if ('error' in parsed) return parsed.error;
  const { sku, scene, reportId } = parsed.data;
  const skuInfo = getSku(sku);
  if (!skuInfo) return badRequest({ sku: 'UNKNOWN_SKU' });

  try {
    // 未配微信支付时 production 直接拒绝——必须在解析用户 / 落 pending 订单之前，
    // 避免"支付未开启"却已写脏 pending 单（与 notify 的 503 守卫对称，R3）。
    if (!USE_WXPAY && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'PAYMENTS_DISABLED' }, { status: 503 });
    }

    let userId: string;
    if (USE_DB) {
      const db = getSupabaseService();
      if (!db) return internal(rid);
      let user = await findUserByOpenid(db as unknown as UsersClient, openid);
      if (!user) {
        // openid 已鉴权但未建档(登录在 upsert 上线前/用了缓存 openid 没重登)→ 补建,避免下单 401。
        // 与 /api/wx/login、/api/wx/oauth 自愈一致;新建档用户 is_minor 默认 false。
        await ensureUserByOpenid(db as unknown as EnsureUserClient, openid);
        user = await findUserByOpenid(db as unknown as UsersClient, openid);
      }
      if (!user) return internal(rid); // 补建后仍查不到 = DB 异常
      if (user.is_minor) return NextResponse.json({ error: 'MINOR_BLOCKED' }, { status: 403 });
      userId = user.id;
    } else {
      userId = `mock_user_${openid}`;
    }

    const paymentId = crypto.randomUUID();

    // payments.report_id 外键引用 reports(id);但客户端传的 reportId 是 match_id/short_code(非 reports.id),
    // 且 deep_report/final_column 是账户级权益(successfulSkus 按 SKU 判,不依赖 report_id)→ 不绑具体战报行,存 null,
    // 把来源 reportId 记进 E031 的 report_ref,保留"哪场比赛带来转化"的分析价值。
    const e031Props = { payment_id: paymentId, sku, amount_cents: skuInfo.amountCents, scene, report_ref: reportId ?? null };
    if (USE_DB) {
      const db = getSupabaseService()!;
      const err = await insertPendingPayment(asPaymentsClient(db), {
        id: paymentId,
        userId,
        sku,
        reportId: null,
        amountCents: skuInfo.amountCents,
      });
      if (err) {
        console.error('[payment/create] insert failed:', err);
        return internal(rid);
      }
      trackServerEvent(db, { eventId: 'E031', userId, properties: e031Props });
    } else {
      trackServerEvent(null, { eventId: 'E031', userId, properties: e031Props });
    }

    if (!USE_WXPAY) {
      // production 已在入口被上面的守卫拦截；此处仅 dev/test mock 降级。
      return ok({
        ok: true,
        paymentId,
        sku,
        amountCents: skuInfo.amountCents,
        mock: true,
        payParams: mockPayParams(paymentId),
      });
    }

    const cfg = loadWxPayConfig();
    if (!cfg) return internal(rid);
    const appid = appidForScene(cfg, scene as PaymentScene);
    if (!appid) return badRequest({ scene: 'APPID_NOT_CONFIGURED' });
    const { prepayId } = await createJsapiOrder(cfg, {
      appid,
      description: skuInfo.label,
      // 微信 out_trade_no 上限 32 字符;UUID(36 字符含连字符)去连字符=32 位 hex(微信允许字符集)。
      // notify 回调带回该 hex,getPaymentById 查 payments.id(uuid)时 Postgres 自动把 hex 转回 uuid 匹配。
      outTradeNo: paymentId.replace(/-/g, ''),
      amountCents: skuInfo.amountCents,
      openid,
    });
    const payParams = buildPayParams(cfg, appid, prepayId);
    return ok({ ok: true, paymentId, sku, amountCents: skuInfo.amountCents, payParams });
  } catch (err) {
    console.error('[payment/create] fail:', (err as Error).message);
    return internal(rid);
  }
}

function mockPayParams(paymentId: string): JsapiPayParams {
  return {
    appId: 'mock_appid',
    timeStamp: '0',
    nonceStr: `mock_${paymentId.slice(0, 8)}`,
    package: `prepay_id=mock_${paymentId}`,
    signType: 'RSA',
    paySign: 'mock_paysign',
  };
}
