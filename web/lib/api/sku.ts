/**
 * 微付费 SKU 注册表（服务端权威定价，绝不信客户端金额）。
 *
 * 6/1 定价决策（decisions/2026-06-01-purchase-monetization-under-getihu.md）：
 *   - deep_report  → 「赛事通」¥19：一次买解锁全程深度战报（原 ¥3 单篇打包升级）
 *   - final_column → 「决赛专栏」¥9：决赛日深度复盘（买赛事通免费送）
 *   - avatar_card  → 「球迷形象」¥1：消费型,一次付费生成一次卡通形象（fulfilled_at 标兑付）
 *
 * sku 取值与 web/db/schema.sql payments.sku CHECK 约束保持一致
 * （deep_report / final_column / avatar_card），不改表名，仅在应用层映射价格与文案。
 */

export type Sku = 'deep_report' | 'final_column' | 'avatar_card';

export interface SkuInfo {
  sku: Sku;
  amountCents: number;
  label: string;
  description: string;
}

export const SKUS: Record<Sku, SkuInfo> = {
  deep_report: {
    sku: 'deep_report',
    amountCents: 1900,
    label: '赛事通',
    description: '解锁全程深度战报',
  },
  final_column: {
    sku: 'final_column',
    amountCents: 900,
    label: '决赛专栏',
    description: '决赛日深度复盘',
  },
  avatar_card: {
    sku: 'avatar_card',
    amountCents: 100,
    label: '球迷形象',
    description: '生成你的专属球迷卡通形象',
  },
};

export function isSku(value: string): value is Sku {
  return value === 'deep_report' || value === 'final_column' || value === 'avatar_card';
}

export function getSku(value: string): SkuInfo | null {
  return isSku(value) ? SKUS[value] : null;
}
