import COS from 'cos-nodejs-sdk-v5';
import type { Platform } from '@/lib/share-cards';
import type { ReportStyle } from '@/lib/prompts';

export interface CardStorageClient {
  exists(key: string): Promise<string | null>;
  put(key: string, body: Buffer, contentType: StorageContentType): Promise<string>;
  /**
   * 读对象字节(走 COS API，容器内可达)。inline 命中缓存时用它直返字节,
   * 不要 fetch CDN 域名——CDN(img.qiuhoushuo.cn)在容器内 hairpin NAT 不可达,fetch 必失败→回退重渲染(每次 ~8s)。
   * 找不到/失败返回 null。可选:未实现的存储(部分测试 mock)→ 路由按 cache miss 回退重渲染。
   */
  getBytes?(key: string): Promise<Buffer | null>;
}

export type StorageContentType =
  | 'image/png'
  | 'image/jpeg'
  | 'video/mp4'
  | 'audio/wav'
  | 'audio/mpeg'
  | 'application/json';

export interface CardKey {
  reportId: string;
  style: ReportStyle;
  platform: Platform;
}

// v7(6/12):一图看懂 brief 版式修复后升版,避开已写入的 v6 遮挡图。
// v6(6/12):全模板长文案防遮挡改造后升版,避开旧布局图。
// v5(6/12):v4 期间曾写入一张中间版 duanzi-xhs 裁字图,升版彻底避开。
// v4(6/12):修复 duanzi-xhs 长标题遮挡后升版,避免继续命中已落 COS/CDN 的旧遮挡图。
// v5(6/12):v4 期间 7MB 镜头 PNG 拉超时,兜底图卡被缓存(F65);v3 期间缓存过节选超长压标题的卡(用户截图实证);v2 期间存在"镜头图生成前渲染的卡被 immutable 缓存"的脏数据,整体升版失效。
// 配套规则:镜头位有图才允许回填缓存(card 路由),从结构上杜绝再次缓存无图卡。
// v9(6/12):brief 一图看懂"胜负关键"evidence(情绪落点取 emotion lead 可达 300 字)单行 overflow:hidden 拦腰切断在半字(F67c),
//   改 clampLine 单行省略号;升版失效历史断字 brief 图。
// v10(6/12):F67e 用户要求胜负关键文字完整显示,evidence 单行→2 行(~96 字容量),reasonBox 升高 68→82、间距 82→86;
//   升版失效 v9 单行省略号 brief 图。
// v11(6/12):F67f brief 跨风格合成(情绪落点改用 emotion lead 而非默认短句)——内容变了,
//   升版失效 v10 用旧单 style 默认文案渲染的 brief 图。
// v12(6/12):F67g brief 整体重排版(战术阵型紧凑球场整合 + 比分主视觉 + 年轻化高级感)——版面全变,失效 v11。
// v13(6/12):F67h brief 顶栏赛事名换行遮挡修复(改单行裁净)+ 赛事名境外赛事商标词合规清洗(→国际大赛)——内容/版面变,失效 v12。
// v14(6/12):F67i brief 紧凑球场阵型点竖向重叠修复(圆点 30→20 + 按线序均匀铺满半场)——渲染变,失效 v13。
// v15(6/12):预渲染卡 competition 此前 raw(card-prerender 未脱敏),与按需 /api/card 不一致——
//   补 sanitizeCompetition 后升版,失效 v14 里可能烤进境外赛事商标词的预渲染脏卡(cache-first 会续服务旧卡)。
// v17(6/14):一图看懂头部加球队国旗(brief scoreHero teamBadge)——渲染变,失效 v16 旧无旗缓存卡。
// v18(6/15):卡片短链域名 qiu.app(占位/未拥有)→ qiuhoushuo.com——shortUrl 印进图里,升版失效旧含死链卡。
// v19(6/16):9 张分享卡(三风格×三平台)队名后加国旗(`flagImg`,复用 homeFlagUrl/awayFlagUrl base64)——渲染变,失效 v18 无旗卡。
// v20(6/26):一图看懂「关键时间线」改吃真实赛事事件(进球/点球/红牌+累计比分,matches.events),原只塞 1 个合成镜头致单行——内容变,失效 v19 薄时间线卡。
// v21(6/26):修截断「只显示一半」——数据证据注释 1 行(6字)→2 行铺满盒高;时间线球员名取姓(全名被拦腰切)——渲染/内容变,失效 v20。
// v22(6/26):sync-fixtures 不再覆盖 enrich 的技术统计(改合并 stats)→ 数据证据恢复;失效 clobber 期渲的比分-only 卡。
// v23(6/26):关键时间线加争议事件——VAR 改判 / 点球射失(events.ts 不再丢弃 var/missed penalty)——内容变,失效 v22。
// v24(6/26):代表镜头标题按本场特征生成(绝杀/逆转/点球/VAR/大胜/进球者),替换千篇一律「XXX把比分写进镜头」——内容变,失效 v23。
// v25(6/26):镜头标题微调——大胜优先于 VAR(VAR 改写不了一场大胜)+ VAR 措辞软化为「VAR 介入的一战」——内容变,失效 v24。
// v26(6/26):时间线进球加关键球员看点——梅开二度/帽子戏法 + 助攻者(放得下带)——内容变,失效 v25。
// v27(6/26):一图看懂代表镜头说明改用「全场最佳」(stats.players.motm,/fixtures/players)——内容变,失效 v26。
// v28(6/26):球员名字体安全转写(fontSafe 去 ğ/ı/ş 豆腐块)——MOTM 文案现走转写,内容变,失效 v27;
//   同时引入球员评分卡(ratings)、射手榜/助攻榜(scoreboard)、小组积分榜(standings)三新卡(各自独立 key 路径)。
// v29(6/26):球员评分卡全场最佳横幅控长 16→20(长名 "Idrissa Gana Gueye" 不再被截)——ratings 渲染变,失效 v28。
// v30(6/27):球员评分卡球员名优先中文译名(lookupPlayerZh)+ 主客队列加国旗;射手榜球员名同译中文——ratings/scoreboard 渲染变,失效 v29。
// v31(6/27):球员中文译名字典扩到全员(PLAYER_ZH_FULL·477 名,冷门队球员也出中文)——球员评分卡/射手榜名字变,失效 v30。
// v32(6/28):三平台一键分享图重设计(hardcore/duanzi/emotion × wechat/xhs/x 全换新版面)——
//   金句升主视觉 + 真实镜头大图 + 数据可视化 + 合规引流(站外纯文字);report 卡渲染全变,失效 v31。
// v33(6/28):分享卡金句/标题多行重叠修复(stackLines·nowrap)+ 赛事名赛段英→中(Group Stage→小组赛第N轮·
//   Round of 32→32强赛 等),所有卡的赛事名文案变;report 卡版面微调。失效 v32。
// 注:战术图解卡走独立 key(buildTacticsCardKey,见 tactics-card.ts),不归此版本号管。
// 注:淘汰赛对阵图卡(bracket·6/30 新增)走 cards/<版本>/leaderboard/bracket-<小时戳>-xhs.png(见 bracket-card.ts);
//   新卡类型、不改任何旧卡渲染 → 不 bump 版本号(bump 会白白失效全部旧卡)。
// v34(7/3):球员中文译名字典扩到 32强淘汰赛全员(补 ~864 名)+ 一图看懂时间线 shortPlayer 改译名优先——
//   brief/ratings 卡球员名文案变,失效 v33。⚠️升版后必跑 deploy/prewarm-all.sh 全量回暖(否则旧战报卡全冷)。
export const CARD_RENDER_CACHE_VERSION = 'v34';

const memoryObjects = new Map<string, { body: Buffer; contentType: StorageContentType; url: string }>();

export function buildCardKey(k: CardKey): string {
  const safeReportId = encodeURIComponent(k.reportId).replace(/%2F/gi, '');
  return `cards/${CARD_RENDER_CACHE_VERSION}/${safeReportId}/${k.style}-${k.platform}.png`;
}

export function createMemoryCardStorage(): CardStorageClient {
  return {
    async exists(key) {
      return memoryObjects.get(key)?.url ?? null;
    },
    async put(key, body, contentType) {
      const url = `memory://card-storage/${key}`;
      memoryObjects.set(key, { body, contentType, url });
      return url;
    },
    async getBytes(key) {
      return memoryObjects.get(key)?.body ?? null;
    },
  };
}

// --- 腾讯云 COS 卡片存储（迁腾讯云 / 决赛日抗洪峰；架构审视 R1：替代进程内存兜底）---
// 预生成卡片走 COS 对象存储 + CDN，多实例共享、确定性 key、immutable 缓存。

export interface CosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  /** CDN 回源域名（如 https://cdn.qiuhoushuo.cn）；空则用 COS 默认域名 */
  cdnBase: string;
}

export function loadCosConfig(env: NodeJS.ProcessEnv = process.env): CosConfig | null {
  const secretId = env.COS_SECRET_ID;
  const secretKey = env.COS_SECRET_KEY;
  const bucket = env.COS_BUCKET;
  const region = env.COS_REGION;
  if (!secretId || !secretKey || !bucket || !region) return null;
  return { secretId, secretKey, bucket, region, cdnBase: (env.COS_CDN_BASE_URL ?? '').replace(/\/+$/, '') };
}

export function cosObjectUrl(cfg: CosConfig, key: string): string {
  return cfg.cdnBase ? `${cfg.cdnBase}/${key}` : `https://${cfg.bucket}.cos.${cfg.region}.myqcloud.com/${key}`;
}

/** COS SDK 的最小回调形态，便于单测注入假 client，不耦合 SDK 全量类型。 */
export interface CosLike {
  headObject(
    params: { Bucket: string; Region: string; Key: string },
    cb: (err: { statusCode?: number } | null, data?: unknown) => void,
  ): void;
  putObject(
    params: { Bucket: string; Region: string; Key: string; Body: Buffer; ContentType: string },
    cb: (err: Error | null, data?: unknown) => void,
  ): void;
  getObject(
    params: { Bucket: string; Region: string; Key: string },
    cb: (err: { statusCode?: number } | null, data?: { Body?: Buffer | Uint8Array | string }) => void,
  ): void;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;
}

export function createCosCardStorage(cfg: CosConfig | null = loadCosConfig(), client?: CosLike): CardStorageClient {
  if (!cfg) {
    throw new Error('COS 配置缺失：需 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION（可选 COS_CDN_BASE_URL）');
  }
  const cos: CosLike = client ?? (new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey }) as unknown as CosLike);
  const base = { Bucket: cfg.bucket, Region: cfg.region };
  return {
    exists(key) {
      return new Promise((resolve, reject) => {
        cos.headObject({ ...base, Key: key }, (err) => {
          if (!err) return resolve(cosObjectUrl(cfg, key));
          if (isNotFound(err)) return resolve(null);
          return reject(err instanceof Error ? err : new Error(`COS headObject failed: ${JSON.stringify(err)}`));
        });
      });
    },
    put(key, body, contentType) {
      return new Promise((resolve, reject) => {
        cos.putObject({ ...base, Key: key, Body: body, ContentType: contentType }, (err) => {
          if (err) return reject(err);
          return resolve(cosObjectUrl(cfg, key));
        });
      });
    },
    getBytes(key) {
      return new Promise((resolve) => {
        cos.getObject({ ...base, Key: key }, (err, data) => {
          if (err || !data || data.Body == null) return resolve(null);
          const body = data.Body;
          resolve(Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        });
      });
    },
  };
}

export function getCardStorage(): CardStorageClient {
  const cfg = loadCosConfig();
  if (cfg) return createCosCardStorage(cfg);
  return createMemoryCardStorage();
}

export function __resetMemoryCardStorageForTests() {
  memoryObjects.clear();
}
