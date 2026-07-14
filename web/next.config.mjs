import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 迁腾讯云：standalone 产物 = 自包含 server，Docker 镜像极小、一拉即跑
  output: 'standalone',
  // monorepo 关键：指向仓库根，否则 standalone 漏打 workspace 依赖 @qhs/share-cards → 运行时挂
  outputFileTracingRoot: path.join(dirname, '..'),
  // 老李 reel 背景乐:pipeline 里 path.join(process.cwd(),'assets','bgm','laoli-reel.mp3') 是动态引用,
  // nft 静态追踪抓不到 → standalone 漏打 mp3 → 生产静默降级为无乐(2026-07-07 build 实测漏打)。
  // 显式强制打进该路由的 trace(standalone 单 server,打进一处即全局可读);落 /app/web/assets/bgm/ 命中 cwd。
  outputFileTracingIncludes: {
    '/api/admin/laoli-video': ['./assets/bgm/laoli-reel.mp3'],
    '/api/admin/laoli-topic': ['./assets/bgm/laoli-reel.mp3'], // topic 片同款 BGM(2026-07-08 补)
  },
  serverExternalPackages: [
    '@resvg/resvg-js',
    'satori',
    'cos-nodejs-sdk-v5',
    '@remotion/bundler',
    '@remotion/renderer',
  ],
  images: {
    remotePatterns: [],
  },
  // 注意：不要在这里对 /api/card/:path* 全路径注入 Cache-Control/Content-Type——
  // 会把 404 NO_LINEUPS / 502 等 JSON 错误响应也盖成 `immutable image/png`，
  // CDN 一旦缓存赛前 404，开球后战术卡永远出不来（6/11 生产 smoke 实测）。
  // 成功 PNG 的缓存头由各 card 路由响应自身显式设置。
};

export default nextConfig;
