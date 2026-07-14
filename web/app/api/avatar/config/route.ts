/**
 * GET /api/avatar/config — 客户端读取「球迷形象」相关可见性 flag（无鉴权·只读 flag·默认全 false）。
 *
 * costar_entry：小程序「与球星合影」入口是否展示。与**生成门** feature.fan_avatar_costar 分离——
 *   入口门 feature.fan_avatar_costar_entry 是独立的灰度/风控开关,可随运营策略单独启停。
 * 默认隐藏(flag 未设即 false),请求失败客户端也保持隐藏(fail-closed)。
 */
import { NextResponse } from 'next/server';
import { isFeatureEnabled } from '@/lib/api/feature-flags';

export function GET(req: Request) {
  const identity = {
    openid: req.headers.get('x-openid') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined,
  };
  return NextResponse.json({
    costar_entry: isFeatureEnabled('feature.fan_avatar_costar_entry', identity),
  });
}
