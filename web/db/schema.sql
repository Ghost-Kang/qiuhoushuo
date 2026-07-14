-- =================================================================
-- 球后说 · 数据库 schema (Supabase / 腾讯云 PG 兼容)
-- =================================================================
-- 设计原则：
-- 1. matches 是源表，reports / chats / shares / payments 都关联它
-- 2. reports 每场比赛 3 行（每个风格独立 row，方便单独 invalidate）
-- 3. 所有用户数据加 user_id（手机号注册后生成的内部 UUID，不存原始手机号哈希以外的内容）
-- 4. 所有表有 created_at / updated_at（合规：日志留存 ≥ 12 个月）
-- 5. RLS 默认开启（Supabase）
-- =================================================================

-- 比赛主表
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code TEXT UNIQUE NOT NULL, -- 用于短链 /m/8a3f
  external_id TEXT UNIQUE,         -- API-Football fixture id（UNIQUE 支撑 sync upsert onConflict；可空,NULL 不冲突）
  competition TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INT,
  away_score INT,
  match_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | live | finished | postponed
  stats JSONB DEFAULT '{}'::jsonb,           -- xG / 控球 / 射门等
  events JSONB DEFAULT '[]'::jsonb,          -- 进球 / 卡牌 / 换人
  lineups JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_matches_status_date ON matches (status, match_date);
CREATE INDEX idx_matches_short_code ON matches (short_code);

-- 战报表（每场 3 行）
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  style TEXT NOT NULL CHECK (style IN ('hardcore', 'duanzi', 'emotion')),
  title TEXT NOT NULL,
  subtitle TEXT,
  lead TEXT NOT NULL,
  body TEXT[] NOT NULL,
  ending TEXT NOT NULL,
  share_quote TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  prompt_version TEXT NOT NULL,
  llm_provider TEXT NOT NULL,
  llm_model TEXT,
  is_fallback BOOLEAN NOT NULL DEFAULT false,
  is_premium BOOLEAN NOT NULL DEFAULT false, -- 深度战报权益标记（deep_report 赛事通解锁）
  human_reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, style)
);
CREATE INDEX idx_reports_match ON reports (match_id);

-- 用户表（合规：实名 = 手机号验证）
-- 未成年人保护字段（STAGE_05 §1.2 E11）：
--   is_minor 由实名认证后根据 birth_year 计算并写入；
--   未成年用户：禁止付费（payments 路由拦截）、提醒模式 + 当日累计访问 ≤ 60 min；
--   每日累计访问时长由 events 表 E001/E099 聚合，**不**单独建表。
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash TEXT UNIQUE,         -- SHA256(手机号 + salt)，原始号永不存
  wx_openid TEXT UNIQUE,          -- 微信小程序 openid
  wx_unionid TEXT,                -- 多端打通
  nickname TEXT,
  followed_teams TEXT[] DEFAULT '{}',
  -- 未成年人保护
  birth_year SMALLINT,                                       -- 实名后写入，仅用于年龄段判定
  real_name_verified BOOLEAN NOT NULL DEFAULT false,         -- 是否完成实名（手机号 + 身份证）
  real_name_at TIMESTAMPTZ,                                  -- 实名通过时间
  id_hash TEXT,                                              -- SHA256(身份证号 + salt)，原始号永不存
  is_minor BOOLEAN NOT NULL DEFAULT false,                   -- 由 birth_year 派生，注册流程写入
  guardian_consent BOOLEAN NOT NULL DEFAULT false,           -- 监护人同意（is_minor = true 必须为 true 才能登录）
  guardian_consent_at TIMESTAMPTZ,                           -- 监护人同意时间
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 业务约束：未成年用户必须有监护人同意
  CONSTRAINT users_minor_requires_guardian CHECK (is_minor = false OR guardian_consent = true)
);
CREATE INDEX idx_users_wx_openid ON users (wx_openid);
CREATE INDEX idx_users_id_hash ON users (id_hash) WHERE id_hash IS NOT NULL;

-- 分享记录（K 因子计算依据）
CREATE TABLE IF NOT EXISTS shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  report_id UUID NOT NULL REFERENCES reports(id),
  platform TEXT NOT NULL CHECK (platform IN ('wechat_moments', 'wechat_chat', 'xhs', 'x', 'weibo', 'copy', 'other')),
  short_code TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_kol TEXT,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shares_short_code ON shares (short_code);
CREATE INDEX idx_shares_shared_at ON shares (shared_at);

-- 落地页访问回流（K 因子分母）
CREATE TABLE IF NOT EXISTS landings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code TEXT NOT NULL,
  utm_source TEXT,
  utm_kol TEXT,
  ip_hash TEXT,
  ua_fingerprint TEXT,
  registered BOOLEAN NOT NULL DEFAULT false,
  user_id UUID REFERENCES users(id),
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_landings_short_code ON landings (short_code);

-- 微付费订单
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  sku TEXT NOT NULL CHECK (sku IN ('deep_report', 'final_column', 'avatar_card')), -- 赛事通 ¥19 / 决赛专栏 ¥9 / 球迷形象 ¥1
  report_id UUID REFERENCES reports(id),
  amount_cents INT NOT NULL, -- 单位分
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  wx_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ -- 消费型权益(球迷形象)兑付时间:成功生成后置;NULL=已付未兑付,可消费/可重试不二次扣费
);
CREATE INDEX idx_payments_user ON payments (user_id);
CREATE INDEX idx_payments_status ON payments (status);

-- 群聊消息（仅元数据 + 审核结果，正文落腾讯云 IM）
-- 这里只存"金句池"用于战报回流
CREATE TABLE IF NOT EXISTS chat_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id),
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  ai_score NUMERIC(3,2), -- LLM 给的金句潜质分
  picked_for_report BOOLEAN NOT NULL DEFAULT false,
  human_reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_quotes_match ON chat_quotes (match_id);

-- 订阅消息提醒订阅(微信一次性订阅:用户点「提醒我」→ 记一条;推送后 sent_at 标记,一次订阅一次推送)。
-- kind: match_start(开赛前提醒) / report_ready(战报就绪)。重订阅 = upsert 重置 sent_at(再获一次推送额度)。
-- 存 openid 而非 user_id:推送 API touser=openid、客户端也只持 openid,免一次 users join。
CREATE TABLE IF NOT EXISTS match_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  openid TEXT NOT NULL,
  match_id UUID NOT NULL REFERENCES matches(id),
  kind TEXT NOT NULL CHECK (kind IN ('match_start', 'report_ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (openid, match_id, kind)
);
CREATE INDEX idx_match_subs_pending ON match_subscriptions (match_id, kind) WHERE sent_at IS NULL;

-- 埋点事件（E001-E099，见 STAGE_02_STRATEGY.md §四）
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  session_id TEXT,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_event_time ON events (event_id, created_at);
CREATE INDEX idx_events_user_time ON events (user_id, created_at);

-- 内容审核日志（合规：留存 ≥ 12 个月）
CREATE TABLE IF NOT EXISTS safety_logs (
  id BIGSERIAL PRIMARY KEY,
  scenario TEXT NOT NULL CHECK (scenario IN ('report', 'host', 'user_chat')),
  user_id UUID REFERENCES users(id),
  content_hash TEXT NOT NULL,
  result TEXT NOT NULL, -- pass | block
  category TEXT,
  reason TEXT,
  provider TEXT, -- local | shumei | yidun
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_safety_logs_time ON safety_logs (created_at);

-- ==== updated_at 自动维护 ====
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================================================================
-- RLS 策略（STAGE_05 §1.2 E15）
-- =================================================================
-- 默认所有 9 张表 ENABLE RLS。anon/authenticated 角色只能做下列策略允许的事；
-- 其他一切（含跨用户读、运营后台、战报写入）必须用 service_role 在
-- web/app/api/* 路由内代理 —— RLS 是 defense-in-depth，不是首要鉴权层。
--
-- 假设：users.id = Supabase auth.uid()（小程序登录后端要把 wx_openid → 创建 supabase auth 行）。
-- 若改 JWT claim 路径，把所有 auth.uid() 替换为 (auth.jwt()->>'app_user_id')::uuid。
-- =================================================================

ALTER TABLE matches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE landings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_quotes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_logs  ENABLE ROW LEVEL SECURITY;
-- match_subscriptions：订阅记录含 openid（PII），客户端不可直读/直写。
-- 不创建任何 policy = anon/authenticated 全拒；订阅写入(/api/subscribe)与推送(cron/auto-report)一律走 service_role。
ALTER TABLE match_subscriptions ENABLE ROW LEVEL SECURITY;

-- matches：所有人可读（赛程/比分非敏感），写入只走 service_role
CREATE POLICY matches_public_read ON matches FOR SELECT USING (true);

-- reports：免费战报公开读；premium 战报需 SKU 级权益放行
-- ⚠️ 真实付费墙在应用层（service_role + isPremiumUnlocked，app/api/report/[id]/route.ts）。
--    本 RLS 依赖 auth.uid()，仅在未来启用 anon 直读时生效；此处与应用层保持 SKU 级口径一致：
--      · deep_report（赛事通）解锁全程所有 premium
--      · final_column（决赛专栏）仅解锁带 scenario:final_column 标记的报告
CREATE POLICY reports_public_read_free ON reports FOR SELECT
  USING (is_premium = false);
CREATE POLICY reports_paid_read ON reports FOR SELECT
  USING (
    is_premium = true
    AND (
      EXISTS (SELECT 1 FROM payments p WHERE p.user_id = auth.uid() AND p.sku = 'deep_report' AND p.status = 'success')
      OR (
        reports.tags @> ARRAY['scenario:final_column']
        AND EXISTS (SELECT 1 FROM payments p WHERE p.user_id = auth.uid() AND p.sku = 'final_column' AND p.status = 'success')
      )
    )
  );

-- users：本人可读、可改 nickname/followed_teams/last_active_at；不放 INSERT/DELETE（service_role 代理 wx 登录）
CREATE POLICY users_self_read ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- shares：本人插自己的分享、本人读自己的分享（K 因子计算用 service_role 跨用户聚合）
CREATE POLICY shares_self_insert ON shares FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY shares_self_read ON shares FOR SELECT
  USING (auth.uid() = user_id);

-- landings：匿名访问（短链落地页）允许写一行回流，读只走 service_role
CREATE POLICY landings_anon_insert ON landings FOR INSERT WITH CHECK (true);

-- payments：本人查自己的订单状态；INSERT/UPDATE 仅 service_role（微信支付回调）
CREATE POLICY payments_self_read ON payments FOR SELECT USING (auth.uid() = user_id);

-- chat_quotes：本人插自己的金句、本人读自己的（战报金句池由 service_role 跨用户挑选）
CREATE POLICY chat_quotes_self_insert ON chat_quotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY chat_quotes_self_read ON chat_quotes FOR SELECT
  USING (auth.uid() = user_id);

-- events：匿名埋点允许（user_id NULL）；登录后必须自传 openid（防伪造别人）
CREATE POLICY events_anon_or_self_insert ON events FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
-- 读由 service_role 走（PII + 跨用户分析）

-- safety_logs：客户端不可读不可写。任何审核日志一律由 service_role 落库
-- （此处不创建任何 policy = anon/authenticated 全拒）

-- ==== Aggregate functions（W3 末新增）====

-- count_events_by_id: 给 admin events-recent 路由用，DB 端 GROUP BY 而非应用层 Map。
-- 解 TASK-18 §4.4 方案 A（L2 finding）。
-- 调用：select * from count_events_by_id(now() - interval '5 minutes');
-- 用法：admin events-recent route 在 L02 supabase 主体到位后切到 .rpc('count_events_by_id', { since }) 调用。
CREATE OR REPLACE FUNCTION count_events_by_id(since TIMESTAMPTZ)
RETURNS TABLE (
  event_id TEXT,
  event_name TEXT,
  count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    e.event_id,
    MAX(e.event_name) AS event_name,
    COUNT(*)::BIGINT AS count
  FROM events e
  WHERE e.created_at >= since
  GROUP BY e.event_id
  ORDER BY count DESC;
$$;

-- 限定调用方：rpc 走 service_role，禁止 anon / authenticated 直接调（避免泄漏全量统计）
REVOKE EXECUTE ON FUNCTION count_events_by_id(TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION count_events_by_id(TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION count_events_by_id(TIMESTAMPTZ) FROM anon;
-- service_role 默认有所有 schema function execute 权限，不需 GRANT
