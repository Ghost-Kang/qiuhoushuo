/**
 * payments 表读写助手。
 *
 * 结构化窄类型（参 lib/api/users.ts / report route ShortCodeDb），不依赖 supabase 全量类型，
 * 便于单测注入假 client，且满足 CI no-any 门禁。
 * 写入/更新一律走 service_role（RLS：payments INSERT/UPDATE 仅 service_role）。
 */

import type { Sku } from './sku';

export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded';

export interface PaymentRow {
  id: string;
  user_id: string;
  sku: Sku;
  report_id?: string | null;
  amount_cents: number;
  status: PaymentStatus;
  wx_transaction_id?: string | null;
  fulfilled_at?: string | null;
}

export type PaymentsClient = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: PaymentRow | null }>;
      };
    };
    update(row: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

export function asPaymentsClient(client: object): PaymentsClient {
  return client as PaymentsClient;
}

// 消费型权益查询(球迷形象 ¥1):该用户一笔"支付成功且未兑付"的某 SKU 订单。
// .match 多列等值 + .is(fulfilled_at,null) 判未兑付 + limit 1。
export type EntitlementClient = {
  from(table: string): {
    select(columns: string): {
      match(query: Record<string, string>): {
        is(column: string, value: null): {
          limit(n: number): PromiseLike<{ data: PaymentRow[] | null; error?: { message?: string } | null }>;
        };
      };
    };
  };
};

export function asEntitlementClient(client: object): EntitlementClient {
  return client as EntitlementClient;
}

export interface PendingPaymentInput {
  id: string;
  userId: string;
  sku: Sku;
  reportId: string | null;
  amountCents: number;
}

/** 插入 pending 订单。返回 error message（成功为 null）。 */
export async function insertPendingPayment(db: PaymentsClient, input: PendingPaymentInput): Promise<string | null> {
  const { error } = await db.from('payments').insert({
    id: input.id,
    user_id: input.userId,
    sku: input.sku,
    report_id: input.reportId,
    amount_cents: input.amountCents,
    status: 'pending',
  });
  return error?.message ?? null;
}

export async function getPaymentById(db: PaymentsClient, id: string): Promise<PaymentRow | null> {
  const { data } = await db
    .from('payments')
    .select('id,user_id,sku,report_id,amount_cents,status,wx_transaction_id')
    .eq('id', id)
    .maybeSingle();
  return data;
}

export async function markPaymentSuccess(db: PaymentsClient, id: string, wxTransactionId: string, now: string): Promise<void> {
  await db.from('payments').update({ status: 'success', wx_transaction_id: wxTransactionId, paid_at: now }).eq('id', id);
}

export async function markPaymentFailed(db: PaymentsClient, id: string): Promise<void> {
  await db.from('payments').update({ status: 'failed' }).eq('id', id);
}

export async function markPaymentRefunded(db: PaymentsClient, id: string, now: string): Promise<void> {
  await db.from('payments').update({ status: 'refunded', refunded_at: now }).eq('id', id);
}

// 兑付:消费型权益(球迷形象)生成成功后,把订单标记已兑付,使其不可被二次消费。
// 写失败必须打日志——曾因 PostgREST 模式缓存过期(新列未重载)静默吞掉 update,导致已付不兑付、
// 一笔 ¥1 可反复生成(收入漏洞)。绝不静默。
export async function markPaymentFulfilled(db: PaymentsClient, id: string, now: string): Promise<void> {
  const { error } = await db.from('payments').update({ fulfilled_at: now }).eq('id', id);
  if (error) console.error('[payments] markPaymentFulfilled 写失败(兑付未落!):', id, error?.message);
}

// 找一笔可消费的权益:支付成功且未兑付(fulfilled_at IS NULL)的指定 SKU 订单(最多 1 笔)。
// 无 → null（前端应引导付费）。查询出错也打日志(同上:静默会让付费闸形同虚设)。
export async function findUnfulfilledPaidPayment(db: EntitlementClient, userId: string, sku: Sku): Promise<PaymentRow | null> {
  const { data, error } = await db
    .from('payments')
    .select('id,user_id,sku,amount_cents,status,wx_transaction_id,fulfilled_at')
    .match({ user_id: userId, sku, status: 'success' })
    .is('fulfilled_at', null)
    .limit(1);
  if (error) console.error('[payments] findUnfulfilledPaidPayment 查询出错:', sku, error?.message);
  return data?.[0] ?? null;
}
