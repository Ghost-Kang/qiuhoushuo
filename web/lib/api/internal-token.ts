/**
 * 内部令牌统一取值(公开仓库审计 L1 加固):生产环境缺配一律 fail-closed 抛错,
 * 绝不回退到可猜的 dev 字面量;dev/test 保留固定回退便于本地与单测。
 */

export function requireInternalToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.INTERNAL_TOKEN;
  if (token) return token;
  if (env.NODE_ENV === 'production') {
    throw new Error('INTERNAL_TOKEN 未配置(生产环境禁止 dev 回退)');
  }
  return 'dev-internal-token';
}

export function requireOpenidSignKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.OPENID_SIGN_KEY || env.INTERNAL_TOKEN;
  if (key) return key;
  if (env.NODE_ENV === 'production') {
    throw new Error('OPENID_SIGN_KEY/INTERNAL_TOKEN 未配置(生产环境禁止 dev 回退)');
  }
  return 'dev-openid-sign-key';
}
