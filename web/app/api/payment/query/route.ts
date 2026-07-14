/**
 * POST /api/payment/query
 *
 * 主动查单（notify 兜底）。微信 notify 是 best-effort、可能延迟/丢失 → 客户端支付成功后主动调本接口：
 * 查微信订单真实状态，若 SUCCESS 则就地结算（markPaymentSuccess + E032，与 notify settle 同口径、幂等）。
 *
 * 鉴权同 create：x-openid-token（H5 签名）优先，否则 x-openid（小程序）。只能查本人订单。
 * 未配 WXPAY：返回订单当前 DB 状态（dev/mock 无可查）。
 */

import { z } from 'zod';
import { readJsonWithLimit } from '@/lib/api/body-limit';
import { getSupabaseService, USE_DB, USE_WXPAY } from '@/lib/api/mode';
import { asPaymentsClient, getPaymentById, markPaymentSuccess } from '@/lib/api/payments';
import { getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { verifyOpenidToken } from '@/lib/api/openid-token';
import { trackServerEvent } from '@/lib/api/tracker';
import { findUserByOpenid, type UsersClient } from '@/lib/api/users';
import { loadWxPayConfig, queryOrderByOutTradeNo } from '@/lib/api/wechat-pay';
import { NextResponse } from 'next/server';

const Body = z.object({ paymentId: z.string().uuid() }).strict();

function resolveOpenid(req: Request): string | null {
  const token = req.headers.get('x-openid-token');
  if (token) return verifyOpenidToken(token, Date.now());
  return getOpenid(req);
}

export async function POST(req: Request) {
  const rid = requestId();
  const openid = resolveOpenid(req);
  if (!openid) return unauthorized();

  const body = await readJsonWithLimit<unknown>(req, 1024);
  if (!body.ok) {
    return NextResponse.json(
      body.error === 'PAYLOAD_TOO_LARGE' ? body : { error: 'invalid json' },
      { status: body.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400 },
    );
  }
  const parsed = withZod(Body, body.data);
  if ('error' in parsed) return parsed.error;
  const { paymentId } = parsed.data;

  try {
    if (!USE_DB) return ok({ status: 'pending', mock: true });
    const db = getSupabaseService();
    if (!db) return internal(rid);

    const user = await findUserByOpenid(db as unknown as UsersClient, openid);
    if (!user) return unauthorized();

    const pdb = asPaymentsClient(db);
    const payment = await getPaymentById(pdb, paymentId);
    if (!payment) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (payment.user_id !== user.id) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }); // 只能查本人订单
    if (payment.status === 'success') return ok({ status: 'success' }); // 幂等
    if (payment.status === 'refunded') return ok({ status: 'refunded' });

    // 未配真支付:无可查,返回当前 DB 状态
    if (!USE_WXPAY) return ok({ status: payment.status });

    const cfg = loadWxPayConfig();
    if (!cfg) return internal(rid);
    // out_trade_no = paymentId 去连字符(与 create 下单一致)
    const order = await queryOrderByOutTradeNo(cfg, paymentId.replace(/-/g, ''));
    if (order.tradeState !== 'SUCCESS') return ok({ status: payment.status, tradeState: order.tradeState });

    // 金额必须与下单一致(防篡改),再结算
    if (order.amountTotal !== null && order.amountTotal !== payment.amount_cents) {
      console.error('[payment/query] amount mismatch', { order: paymentId, expected: payment.amount_cents, got: order.amountTotal });
      return ok({ status: payment.status, tradeState: order.tradeState });
    }
    await markPaymentSuccess(pdb, paymentId, order.transactionId, new Date().toISOString());
    trackServerEvent(db, {
      eventId: 'E032',
      userId: payment.user_id,
      properties: { payment_id: paymentId, wx_transaction_id: order.transactionId, sku: payment.sku, via: 'query' },
    });
    return ok({ status: 'success' });
  } catch (err) {
    console.error('[payment/query] fail:', (err as Error).message);
    return internal(rid);
  }
}
