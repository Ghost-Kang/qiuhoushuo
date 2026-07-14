/**
 * 赛后「社媒内容」自动生成引擎（小红书 / 抖音 / 视频号 一套逻辑）。
 *
 * 触发：auto-report cron 在战报落库 + 卡片预渲染之后,对每个开启的平台各生成一份内容(与公众号草稿同一挂点)。
 *   门控:XHS_AUTO_GEN / DOUYIN_AUTO_GEN / CHANNELS_AUTO_GEN(各自缺省关)。
 * 产出（每平台 ≥3 条可直接用的内容）：
 *   - 小红书：图文笔记(一图看懂/段子/追剧情绪 + 球迷写真模板);
 *   - 抖音：短视频脚本(一图看懂卡点/段子解说 + 球迷写真过程);
 *   - 视频号：短视频脚本(一图看懂解说/情绪向 + 球迷写真过程)。
 * 落地：`${SOCIAL_CONTENT_DIR}/<日期-主-客-id8>/<平台>/`（README 索引 + 每条一个 .md）。
 * 通知：notifyOps 企微每平台一条——含首条全文 + 其余标题 + 文件夹路径 + 配图链接。
 *
 * 平台差异由 PlatformSpec 承载（prompt / 内容种类 / 关注话术 / 禁词 / 模板）。引擎部分完全共用。
 * 小红书另有「关注转化层」(GROWTH-ROOTCAUSE-PLAN-2026-07-08):追更承诺 CTA(距决赛动态 N 天·决赛后切留存承诺)、
 *   球后锐评进 prompt、金靴/射手榜自动附同场次口径标注+「少赛」系代码层护栏、每条带建议首评。抖音/视频号行为不变。
 *
 * 合规硬护栏：
 *   - 站外（小红书/抖音）：正文命中 微信/二维码/小程序/公众号/扫码/外链 任一 → 该条整条回退到确定性干净模板;
 *     上线后关注话术做正式导流(站外=微信搜超帧球后说·文字搜索;视频号=挂下方小程序);仍禁二维码/外链;
 *   - 站内（视频号·微信生态内）：允许提 小程序/公众号(导流合规),但禁竞品平台名(抖音/快手/小红书…)与外部链接;
 *   - 三平台共性:赛事走 sanitizeCompetition 脱英文 + 标签含 #国际大赛;不写极限词;AI 图注「AI生成」。
 */
import { callLLM, type LLMCallOptions, type LLMResult } from '@/lib/llm';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';
import { createHash } from 'node:crypto';
import { translateTeam } from '@qhs/share-cards';
import { createFanPortraitProviderFromEnv, ensureFanPortraitBytes } from '@/lib/api/fan-portrait';
import { generateFanAvatar, createFanAvatarProviderFromEnv } from '@/lib/api/fan-avatar';
import { isFeatureEnabled } from '@/lib/api/feature-flags';
import { getCardStorage } from '@/lib/api/card-storage';
import { shrinkImageForWecom } from '@/lib/api/image-shrink';
import type { AlertPayload } from '@/lib/alerts';

// ============ 类型 ============

export type PlatformId = 'xhs' | 'douyin' | 'channels';
export const PLATFORM_IDS: PlatformId[] = ['xhs', 'douyin', 'channels'];

export interface SocialNote {
  kind: string;
  label: string; // 「一图看懂」「卡点视频」
  coverTitle: string; // 封面/首帧大字 ≤12 字
  coverSub: string;
  title: string; // 文案/标题
  body: string; // 小红书=正文;抖音/视频号=分镜脚本+口播
  tags: string[];
  suggestTime: string;
  images: string[]; // 配图/素材链接
  /** 建议首评(发布后立即自评论·追更钩子)。目前仅小红书生成;抖音/视频号恒缺省。 */
  firstComment?: string;
}

export interface SocialReportInput {
  title: string;
  shareQuote: string;
  lead: string;
  body: string[];
}

export interface SocialFacts {
  matchId: string;
  date: string;
  matchLabel: string; // 「巴西 2:1 西班牙」
  home: string;
  away: string;
  score: string;
  competition: string;
  reports: Partial<Record<'hardcore' | 'duanzi' | 'emotion', SocialReportInput>>;
  briefCardUrl: string;
  ratingsCardUrl: string;
  /** 当场球星(MOTM→进球者)+ 其队伍(中文),供 costar 合影引流图;无则跳过该图。 */
  star?: string;
  starTeam?: string;
}

export interface SocialBundle {
  platform: PlatformId;
  matchId: string;
  matchLabel: string;
  notes: SocialNote[];
}

export interface SocialFile {
  name: string;
  content: string;
}

/** 平台差异配置。引擎据此生成/兜底/通知。 */
export interface PlatformSpec {
  id: PlatformId;
  name: string; // 小红书 / 抖音 / 视频号
  followCta: string;
  /** 动态关注话术(如小红书按比赛日期出「最后N天」追更承诺);缺省回落 followCta。仅小红书实现,抖音/视频号行为冻结勿加。 */
  followCtaFor?(facts: SocialFacts): string;
  forbidden: RegExp[];
  llmKinds: string[]; // 由 LLM 生成的内容种类
  kindLabel: Record<string, string>;
  kindTime: Record<string, string>;
  systemPrompt: string; // 平台红线/语气系统词
  kindBrief: Record<string, string>; // 每类内容的生成要求(单条 prompt 用)
  fallbackNote(kind: string, facts: SocialFacts): SocialNote;
  extraNotes(facts: SocialFacts): SocialNote[]; // 确定性追加(如球迷写真)
  imagesFor(kind: string, facts: SocialFacts): string[];
  /** 逐条后处理(金靴口径标注/建议首评等确定性追加);LLM 条、兜底条、extra 条统一过。缺省不动。仅小红书实现。 */
  postProcess?(note: SocialNote, facts: SocialFacts): SocialNote;
}

// ============ 共用红线/工具 ============

/** 站外(小红书/抖音):上线后允许"微信搜超帧球后说"文字搜索导流;仍禁 二维码/小程序码/扫码/加微信/外链(站外硬红线=微信码,见 memory project_share_card_qr)。 */
export const STATION_OUT_FORBIDDEN: RegExp[] = [
  /二维码/, /小程序码/, /微信码/, /扫码/, /加.{0,4}微信/, /微信号/, /加群/,
  /https?:\/\//i, /[a-z0-9-]+\.(?:com|cn|net|cc|xyz)\b/i,
];
/** 站内(视频号):允许微信生态导流,但禁竞品平台名 + 外链。 */
export const CHANNELS_FORBIDDEN: RegExp[] = [
  /抖音/, /快手/, /小红书/, /bilibili/i, /b\s*站/i, /微博/, /tiktok/i,
  /https?:\/\//i, /[a-z0-9-]+\.(?:com|cn|net|cc|xyz)\b/i,
];

export function hasForbidden(text: string, forbidden: RegExp[]): boolean {
  return forbidden.some((re) => re.test(text));
}

export function coerceTags(tags: unknown): string[] {
  const arr = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const withHash = arr.map((t) => (t.startsWith('#') ? t : `#${t}`));
  if (!withHash.some((t) => t === '#国际大赛')) withHash.unshift('#国际大赛');
  return Array.from(new Set(withHash)).slice(0, 8);
}

export function ensureCta(body: string, cta: string): string {
  const stripped = body.replace(cta, '').trimEnd();
  return `${stripped}\n\n${cta}`;
}

/** 该平台对这场比赛用的关注话术(动态优先,回落静态)。 */
export function followCtaFor(spec: PlatformSpec, facts: SocialFacts): string {
  return spec.followCtaFor ? spec.followCtaFor(facts) : spec.followCta;
}

/** 逐条后处理挂点(spec 未实现则原样返回)。 */
function finalizeNote(spec: PlatformSpec, note: SocialNote, facts: SocialFacts): SocialNote {
  return spec.postProcess ? spec.postProcess(note, facts) : note;
}

/** 给所有 spec 复用的 prompt 素材块(比赛 + 三版战报提炼)。 */
export function factsBlock(facts: SocialFacts): string {
  const lines = (['hardcore', 'duanzi', 'emotion'] as const)
    .map((s) => {
      const r = facts.reports[s];
      if (!r) return null;
      const tag = s === 'hardcore' ? '战术版' : s === 'duanzi' ? '段子版' : '情绪版';
      return `【${tag}】标题:${r.title}｜金句:${r.shareQuote}｜要点:${(r.body || []).slice(0, 2).join(' / ')}`;
    })
    .filter(Boolean)
    .join('\n');
  return `比赛:${facts.matchLabel}（${facts.competition}）\n三版战报素材(提炼别照抄):\n${lines || '（无战报素材,按比分发挥）'}`;
}

// ============ 解析 + 规整 ============

interface RawNote {
  kind?: string;
  coverTitle?: string;
  coverSub?: string;
  title?: string;
  body?: string;
  tags?: unknown;
}

function normalizeNote(spec: PlatformSpec, kind: string, raw: RawNote | undefined, facts: SocialFacts): SocialNote {
  if (!raw || !raw.title || !raw.body) return finalizeNote(spec, spec.fallbackNote(kind, facts), facts);
  const fb = spec.fallbackNote(kind, facts);
  const note: SocialNote = {
    kind,
    label: spec.kindLabel[kind] ?? kind,
    coverTitle: String(raw.coverTitle || '').trim() || fb.coverTitle,
    coverSub: String(raw.coverSub || '').trim() || fb.coverSub,
    title: String(raw.title).trim(),
    body: ensureCta(String(raw.body).trim(), followCtaFor(spec, facts)),
    tags: coerceTags(raw.tags),
    suggestTime: spec.kindTime[kind] ?? '',
    images: spec.imagesFor(kind, facts),
  };
  // 禁词双保险:命中即整条回退到干净模板。
  if (hasForbidden(`${note.coverTitle}\n${note.coverSub}\n${note.title}\n${note.body}\n${note.tags.join(' ')}`, spec.forbidden)) {
    return finalizeNote(spec, fb, facts);
  }
  return finalizeNote(spec, note, facts);
}

/** 单条 prompt(系统词 = 平台红线;user = 素材 + 该类要求 + 单条 JSON 结构)。 */
export function buildKindPrompt(spec: PlatformSpec, kind: string, facts: SocialFacts): LLMCallOptions['messages'] {
  const user = [
    factsBlock(facts),
    '',
    `只为「${spec.kindLabel[kind] ?? kind}」这一条输出**严格 JSON**(无多余文字):`,
    '{"note":{"coverTitle":"封面/首帧大字≤12字","coverSub":"副标","title":"文案/标题带emoji","body":"正文/分镜脚本","tags":["#国际大赛"]}}',
    `内容要求:${spec.kindBrief[kind] ?? ''}`,
    `body 结尾**原样附**这句关注话术:「${followCtaFor(spec, facts)}」;tags 6-8 个,必含 #国际大赛。`,
  ].join('\n');
  return [
    { role: 'system', content: spec.systemPrompt },
    { role: 'user', content: user },
  ];
}

/** 解析单条 JSON(容忍 {note:{}} / 裸 {} / {notes:[{}]});规整 + 禁词回退。 */
export function parseOneNote(spec: PlatformSpec, kind: string, raw: string, facts: SocialFacts): SocialNote {
  let obj: { note?: RawNote; notes?: RawNote[] } & RawNote = {};
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    obj = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : {};
  } catch {
    obj = {};
  }
  const one = obj.note ?? (Array.isArray(obj.notes) ? obj.notes[0] : obj);
  return normalizeNote(spec, kind, one as RawNote | undefined, facts);
}

// ============ 生成 bundle ============

export type SocialLLMFn = (opts: LLMCallOptions) => Promise<LLMResult>;

/**
 * 每条笔记**单独并行**调 LLM(对齐战报"每风格单调"——小输出、稳、不超时;一次调多条会让推理模型超 60s 被 abort)。
 * 单条失败(超时/解析失败)只回退该条到确定性模板,其余不受影响;再追加确定性条目(球迷写真)。永不抛。
 */
export async function generateSocialBundle(
  facts: SocialFacts,
  spec: PlatformSpec,
  deps: { llm?: SocialLLMFn } = {},
): Promise<SocialBundle> {
  const llm = deps.llm ?? callLLM;
  const llmNotes = await Promise.all(
    spec.llmKinds.map(async (k) => {
      try {
        const res = await llm({
          messages: buildKindPrompt(spec, k, facts),
          responseFormat: 'json',
          temperature: 0.85,
          maxTokens: 1400,
          timeoutMs: 55_000,
          caller: `social-content:${spec.id}:${k}`,
        });
        return parseOneNote(spec, k, res.content, facts);
      } catch {
        return finalizeNote(spec, spec.fallbackNote(k, facts), facts);
      }
    }),
  );
  const notes = [...llmNotes, ...spec.extraNotes(facts).map((n) => finalizeNote(spec, n, facts))];
  return { platform: spec.id, matchId: facts.matchId, matchLabel: facts.matchLabel, notes };
}

// ============ 渲染 markdown ============

function noteMarkdown(n: SocialNote): string {
  return [
    `# ${n.label}`,
    '',
    `**封面/首帧大字**：主标「${n.coverTitle}」／副标「${n.coverSub}」`,
    `**建议发布**：${n.suggestTime}`,
    '',
    '## 文案 / 标题',
    n.title,
    '',
    '## 正文 / 脚本',
    n.body,
    '',
    '## 标签',
    n.tags.join(' '),
    '',
    ...(n.firstComment ? ['## 建议首评(发布后立即自评论)', n.firstComment, ''] : []),
    '## 配图 / 素材',
    ...n.images.map((i) => `- ${i}`),
    '',
  ].join('\n');
}

export function renderSocialMarkdown(spec: PlatformSpec, bundle: SocialBundle): SocialFile[] {
  const index = [
    `# ${spec.name}内容 · ${bundle.matchLabel}`,
    '',
    `match_id: ${bundle.matchId}`,
    '',
    `本场自动生成 ${bundle.notes.length} 条(复制即用):`,
    '',
    ...bundle.notes.map((n, i) => `${i + 1}. **${n.label}** — ${n.title}`),
    '',
    '> 红线:外发图去微信码、留「AI生成」标识;审核期统一关注话术。',
    '',
  ].join('\n');
  const files: SocialFile[] = [{ name: 'README.md', content: index }];
  bundle.notes.forEach((n, i) => files.push({ name: `${i + 1}-${n.label}.md`, content: noteMarkdown(n) }));
  return files;
}

// ============ 落盘 ============

export function matchFolderName(facts: SocialFacts): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 16) || 'team';
  return `${facts.date}-${safe(facts.home)}-${safe(facts.away)}-${facts.matchId.slice(0, 8)}`;
}

export function socialContentDir(): string {
  return process.env.SOCIAL_CONTENT_DIR || '/data/social-content';
}

/** 写到 `${dir}/<比赛>/<平台>/`(best-effort,失败不抛)。 */
export async function writeSocialBundle(facts: SocialFacts, spec: PlatformSpec, files: SocialFile[]): Promise<{ dir: string; archived: boolean }> {
  const dir = `${socialContentDir()}/${matchFolderName(facts)}/${spec.name}`;
  try {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(files.map((f) => fs.writeFile(`${dir}/${f.name}`, f.content, 'utf8')));
    return { dir, archived: true };
  } catch (e) {
    console.warn(`[social:${spec.id}] write fail:`, (e as Error).message);
    return { dir, archived: false };
  }
}

// ============ 企微通知 ============

/**
 * 企微通知——**极简、只放可直接复制的发帖块**(标题+正文+标签)。
 * 配图已由 pushMatchCardImagesToWecom 单独推图片消息,故不再塞链接;封面/文件夹路径对手机发帖无用,不放。
 * 其余版本只用一行小尾巴提一下(在文件夹)。落盘失败才显示路径。
 */
export function buildSocialAlert(spec: PlatformSpec, bundle: SocialBundle, dir: string, archived: boolean): AlertPayload {
  const primary = bundle.notes[0]!;
  const others = bundle.notes.slice(1);
  const lines = [
    `【标题】${primary.title}`,
    '',
    primary.body, // 已含结尾关注话术
    '',
    primary.tags.join(' '),
  ];
  if (primary.firstComment) lines.push('', `【建议首评】${primary.firstComment}`);
  if (others.length) lines.push('', `— 另有 ${others.length} 条(${others.map((n) => n.label).join(' / ')})在文件夹,图见上方`);
  if (!archived) lines.push('', `⚠️ 文件夹落盘失败:${dir}`);
  return {
    severity: 'P2',
    title: `${spec.id === 'xhs' ? '🍠' : spec.id === 'douyin' ? '🎵' : '📺'} ${spec.name} · ${bundle.matchLabel}`,
    body: lines.join('\n'),
    tags: ['social', spec.id],
  };
}

// ============ DB 取数 ============

export interface SocialDb {
  from(table: string): {
    select(cols: string): { eq(col: string, val: string): PromiseLike<{ data: unknown }> };
  };
}

const REPORT_COLS =
  'id,style,title,lead,body,share_quote,match_id,matches(short_code,home_team,away_team,home_score,away_score,competition,match_date,events,stats)';

interface ReportDbRow {
  style: string;
  title: string | null;
  lead: string | null;
  body: string[] | null;
  share_quote: string | null;
  matches: {
    home_team?: string | null;
    away_team?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    competition?: string | null;
    match_date?: string | null;
    events?: Array<{ type?: string | null; player?: string | null; team?: string | null }> | null;
    stats?: { players?: { motm?: { name?: string | null; team?: string | null } | null } | null } | null;
  } | null;
}

/** 取当场球星(MOTM 优先→关键进球者),过滤哨兵名;返回 {name, team}。 */
function pickMatchStar(m: NonNullable<ReportDbRow['matches']>): { name: string; team?: string } | null {
  const bad = (n?: string | null) => !n || n === '未知球员' || n === '球星';
  const motm = m.stats?.players?.motm;
  if (motm && !bad(motm.name)) return { name: motm.name!, team: motm.team ?? undefined };
  const goal = Array.isArray(m.events) ? m.events.find((e) => (e?.type === 'goal' || e?.type === 'penalty') && !bad(e?.player)) : undefined;
  if (goal) return { name: goal.player!, team: goal.team ?? undefined };
  return null;
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://qiuhoushuo.com').replace(/\/$/, '');
}

export async function loadSocialFactsFromDb(db: SocialDb, matchId: string): Promise<SocialFacts | null> {
  const { data } = await db.from('reports').select(REPORT_COLS).eq('match_id', matchId);
  const rows = (data ?? []) as unknown as ReportDbRow[];
  const first = rows[0];
  if (!first) return null;
  const m = first.matches ?? {};
  const home = translateTeam(m.home_team ?? '') || (m.home_team ?? '主队');
  const away = translateTeam(m.away_team ?? '') || (m.away_team ?? '客队');
  const score = `${m.home_score ?? 0}:${m.away_score ?? 0}`;
  const reports: SocialFacts['reports'] = {};
  for (const r of rows) {
    if (r.style === 'hardcore' || r.style === 'duanzi' || r.style === 'emotion') {
      reports[r.style] = { title: r.title ?? '', shareQuote: r.share_quote ?? '', lead: r.lead ?? '', body: r.body ?? [] };
    }
  }
  const date = (m.match_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const b = baseUrl();
  const starPick = pickMatchStar(m);
  return {
    matchId, date, home, away, score,
    matchLabel: `${home} ${score} ${away}`,
    competition: sanitizeCompetition(m.competition ?? '') || '国际大赛',
    reports,
    briefCardUrl: `${b}/api/card/${matchId}?style=duanzi&platform=xhs&variant=brief`,
    ratingsCardUrl: `${b}/api/card/${matchId}?style=duanzi&platform=xhs&variant=ratings`,
    star: starPick?.name,
    starTeam: starPick?.team ? translateTeam(starPick.team) || starPick.team : undefined,
  };
}

// ============ 开关 + 编排 ============

export function socialAutoGenEnabled(platform: PlatformId): boolean {
  // 字面量读取(非动态 key)——便于 env-drift 静态扫描识别这三个开关。
  const v =
    platform === 'xhs' ? process.env.XHS_AUTO_GEN
    : platform === 'douyin' ? process.env.DOUYIN_AUTO_GEN
    : process.env.CHANNELS_AUTO_GEN;
  return v === '1' || v === 'true';
}

export interface SocialGenResult {
  bundle: SocialBundle;
  dir: string;
  archived: boolean;
}

/** facts → 生成 → 落盘(单平台)。 */
export async function generateSocialFromFacts(
  facts: SocialFacts,
  platform: PlatformId,
  deps: { llm?: SocialLLMFn } = {},
): Promise<SocialGenResult> {
  const spec = PLATFORMS[platform];
  const bundle = await generateSocialBundle(facts, spec, deps);
  const files = renderSocialMarkdown(spec, bundle);
  const { dir, archived } = await writeSocialBundle(facts, spec, files);
  return { bundle, dir, archived };
}

/** 一步到位:取数 → 生成 → 落盘(单平台)。无战报 → null。 */
export async function generateSocialForMatch(
  db: SocialDb,
  matchId: string,
  platform: PlatformId,
  deps: { llm?: SocialLLMFn } = {},
): Promise<SocialGenResult | null> {
  const facts = await loadSocialFactsFromDb(db, matchId);
  if (!facts) return null;
  return generateSocialFromFacts(facts, platform, deps);
}

// ============ 企微推图(B:手机长按存图,免点链接) ============

/** 企微群机器人图片上限(base64 前原图)= 2MB。本模块仅 Node 路由/cron 引用(用 Buffer+node:crypto),不进 Edge。 */
const WECOM_IMAGE_MAX = 2 * 1024 * 1024;
const WECOM_IMAGE_TIMEOUT_MS = 5_000;

/**
 * 给企微群机器人推一张**图片消息**(手机长按即存)——把"一图看懂/数据卡"直接送到运营手上,免去点链接存图。
 * best-effort:无 webhook / 超 2MB / 网络失败都静默跳过(只 console.warn),永不抛。
 */
export async function sendWecomImage(bytes: Buffer): Promise<void> {
  const url = process.env.WECOM_BOT_WEBHOOK;
  if (!url) return;
  let payload = bytes;
  if (payload.length > WECOM_IMAGE_MAX) {
    // 卡 PNG 一般 <2MB;豆包写真/合影 ~7MB 超限 → ffmpeg 压到 2MB 内再推(压不下才跳过)
    const shrunk = await shrinkImageForWecom(payload, WECOM_IMAGE_MAX).catch(() => null);
    if (!shrunk) {
      console.warn(`[social] 企微图超 2MB(${bytes.length})且压缩失败,跳过推图`);
      return;
    }
    payload = shrunk;
  }
  const md5 = createHash('md5').update(payload).digest('hex');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WECOM_IMAGE_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'image', image: { base64: payload.toString('base64'), md5 } }),
      signal: ctrl.signal,
    });
  } catch (e) {
    console.warn('[social] 企微推图失败:', (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/** 取本场分享卡 PNG 字节。走 127.0.0.1 inline(容器内可达,避开 CDN hairpin,与 mp-draft 同策略)。失败→null。 */
async function fetchCardBytes(matchId: string, variant: 'brief' | 'ratings'): Promise<Buffer | null> {
  try {
    const res = await fetch(`http://127.0.0.1:3000/api/card/${matchId}?style=duanzi&platform=xhs&variant=${variant}&inline=1`);
    if (!res.ok) return null; // 无 players → ratings 404,正常跳过
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * 把本场「一图看懂」+「数据卡」作为**图片消息**推到企微(手机长按即存,免点链接)。
 * 卡是比赛级(各平台共用),故按场推一次即可——cron 在平台循环外调、手动端点各自调。best-effort,永不抛。
 */
export async function pushMatchCardImagesToWecom(matchId: string): Promise<void> {
  for (const variant of ['brief', 'ratings'] as const) {
    const bytes = await fetchCardBytes(matchId, variant);
    if (bytes) await sendWecomImage(bytes);
  }
}

// ===== 球迷形象示例图(虚构·文生图·watermark恒开)推企微·引流素材 =====

/** 独立门控:社媒球迷形象示例图(与公众号草稿 MP_DRAFT_FAN_PORTRAIT 解耦·可单独 kill)。 */
export function socialFanPortraitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SOCIAL_FAN_PORTRAIT === '1' || env.SOCIAL_FAN_PORTRAIT === 'true';
}

/**
 * 把本场主/客队「球迷形象示例图」(虚构球队队服半写真·豆包文生图·watermark恒开·不像真人/SFW/禁队徽)
 * 推到企微,供运营配「微信搜超帧球后说自己试」文案外发引流。
 * 复用 fan-portrait per-match 缓存(若公众号草稿已生成则零增量成本);门控 SOCIAL_FAN_PORTRAIT;best-effort 永不抛。
 */
export async function pushFanPortraitSamplesToWecom(facts: SocialFacts): Promise<void> {
  if (!socialFanPortraitEnabled()) return;
  let provider;
  try {
    provider = createFanPortraitProviderFromEnv();
  } catch {
    return; // provider/凭证缺失 → 不推图,不拖垮
  }
  const storage = getCardStorage();
  for (const [side, team] of [['home', facts.home], ['away', facts.away]] as const) {
    const bytes = await ensureFanPortraitBytes({ matchId: facts.matchId, side, team }, { provider, storage }).catch(() => null);
    if (bytes) await sendWecomImage(bytes); // 单侧失败也照推另一侧
  }
}

// ===== 球星合影引流图(costar·founder 2026-06-29 拍板·满护栏·肖像权风险见 memory project_costar_real_celebrity_redline)=====

/** 独立门控:社媒 costar 球星合影引流图(默认关·founder 拍板才开)。 */
export function socialCostarShowcaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SOCIAL_COSTAR_SHOWCASE === '1' || env.SOCIAL_COSTAR_SHOWCASE === 'true';
}

/** 「和球星同框」引流文案行(门控同 showcase·含 AI合成披露);关→空数组(不插)。showcase 门关掉=文案+图一起停。 */
function costarHookLines(): string[] {
  return socialCostarShowcaseEnabled()
    ? ['🌟 还能和本场球星「AI 同框」(AI 合成·非真实合影·非本人),微信搜「超帧球后说」自己试~']
    : [];
}

/**
 * 「球迷 + 当场球星」AI 合影引流图推企微(founder 拍板·主要引流作用)。
 * 护栏(降低肖像权/深合暴露):① 恒「AI生成」水印 + AIGC 隐式元数据(generateFanAvatar 内置);
 *   ② 脱商标/禁队徽(buildCostarPrompt 内置);③ 配文必带「AI合成·非真实合影·非本人」披露(D 文案);
 *   ④ 用本场真实球星(MOTM→进球者·facts.star)。
 * 双门控:SOCIAL_COSTAR_SHOWCASE(本特性开关)+ feature.fan_avatar_costar(舆情 kill·feature-flag.sh off 即停)。
 * 无脸场景:用本场虚构球迷形象(home 队·已缓存)当输入脸,costar 按 prompt 重绘到球星队队服。best-effort 永不抛。
 */
export async function pushCostarShowcaseToWecom(facts: SocialFacts): Promise<void> {
  if (!socialCostarShowcaseEnabled()) return;
  if (!facts.star) return; // 无当场球星 → 跳过
  if (!isFeatureEnabled('feature.fan_avatar_costar', { openid: 'social-showcase' })) return; // 舆情 kill 共用
  const storage = getCardStorage();
  let portraitProvider;
  let avatarProvider;
  try {
    portraitProvider = createFanPortraitProviderFromEnv();
    avatarProvider = createFanAvatarProviderFromEnv();
  } catch {
    return;
  }
  // 虚构球迷形象当"自拍"输入脸(社媒无真实用户脸);costar 按 team 重绘队服,facts.star 合影对象
  const selfie = await ensureFanPortraitBytes({ matchId: facts.matchId, side: 'home', team: facts.home }, { provider: portraitProvider, storage }).catch(() => null);
  if (!selfie) return;
  try {
    const result = await generateFanAvatar(
      { openid: `social-showcase:${facts.matchId}`, team: facts.starTeam || facts.home, selfie, selfieContentType: 'image/jpeg', mode: 'costar', star: facts.star },
      { provider: avatarProvider, storage, requestId: `costar-showcase-${facts.matchId}` },
    );
    const bytes = await storage.getBytes?.(result.key);
    if (bytes) await sendWecomImage(bytes);
  } catch (e) {
    console.warn('[social] costar showcase fail:', (e as Error).message);
  }
}

// ============ 平台 spec ============

// ---- 小红书(图文·女性破圈·站外) ----
// 关注转化层(GROWTH-ROOTCAUSE-PLAN-2026-07-08 §3):S2 追更承诺 CTA / S4 金靴口径+「少赛」护栏 / S5 球后锐评 / S3 建议首评 / S7 赛后留存兜底。

/** 大赛决赛日(2026 国际大赛)——追更承诺的锚点:比赛日距它 N≥1 天出「最后N天」;决赛当天/之后走赛后留存承诺(S7)。 */
export const WORLD_CUP_FINAL_DATE = '2026-07-19';

/** 比赛日期(YYYY-MM-DD)距决赛的整天数;日期非法 → NaN(调用方按 <1 走留存兜底)。 */
export function daysUntilFinal(date: string): number {
  const d = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const f = Date.parse(`${WORLD_CUP_FINAL_DATE}T00:00:00Z`);
  return Math.round((f - d) / 86_400_000);
}

const XHS_CTA_LEAD = '📍 想自己整一套/看战报的,微信搜小程序「超帧球后说」就能玩~';
/** 决赛当天/之后的留存承诺(S7),兼作 followCta 静态兜底:赛事结束也有关注理由。 */
const XHS_CTA_EVERGREEN = `${XHS_CTA_LEAD}关注看五大联赛/欧冠 AI 球评,不断更!`;

/** 追更承诺 CTA(S2):写死进每篇正文结尾(ensureCta 强制,不靠 LLM 自觉),N 按比赛日期动态算。 */
export function xhsFollowCta(date: string): string {
  const n = daysUntilFinal(date);
  return n >= 1
    ? `${XHS_CTA_LEAD}关注我,大赛最后${n}天每场赛后更:AI评分、金靴榜、决赛路径!`
    : XHS_CTA_EVERGREEN;
}

/** 建议首评(S3):发布后立即自评论的追更钩子;决赛后切留存版。 */
export function xhsFirstComment(date: string): string {
  return daysUntilFinal(date) >= 1
    ? '金靴榜每天更,谁反超评论区揭晓,关注不迷路📌'
    : '五大联赛/欧冠 AI 球评不断更,关注不迷路📌';
}

/** 金靴/射手榜口径(S4):文案命中即自动附口径标注(postProcess);幂等,已有标注不重复附。 */
const GOLDEN_BOOT_RE = /金靴|射手榜/;
export const GOLDEN_BOOT_CALIBER_NOTE = '⚖️ 金靴/射手数据已按同场次口径核对';
/** 「少赛」系全部变体(少赛/少踢/少打/少赛紧追…)——此坑两次被网友当场纠错,代码层护栏:命中即整条回退干净模板。 */
export const XHS_GOLDEN_BOOT_FORBIDDEN: RegExp[] = [/少[赛踢打]/];

const XHS_SPEC: PlatformSpec = {
  id: 'xhs',
  name: '小红书',
  followCta: XHS_CTA_EVERGREEN,
  followCtaFor: (facts) => xhsFollowCta(facts.date),
  forbidden: [...STATION_OUT_FORBIDDEN, ...XHS_GOLDEN_BOOT_FORBIDDEN],
  llmKinds: ['yitukandong', 'duanzi', 'qingxu'],
  kindLabel: { yitukandong: '一图看懂', duanzi: '段子玩梗', qingxu: '追剧情绪', xiezhen: '球迷写真' },
  kindTime: {
    yitukandong: '赛后 1 小时内 / 次日早 7:30–8:30',
    duanzi: '午 12:30 或晚高峰 19:00',
    qingxu: '开赛前 18:30 或赛后情绪峰值',
    xiezhen: '晚 20:00–21:00',
  },
  imagesFor(kind, facts) {
    if (kind === 'yitukandong') return [`「一图看懂」3:4 卡(首图·比分区半遮留钩子):${facts.briefCardUrl}`, `数据卡:${facts.ratingsCardUrl}`];
    if (kind === 'xiezhen') return ['球迷写真成片(侧脸/半遮脸·带「AI生成」角标):自助生成后存图'];
    return [`可配「一图看懂」卡:${facts.briefCardUrl}`];
  },
  systemPrompt: [
    '你是「超帧球后说」的小红书运营,把真实比赛 AI 战报改写成小红书笔记。定位「会看球的女生·球迷写真 plog」,看球小白友好。',
    '红线(违一条即废):1)正文/标题绝不出现 二维码/小程序码/扫码/加微信/任何外链(可以写"微信搜超帧球后说"做搜索引导);2)结尾关注话术只用我给的那句;',
    '3)不写赛事官方名,用我给的中文叫法,标签必含 #国际大赛;4)不写极限词(「最强/第一/绝对/必胜/史上」这类都不要),AI 图标「AI生成」;语气姐妹体,分点,结尾强互动+强收藏。',
    '5)涉及金靴榜/射手榜时:**严禁**出现「少赛」「少踢」「少赛紧追」等场次差字样(此前两次被网友当场纠错),场次口径只写「已按同场次口径核对」。',
    '人设(每篇必做):正文靠前位置(前三行内)放一句第一人称「球后锐评」——签名式观点,比如谁被高估/谁该背锅/谁的评分最冤,口吻犀利但克制,不人身攻击不带脏话。',
  ].join('\n'),
  kindBrief: {
    yitukandong: '收藏向干货——把本场比分时间线/关键数据/胜负手/该回放的镜头浓缩成"一图看懂",强调"看球不用懂战术,一张图看懂"。封面≤12字+留钩子。',
    duanzi: '老李大叔锐评玩梗版——用接地气段子把本场走势/名场面吐槽一遍(别太当真),引发评论。',
    qingxu: '把比赛当剧追的情绪向——代入感、名场面、领先被扳平/补时绝平的心跳,结尾引导站队。',
  },
  fallbackNote(kind, facts) {
    const { matchLabel, home, away, score, competition } = facts;
    const base = { label: this.kindLabel[kind] ?? kind, suggestTime: this.kindTime[kind] ?? '', images: this.imagesFor(kind, facts) };
    if (kind === 'duanzi') {
      return { ...base, kind, coverTitle: '老李锐评这场', coverSub: '段子版·笑不活了',
        title: `😂段子版!${home}${score}${away}给我笑不活了`,
        body: ensureCta([`谁说看球只能正襟危坐?老李的"段子版战报"才是精髓哈哈哈😂`, `把 ${matchLabel} 用大叔锐评给你扒一遍(玩梗别当真)。`, '看球的快乐一半在球场,一半在赛后吐槽~', '', '🙋 你被哪个瞬间笑到/气到?**评论区甩**,老李在线接梗!', '📌 **收藏**下次搬梗显得你贼懂球😎'].join('\n'), xhsFollowCta(facts.date)),
        tags: ['#国际大赛', '#足球段子', '#看球', '#女生看球', '#玩梗', '#看球小白', '#足球'] };
    }
    if (kind === 'qingxu') {
      return { ...base, kind, coverTitle: '看球哪有不哭的', coverSub: `${matchLabel}·建议带纸巾`,
        title: `把球赛当剧追是什么神仙体验😭${home}对${away}`,
        body: ensureCta(['把足球大赛当电视剧追,比追任何剧都上头😭', `这场 ${matchLabel}(${competition})剧情起伏直接看破防。`, '看球不用懂规则,当成"不知道结局的爽剧",跟着喊跟着哭就够了!', '', '🙋 你站哪队?**评论区立 flag**,赛后对线!', '📌 **收藏**当观赛指南,赛后蹲我战报~'].join('\n'), xhsFollowCta(facts.date)),
        tags: ['#国际大赛', '#女生看球', '#看球攻略', '#追剧', '#情绪', '#足球', '#看球小白'] };
    }
    return { ...base, kind, coverTitle: '看球5分钟 懂一整场', coverSub: `${matchLabel}·一张图说明白`,
      title: `看球小白必存📌一图看懂${home}${score}${away}`,
      body: ensureCta([`姐妹们!${competition}这场 ${matchLabel},没看的别急,我把整场浓缩成一张图👇`, '✅比分+关键时间线 ✅控球/射正硬数据 ✅赢在哪一脚(大白话) ✅最该回放的镜头', '看球真不用懂越位懂阵型,有这张图第二天吹牛绰绰有余👌', '', '📌 记得**收藏**,今晚有球拿出来对着看~', '🙋 评论区扣:你押哪队赢了?'].join('\n'), xhsFollowCta(facts.date)),
      tags: ['#国际大赛', '#看球攻略', '#一图看懂', '#女生看球', '#足球数据', '#看球小白', '#足球'] };
  },
  extraNotes(facts) {
    const { home, away } = facts;
    return [{
      kind: 'xiezhen', label: '球迷写真', suggestTime: this.kindTime.xiezhen!, images: this.imagesFor('xiezhen', facts),
      coverTitle: '10秒 自拍变球迷写真', coverSub: `你支持${home}还是${away}?`,
      title: `自拍10秒变球迷写真🔥你支持${home}还是${away}`,
      body: ensureCta(['家人们谁懂啊!看球季最出片的方式被我找到了😭', `传一张自拍,10 秒生成"穿支持球队队服的半写真",${home}、${away} 随便切,每套都出片!(成图都是 **AI生成**)`, '📸 不用露全脸 社恐友好｜👕 想穿哪队穿哪队｜💛 免费', ...costarHookLines(), '', `🙋 **你支持哪队?评论区报到**,呼声高的队我下条出合集!`, '📌 先**收藏**照着切队服~'].join('\n'), xhsFollowCta(facts.date)),
      tags: ['#国际大赛', '#AI写真', '#球迷穿搭', '#女生看球', '#出片', '#自拍', '#球迷'],
    }];
  },
  /** 关注转化后处理:①金靴/射手榜文案自动附口径标注(S4·幂等);②每条带建议首评(S3)。LLM/兜底/extra 三路统一过。 */
  postProcess(note, facts) {
    const cta = xhsFollowCta(facts.date);
    let body = note.body;
    // 剔除 CTA 再扫描——追更 CTA 自带「金靴榜」字样,不能让它误触发口径标注
    const stripped = body.replace(cta, '').trimEnd();
    const scan = `${note.coverTitle}\n${note.coverSub}\n${note.title}\n${stripped}`;
    if (GOLDEN_BOOT_RE.test(scan) && !stripped.includes('已按同场次口径核对')) {
      body = ensureCta(`${stripped}\n\n${GOLDEN_BOOT_CALIBER_NOTE}`, cta);
    }
    return { ...note, body, firstComment: xhsFirstComment(facts.date) };
  },
};

// ---- 抖音(短视频·完播优先·站外) ----
const DY_CTA = '👀 想自己玩的微信搜「超帧球后说」小程序,关注我每场都更——别划走!';
const DOUYIN_SPEC: PlatformSpec = {
  id: 'douyin',
  name: '抖音',
  followCta: DY_CTA,
  forbidden: STATION_OUT_FORBIDDEN,
  llmKinds: ['kadian', 'jieshuo'],
  kindLabel: { kadian: '一图看懂卡点视频', jieshuo: '段子解说', xiezhen: '球迷写真过程视频' },
  kindTime: { kadian: '赛后 1-2 小时(蹭热)', jieshuo: '晚高峰 19:00-22:00', xiezhen: '晚 20:00-22:00' },
  imagesFor(kind, facts) {
    if (kind === 'kadian') return [`轮播素材:「一图看懂」卡 ${facts.briefCardUrl} + 数据卡 ${facts.ratingsCardUrl}(分屏切)`];
    if (kind === 'xiezhen') return ['球迷写真过程录屏 / 图生视频运镜素材(带「AI生成」标)'];
    return [`画面素材:「一图看懂」卡 ${facts.briefCardUrl}`];
  },
  systemPrompt: [
    '你是「超帧球后说」的抖音短视频编导,把真实比赛战报改写成**可直接拍/剪的短视频脚本**。完播优先,前 3 秒必须有钩子。',
    '红线:1)口播/字幕/文案绝不出现 二维码/小程序码/扫码/加微信/外链(可以写"微信搜超帧球后说"做搜索引导);2)结尾关注话术只用我给的那句;',
    '3)不写赛事官方名,用我给的中文叫法,话题标签含 #国际大赛;4)不写极限词,AI 画面标「AI生成」。',
    'body 必须是**分镜脚本**:逐条「[0-3s 画面+口播] / [3-8s …] / …」,标明画面(用一图看懂卡/数据卡/写真)+ 口播逐句 + 建议 BGM 类型(卡点/燃/搞笑,不点歌名)。',
  ].join('\n'),
  kindBrief: {
    kadian: '一图看懂卡点(干货吃搜索):前 3 秒抛悬念"这场只看一张图",再把比分时间线/关键数据/胜负手卡点切过;BGM 燃/卡点。',
    jieshuo: '老李大叔伪解说玩梗(AI 配音口播):本场走势 + 名场面段子化吐槽,引导评论;BGM 搞笑/卡点。',
  },
  fallbackNote(kind, facts) {
    const { matchLabel, home, away, score } = facts;
    const base = { label: this.kindLabel[kind] ?? kind, suggestTime: this.kindTime[kind] ?? '', images: this.imagesFor(kind, facts) };
    if (kind === 'jieshuo') {
      return { ...base, kind, coverTitle: '老李锐评这场', coverSub: '段子解说',
        title: `${home}${score}${away}!老李大叔锐评笑不活了😂 #国际大赛 #足球`,
        body: ensureCta(['[0-3s] 首帧大字"老李锐评" + 老李口播:"就这场 ' + matchLabel + ',我必须唠两句"(BGM:搞笑卡点)', '[3-15s] 一图看懂卡逐块划过 + 段子口播玩梗(别当真)', '[15-25s] 抛名场面吐槽 + 引导互动', '', '结尾口播引导:点赞关注,下场接着唠~'].join('\n'), DY_CTA),
        tags: ['#国际大赛', '#足球', '#足球解说', '#看球', '#段子', '#玩梗', '#看球小白'] };
    }
    return { ...base, kind, coverTitle: '这场只看一张图', coverSub: `${matchLabel}`,
      title: `错过${home}${score}${away}?一个视频看懂全场 #国际大赛 #看球攻略`,
      body: ensureCta([`[0-3s] 首帧大字"${matchLabel} 只看一张图" + 口播抛悬念"没看的别划走"(BGM:燃/卡点)`, '[3-12s] 一图看懂卡分块卡点切:比分时间线→关键数据→胜负手', '[12-20s] 数据卡补"该回放的镜头" + 口播"看球不用懂战术"', '[20-25s] 引导互动:你押哪队赢?', '', '结尾口播:看球小白记得关注,每场都给你一图看懂~'].join('\n'), DY_CTA),
      tags: ['#国际大赛', '#看球攻略', '#一图看懂', '#足球', '#足球数据', '#看球小白'] };
  },
  extraNotes(facts) {
    const { home, away } = facts;
    return [{
      kind: 'xiezhen', label: '球迷写真过程视频', suggestTime: this.kindTime.xiezhen!, images: this.imagesFor('xiezhen', facts),
      coverTitle: '自拍10秒变球迷写真', coverSub: `${home} or ${away}?`,
      title: `自拍10秒生成球迷写真🔥${home}还是${away}站队 #国际大赛 #AI写真`,
      body: ensureCta(['[0-3s] 首帧:普通自拍 →(转场)球队队服写真,大字"10秒变身"(BGM:变身卡点)', `[3-12s] 录屏/图生视频展示切不同队队服 ${home}/${away}(画面标「AI生成」)`, '[12-20s] 口播:不用露全脸、免费、社恐友好', '[20-25s] 引导:你支持哪队?评论区站队', ...costarHookLines(), '', '结尾口播:想自己整的微信搜「超帧球后说」就能玩~'].join('\n'), DY_CTA),
      tags: ['#国际大赛', '#AI写真', '#球迷', '#变身', '#出片', '#看球', '#足球'],
    }];
  },
};

// ---- 视频号(短视频·微信站内·可导流小程序/公众号) ----
const CH_CTA = '👇 关注本视频号 + 点赞,点下方小程序「超帧球后说」看完整战报,每场都有!';
const CHANNELS_SPEC: PlatformSpec = {
  id: 'channels',
  name: '视频号',
  followCta: CH_CTA,
  forbidden: CHANNELS_FORBIDDEN,
  llmKinds: ['jieshuo', 'qingxu'],
  kindLabel: { jieshuo: '一图看懂解说', qingxu: '情绪共鸣向', xiezhen: '球迷写真过程视频' },
  kindTime: { jieshuo: '赛后 1-2 小时 / 早通勤 7-9 点', qingxu: '晚 20:00-22:30(中老年活跃)', xiezhen: '晚 20:00-22:00' },
  imagesFor(kind, facts) {
    if (kind === 'jieshuo') return [`画面素材:「一图看懂」卡 ${facts.briefCardUrl} + 数据卡 ${facts.ratingsCardUrl}`];
    if (kind === 'xiezhen') return ['球迷写真过程录屏 / 图生视频(带「AI生成」标)'];
    return [`画面素材:「一图看懂」卡 ${facts.briefCardUrl}`];
  },
  systemPrompt: [
    '你是「超帧球后说」的微信视频号编导,把真实比赛战报改写成**短视频脚本**。视频号用户偏成熟、重信任与情感共鸣,语速稳、讲清楚。',
    '允许提及小程序/公众号(微信生态内导流合规),但**禁止出现 抖音/快手/小红书/微博 等外部平台名与任何外部链接**。',
    '红线:不写赛事官方名(用我给的中文叫法,标签含 #国际大赛);不写极限词;AI 画面标「AI生成」;结尾关注话术只用我给的那句。',
    'body 必须是**分镜脚本**:逐条「[0-3s 画面+口播] / …」,画面用一图看懂卡/数据卡,口播逐句、稳重清楚 + BGM 类型。',
  ].join('\n'),
  kindBrief: {
    jieshuo: '一图看懂解说——把这一场讲明白(适合转给家人朋友):比分时间线/关键数据/赢在哪,口播稳重清楚。',
    qingxu: '情绪共鸣向——看球的热血与遗憾娓娓道来,引发评论(你看的时候什么心情)。',
  },
  fallbackNote(kind, facts) {
    const { matchLabel, home, away, score, competition } = facts;
    const base = { label: this.kindLabel[kind] ?? kind, suggestTime: this.kindTime[kind] ?? '', images: this.imagesFor(kind, facts) };
    if (kind === 'qingxu') {
      return { ...base, kind, coverTitle: '这场看得我不平静', coverSub: `${matchLabel}`,
        title: `${matchLabel}:这场球,看懂的人都懂`,
        body: ensureCta([`[0-3s] 首帧大字"${matchLabel}" + 口播"这场球,值得说道说道"(BGM:情绪/燃)`, `[3-18s] 一图看懂卡讲走势 + 口播把 ${competition} 这场的热血与遗憾娓娓道来`, '[18-28s] 抛共鸣:你看的时候什么心情?', '', '结尾口播:喜欢看球的朋友,关注一下,每场都给你讲明白~'].join('\n'), CH_CTA),
        tags: ['#国际大赛', '#足球', '#看球', '#球迷', '#情绪', '#体育', '#足球解说'] };
    }
    return { ...base, kind, coverTitle: '一张图看懂这场', coverSub: `${matchLabel}`,
      title: `${home}${score}${away}:这一场,一张图给你讲明白`,
      body: ensureCta([`[0-3s] 首帧大字"${matchLabel} 一图看懂" + 口播"没看直播的别急"(BGM:稳/燃)`, '[3-16s] 一图看懂卡分块讲:比分时间线→关键数据→赢在哪', '[16-26s] 数据卡补该回放的镜头 + 口播"看球不用懂术语"', '', '结尾口播:转给也爱看球的家人朋友,关注我每场都讲~'].join('\n'), CH_CTA),
      tags: ['#国际大赛', '#看球攻略', '#一图看懂', '#足球', '#足球数据', '#体育'] };
  },
  extraNotes(facts) {
    const { home, away } = facts;
    return [{
      kind: 'xiezhen', label: '球迷写真过程视频', suggestTime: this.kindTime.xiezhen!, images: this.imagesFor('xiezhen', facts),
      coverTitle: '自拍变球迷写真', coverSub: `${home} or ${away}`,
      title: `传张自拍就能生成你的球队写真(${home}/${away}都能切)`,
      body: ensureCta(['[0-3s] 首帧:自拍 →(转场)球队队服写真,大字"10秒变身"(BGM:轻快)', `[3-14s] 展示切 ${home}/${away} 不同队服(画面标「AI生成」)`, '[14-24s] 口播:不用露全脸、免费、操作简单', ...costarHookLines(), '', '结尾口播:想给自己整一套的,点下方小程序「超帧球后说」就能玩~'].join('\n'), CH_CTA),
      tags: ['#国际大赛', '#AI写真', '#球迷', '#出片', '#看球', '#足球', '#体育'],
    }];
  },
};

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  xhs: XHS_SPEC,
  douyin: DOUYIN_SPEC,
  channels: CHANNELS_SPEC,
};
