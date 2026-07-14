/**
 * POST /api/payment/notify
 *
 * 微信支付 v3 回调。真实模式：验平台证书签名 → AES-GCM 解密 resource → 幂等结算。
 * mock 模式（未配 WXPAY）：x-mock-wxpay-secret == INTERNAL_TOKEN 守护，明文 body 结算，
 *   供内测 dry-run 端到端验证。
 *
 * 结算：trade_state=SUCCESS → payments.status=success + E032；幂等（已 success 直接返回）。
 * 始终对已知/未知订单返回 200 {code:SUCCESS} 止微信重试风暴；验签失败才 401。
 */

import { NextResponse } from 'next/server';
import { getSupabaseService, USE_DB, USE_WXPAY } from '@/lib/api/mode';
import { asPaymentsClient, getPaymentById, markPaymentFailed, markPaymentSuccess } from '@/lib/api/payments';
import { timingSafeTokenEqual } from '@/lib/api/token-compare';
import { trackServerEvent } from '@/lib/api/tracker';
import { requireInternalToken } from '@/lib/api/internal-token';
import { decryptResource, loadWxPayConfig, verifyNotifySignature, type WxResource } from '@/lib/api/wechat-pay';

interface WxTransaction {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  amountTotal: number | null;
}

function success() {
  return NextResponse.json({ code: 'SUCCESS' });
}

function fail(status: number, message: string) {
  return NextResponse.json({ code: 'FAIL', message }, { status });
}

export async function POST(req: Request) {
  // 未配微信支付时，production 直接拒绝（与 create 对称）：堵住 mock 回调分支被伪造收款的口子。
  if (!USE_WXPAY && process.env.NODE_ENV === 'production') {
    return fail(503, 'PAYMENTS_DISABLED');
  }

  const raw = await req.text();

  let tx: WxTransaction | null;
  if (USE_WXPAY) {
    const cfg = loadWxPayConfig();
    if (!cfg) return fail(500, 'CONFIG');
    const headers = {
      signature: req.headers.get('wechatpay-signature') ?? '',
      timestamp: req.headers.get('wechatpay-timestamp') ?? '',
      nonce: req.headers.get('wechatpay-nonce') ?? '',
    };
    if (!verifyNotifySignature(cfg, headers, raw)) return fail(401, 'SIGN');
    tx = decryptTransaction(cfg.apiV3Key, raw);
  } else {
    if (!timingSafeTokenEqual(req.headers.get('x-mock-wxpay-secret'), internalToken())) return fail(401, 'MOCK_AUTH');
    tx = parseTransaction(raw);
  }

  if (!tx) return fail(400, 'BODY');
  return settle(tx);
}

function decryptTransaction(apiV3Key: string, raw: string): WxTransaction | null {
  try {
    const envelope = JSON.parse(raw) as { resource?: WxResource };
    if (!envelope.resource) return null;
    return parseTransaction(decryptResource(apiV3Key, envelope.resource));
  } catch {
    return null;
  }
}

function parseTransaction(plain: string): WxTransaction | null {
  try {
    const obj = JSON.parse(plain) as {
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      amount?: { total?: number };
    };
    if (!obj.out_trade_no || !obj.trade_state) return null;
    return {
      out_trade_no: obj.out_trade_no,
      transaction_id: obj.transaction_id ?? '',
      trade_state: obj.trade_state,
      amountTotal: typeof obj.amount?.total === 'number' ? obj.amount.total : null,
    };
  } catch {
    return null;
  }
}

async function settle(tx: WxTransaction): Promise<Response> {
  const paid = tx.trade_state === 'SUCCESS';
  if (!USE_DB) {
    if (paid) trackServerEvent(null, { eventId: 'E032', properties: { payment_id: tx.out_trade_no, wx_transaction_id: tx.transaction_id } });
    return success();
  }

  const db = getSupabaseService();
  if (!db) return success();
  const pdb = asPaymentsClient(db);
  const existing = await getPaymentById(pdb, tx.out_trade_no);
  if (!existing) {
    console.warn('[payment/notify] unknown order', tx.out_trade_no);
    return success();
  }
  if (existing.status === 'success') return success();

  if (paid) {
    // 回调金额必须等于下单金额（防价格篡改 / 错单被确认为已付）。
    if (tx.amountTotal !== null && tx.amountTotal !== existing.amount_cents) {
      console.error('[payment/notify] amount mismatch', { order: tx.out_trade_no, expected: existing.amount_cents, got: tx.amountTotal });
      await markPaymentFailed(pdb, tx.out_trade_no);
      return success();
    }
    await markPaymentSuccess(pdb, tx.out_trade_no, tx.transaction_id, new Date().toISOString());
    trackServerEvent(db, {
      eventId: 'E032',
      userId: existing.user_id,
      properties: { payment_id: tx.out_trade_no, wx_transaction_id: tx.transaction_id, sku: existing.sku },
    });
  } else {
    await markPaymentFailed(pdb, tx.out_trade_no);
  }
  return success();
}

function internalToken() {
  return requireInternalToken();
}
