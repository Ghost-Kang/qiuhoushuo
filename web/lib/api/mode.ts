import { createClient } from '@supabase/supabase-js';

export const USE_DB = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
export const USE_WECHAT = !!process.env.WX_APPID && !!process.env.WX_SECRET;
export const USE_WXPAY =
  process.env.WXPAY_ENABLED === '1' &&
  !!process.env.WXPAY_MCHID &&
  !!process.env.WXPAY_MERCHANT_SERIAL &&
  !!process.env.WXPAY_PRIVATE_KEY &&
  !!process.env.WXPAY_API_V3_KEY;

export function getSupabaseAnon() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

export function getSupabaseService() {
  if (!USE_DB) return null;
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
}
