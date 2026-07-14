/**
 * POST /api/admin/payment-refund（运营退款）
 *
 * 仅 success 订单可退；调微信 v3 退款 → payments.status=refunded + E033。
 * 未配 WXPAY（dev/mock）：跳过真实退款，直接标 refunded，链路可测。
 */

import { z } from 'zod';
import { getSupabaseService, USE_DB, USE_WXPAY } from '@/lib/api/mode';
import { asPaymentsClient, getPaymentById, markPaymentRefunded } from '@/lib/api/payments';
import { badRequest, ok } from '@/lib/api/respond';
import { trackServerEvent } from '@/lib/api/tracker';
import { createRefund, loadWxPayConfig } from '@/lib/api/wechat-pay';
import { withAdmin } from '@/lib/api/with-admin';

const Body = z.object({ paymentId: z.string().uuid() }).strict();

export const POST = withAdmin(Body, async ({ body }) => {
  const { paymentId } = body;

  if (!USE_DB) {
    return ok({ ok: true, mock: true, paymentId, status: 'refunded' });
  }

  const db = getSupabaseService();
  if (!db) return badRequest({ db: 'UNAVAILABLE' });
  const pdb = asPaymentsClient(db);

  const payment = await getPaymentById(pdb, paymentId);
  if (!payment) return badRequest({ payment: 'NOT_FOUND' });
  if (payment.status !== 'success') return badRequest({ payment: 'NOT_REFUNDABLE', status: payment.status });

  if (USE_WXPAY && payment.wx_transaction_id) {
    const cfg = loadWxPayConfig();
    if (cfg) {
      await createRefund(cfg, {
        transactionId: payment.wx_transaction_id,
        outRefundNo: `re_${paymentId}`,
        amountCents: payment.amount_cents,
        reason: 'admin refund',
      });
    }
  }

  await markPaymentRefunded(pdb, paymentId, new Date().toISOString());
  trackServerEvent(db, {
    eventId: 'E033',
    userId: payment.user_id,
    properties: { payment_id: paymentId, amount_cents: payment.amount_cents, sku: payment.sku },
  });
  return ok({ ok: true, paymentId, status: 'refunded' });
});
