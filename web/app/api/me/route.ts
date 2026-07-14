import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { mockMe } from '@/lib/api/mock';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { getOpenid, internal, ok, requestId, unauthorized, withZod } from '@/lib/api/respond';
import { getSku } from '@/lib/api/sku';
import { findUserByOpenid } from '@/lib/api/users';
import type { UsersClient } from '@/lib/api/users';
import { z } from 'zod';

const Query = z.object({}).strict();

type QuoteRow = { id: string; content: string };
type PaymentRow = { id: string; sku: string; amount_cents: number; paid_at: string };
// 账单查询可链式 eq（user_id + status）+ order；自洽链式 builder 类型
type PaymentQuery = {
  eq(column: string, value: string): PaymentQuery;
  order(column: string, opts: { ascending: boolean }): PaymentQuery;
  limit(n: number): PromiseLike<{ data: PaymentRow[] | null }>;
};
export type MeDb = UsersClient & {
  from(table: 'chat_quotes'): {
    select(columns: string): {
      eq(column: 'user_id', value: string): {
        limit(n: number): PromiseLike<{ data: QuoteRow[] | null }>;
      };
    };
  };
  from(table: 'payments'): {
    select(columns: string): PaymentQuery;
  };
};

function getMeDb(): MeDb | null {
  const client: object | null = getSupabaseService();
  return client ? client as MeDb : null;
}

export async function GET(req: Request) {
  const rid = requestId();
  try {
    const openid = getOpenid(req);
    if (!openid) return unauthorized();
    const parsed = withZod(Query, Object.fromEntries(new URL(req.url).searchParams));
    if ('error' in parsed) return parsed.error;
    const showPayments = isFeatureEnabled('feature.show_payment_history', { openid });
    const kolAlphaEnabled = isFeatureEnabled('feature.kol_alpha', { openid });
    if (!USE_DB) return ok(withKolAlpha(omitPaymentsWhenDisabled(mockMe(), showPayments), kolAlphaEnabled));
    const db = getMeDb()!;
    const user = await findUserByOpenid(db, openid);
    if (!user) return ok(withKolAlpha(mockMe(), kolAlphaEnabled));
    const [{ data: quoteRows }, { data: paymentRows }] = await Promise.all([
      db.from('chat_quotes').select('id,content').eq('user_id', user.id).limit(2),
      // 账单只展示真实成功订单（漏 status 过滤会把 pending/failed 也当付费记录）；按支付时间倒序
      db.from('payments').select('id,sku,amount_cents,paid_at').eq('user_id', user.id).eq('status', 'success').order('paid_at', { ascending: false }).limit(10),
    ]);
    const quotes = quoteRows ?? [];
    const payments = paymentRows ?? [];
    return ok(withKolAlpha(omitPaymentsWhenDisabled({
      user: {
        nickname: user.nickname || '老李的朋友',
        avatar: '',
        is_minor: user.is_minor === true,
        guardian_consent: user.guardian_consent === true,
      },
      quotes: quotes.map((q: QuoteRow) => ({ id: q.id, text: q.content })),
      payments: payments.map((p: PaymentRow) => ({ id: p.id, sku: p.sku, label: getSku(p.sku)?.label ?? p.sku, amount: p.amount_cents / 100, paid_at: p.paid_at })),
    }, showPayments), kolAlphaEnabled));
  } catch {
    return internal(rid);
  }
}

function omitPaymentsWhenDisabled<T extends { payments?: unknown }>(data: T, enabled: boolean) {
  if (enabled) return data;
  const { payments: _payments, ...rest } = data;
  return rest;
}

function withKolAlpha<T extends object>(data: T, kolAlpha: boolean): T & { kol_alpha: boolean } {
  return { ...data, kol_alpha: kolAlpha };
}
