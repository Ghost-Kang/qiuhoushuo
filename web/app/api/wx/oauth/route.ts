/**
 * GET /api/wx/oauth — 服务号网页授权（snsapi_base 静默）换取 openid。
 *
 * 两段：
 *  1. START（无 code，带 sku/reportId）：302 跳微信 authorize，state 携带 sku.reportId。
 *  2. CALLBACK（带 code/state）：code 换 openid → 302 回 /pay?openid&sku&reportId。
 * 未配服务号 OAuth（dev/mock）：直接铸 mock openid 跳 /pay，链路可测可跑。
 *
 * 服务于 iOS H5 支付（scene=jsapi_mp）：/pay 无 openid 时跳本路由，回来即带上 openid。
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getSupabaseService, USE_DB } from '@/lib/api/mode';
import { signOpenidToken } from '@/lib/api/openid-token';
import { ensureUserByOpenid, type EnsureUserClient } from '@/lib/api/users';

function oauthCreds(): { appid: string; secret: string } | null {
  const appid = process.env.WXPAY_SERVICE_APPID;
  const secret = process.env.WXPAY_SERVICE_SECRET;
  return appid && secret ? { appid, secret } : null;
}

function baseUrl(url: URL): string {
  return process.env.NEXT_PUBLIC_SITE_URL || url.origin;
}

function mockOpenid(seed: string): string {
  return `mock_${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`;
}

// state 编码:默认沿用旧格式 `sku.reportId`(回跳 /pay,deep_report 等不变);
// avatar(iOS 球迷形象 H5)用新格式 `avatar~sku~reportId`,回跳 /avatar。
function splitState(state: string): { to: string; sku: string; reportId: string } {
  if (state.includes('~')) {
    const [to, sku = '', reportId = ''] = state.split('~');
    return { to: to === 'avatar' ? 'avatar' : 'pay', sku, reportId };
  }
  const idx = state.indexOf('.');
  if (idx < 0) return { to: 'pay', sku: state, reportId: '' };
  return { to: 'pay', sku: state.slice(0, idx), reportId: state.slice(idx + 1) };
}

function buildState(to: string, sku: string, reportId: string): string {
  return to === 'avatar' ? `avatar~${sku}~${reportId}` : `${sku}.${reportId}`;
}

function payRedirect(url: URL, to: string, openid: string, sku: string, reportId: string, err?: string): string {
  const target = new URL(to === 'avatar' ? '/avatar' : '/pay', baseUrl(url));
  // R4：openid 不进明文 URL，改塞 HMAC 签名 token（页面取 t 透传给下单路由验签）
  if (openid) target.searchParams.set('t', signOpenidToken(openid, Date.now()));
  if (sku) target.searchParams.set('sku', sku);
  if (reportId) target.searchParams.set('reportId', reportId);
  if (err) target.searchParams.set('err', err);
  return target.toString();
}

async function resolveOpenid(code: string, creds: { appid: string; secret: string }): Promise<string | null> {
  const qs = new URLSearchParams({
    appid: creds.appid,
    secret: creds.secret,
    code,
    grant_type: 'authorization_code',
  });
  const res = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${qs}`);
  const data = (await res.json()) as { openid?: string; errcode?: number; errmsg?: string };
  if (!data.openid) {
    console.error('[wx/oauth] sns access_token 无 openid:', JSON.stringify(data));
  }
  return data.openid ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const creds = oauthCreds();
  const code = url.searchParams.get('code');

  // CALLBACK
  if (code) {
    const { to, sku, reportId } = splitState(url.searchParams.get('state') ?? '');
    const openid = creds ? await resolveOpenid(code, creds) : mockOpenid(code);
    if (!openid) {
      console.error('[wx/oauth] oauth_failed: 换 openid 失败 state=', url.searchParams.get('state'));
      return NextResponse.redirect(payRedirect(url, to, '', sku, reportId, 'oauth_failed'));
    }
    const ensured = await ensureOAuthUser(openid);
    if (!ensured) {
      console.error('[wx/oauth] profile_failed: 建档失败 openid=', openid);
      return NextResponse.redirect(payRedirect(url, to, '', sku, reportId, 'profile_failed'));
    }
    return NextResponse.redirect(payRedirect(url, to, openid, sku, reportId));
  }

  // START
  const to = url.searchParams.get('to') === 'avatar' ? 'avatar' : 'pay';
  const sku = url.searchParams.get('sku') ?? '';
  const reportId = url.searchParams.get('reportId') ?? '';
  const state = buildState(to, sku, reportId);

  if (!creds) {
    // mock：跳过微信，直接铸 openid 回页面
    return NextResponse.redirect(payRedirect(url, to, mockOpenid(state), sku, reportId));
  }

  const redirectUri = encodeURIComponent(`${baseUrl(url)}/api/wx/oauth`);
  const authorize =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${creds.appid}` +
    `&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base` +
    `&state=${encodeURIComponent(state)}#wechat_redirect`;
  return NextResponse.redirect(authorize);
}

async function ensureOAuthUser(openid: string): Promise<boolean> {
  if (!USE_DB) return true;
  const db = getSupabaseService();
  if (!db) return true;
  try {
    await ensureUserByOpenid(db as unknown as EnsureUserClient, openid);
    return true;
  } catch {
    return false;
  }
}
