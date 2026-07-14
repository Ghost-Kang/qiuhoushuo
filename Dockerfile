# syntax=docker/dockerfile:1
# 球后说 · 迁腾讯云镜像（pnpm monorepo + Next.js standalone）
# 原则：模块化多 stage + BuildKit 层缓存 + cache mount → 依赖不重装、改代码只增量重编。
#   · deps 层：只拷 manifest 装依赖 → 代码改动不命中此层（依赖不重装）
#   · pnpm store / Next .next/cache 走 cache mount → 跨次构建复用，增量编译
# 需 BuildKit（Docker 23+，本机 29）；node:20-slim(glibc) 避 alpine/musl 对 @resvg 的坑。
# 镜像源：Docker daemon 已配腾讯云 registry mirror；npm 走 npmmirror。

FROM node:20-slim AS base
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
# 老李赛后合成视频(reel)需 ffmpeg/ffprobe(PiP concat + filter_complex 出片);node:20-slim 不自带。
# 放 base 以便 build/runner 都继承(runner PATH 需 ffmpeg);--no-install-recommends + 清 lists 控体积(约 +150–250MB)。
# ⚠️ 先把 apt 源换成腾讯云内网镜像:默认 deb.debian.org 从腾讯云机龟速(实测 ffmpeg 依赖下 40min+ 没完)。
RUN { sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
   || sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list 2>/dev/null || true; } \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
# 钉 pnpm 版本（与本地一致）：corepack 默认拉 pnpm 11 需 Node22 的 node:sqlite，与 node:20 冲突
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---------- deps：只拷 manifest 装依赖（依赖层，代码改不动它）----------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY web/package.json web/package.json
COPY packages/share-cards/package.json packages/share-cards/package.json
RUN pnpm config set registry https://registry.npmmirror.com \
 && pnpm config set store-dir /pnpm/store
# pnpm store 走 cache mount：依赖变更也只拉增量，不全量重下
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build：复用 deps 的 node_modules + 拷源码 + 增量编译 ----------
FROM deps AS build
# 仅源码（.dockerignore 已排除 node_modules/.next）→ 代码改动只让本层及之后重跑
COPY . .
# Next .next/cache 走 cache mount → 跨次构建复用编译产物（增量）
RUN --mount=type=cache,id=next-cache,target=/app/web/.next/cache \
    pnpm --filter @qhs/share-cards run build \
 && pnpm --dir web run build
# 卡片渲染所需中文字体：nft 不追踪 share-cards 里 createRequire 动态 require 的 .woff，且
# /app/node_modules/@fontsource 是 pnpm 符号链接 COPY 不可达 → 用 cp -L 解引用到真实目录，
# 供 runner 直接 COPY 进 standalone 的 node_modules（require.resolve 上溯即可命中）。
RUN FS=/app/node_modules/.pnpm/@fontsource+noto-sans-sc@5.2.9/node_modules/@fontsource/noto-sans-sc \
 && mkdir -p /fontpkg/files \
 && cp "$FS/package.json" /fontpkg/package.json \
 && cp "$FS/files/noto-sans-sc-chinese-simplified-400-normal.woff" /fontpkg/files/ \
 && cp "$FS/files/noto-sans-sc-chinese-simplified-700-normal.woff" /fontpkg/files/ \
 && cp "$FS/files/noto-sans-sc-chinese-simplified-900-normal.woff" /fontpkg/files/

# ---------- runner：最小镜像，仅 standalone 产物 ----------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# monorepo standalone 结构：/app/web/server.js（outputFileTracingRoot 已指仓库根）
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
# Next standalone 不自动含 public/ → 须显式拷,否则 /avatar-samples 等静态资源 404。
COPY --from=build /app/web/public ./web/public
# Next standalone 的依赖追踪(nft)无法静态识别 share-cards 里 createRequire 动态 require 的 .woff
# → standalone 漏打中文字体 → 卡片渲染 500「Cannot find module ...woff」。显式补进 standalone
# 的 node_modules（require.resolve 从 /app/packages/share-cards/dist 上溯到 /app/node_modules）。
COPY --from=build /fontpkg ./node_modules/@fontsource/noto-sans-sc
EXPOSE 3000
# ⚠️ instrumentation boot guard 在 production 缺必填 key 会 fail-fast，部署前 .env.production 须补齐。
CMD ["node", "web/server.js"]
