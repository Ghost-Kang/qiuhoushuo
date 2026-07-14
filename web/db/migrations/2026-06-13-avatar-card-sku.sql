-- 迁移:球迷形象 ¥1(avatar_card)消费型付费
-- 在生产 Supabase/Postgres 执行(幂等):① payments.sku CHECK 增加 avatar_card;② 增 fulfilled_at 兑付列。
-- 配合服务端开关 AVATAR_PAYMENT_REQUIRED + 客户端 AVATAR_PAYMENT_LIVE 一起上线(见 GO-LIVE-RUNBOOK)。

-- ① sku CHECK 放开 avatar_card(先删旧约束再加新约束;约束名按实际,默认 payments_sku_check)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_sku_check;
ALTER TABLE payments ADD CONSTRAINT payments_sku_check
  CHECK (sku IN ('deep_report', 'final_column', 'avatar_card'));

-- ② 兑付列:消费型权益生成成功后置时间;NULL=已付未兑付(可消费/可重试不二次扣费)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

-- 加速"该用户未兑付的已付 avatar_card"查询(findUnfulfilledPaidPayment)
CREATE INDEX IF NOT EXISTS idx_payments_entitlement
  ON payments (user_id, sku, status)
  WHERE fulfilled_at IS NULL;
