/**
 * 一键把战报推成「服务号(公众号)图文草稿」。运营在公众号后台「草稿箱」即得排好的图文,改两下直接发。
 *
 * 为什么要这套:公众号图文编辑器有防盗链——正文 <img> 只认微信自家素材(mmbiz.qpic.cn),
 * 外链(qiuhoushuo.com)图片会被丢。故本模块把战报图片先传成微信素材再拼进正文:
 *   - 正文内图:cgi-bin/media/uploadimg → 返回可用 url(不占素材库、无数量限制)
 *   - 封面图(thumb,draft/add 必填):cgi-bin/material/add_material?type=image → 返回 media_id
 *   - 建草稿:cgi-bin/draft/add → 返回草稿 media_id
 *
 * access_token 走服务号 cgi-bin/token(WXPAY_SERVICE_APPID/SECRET),需服务器出口 IP 在【服务号】后台
 * IP 白名单(与小程序那套是两份;缺则 40164)。
 */

import { MP_QR_BADGE_PNG } from '@/lib/api/mp-qr-badge';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const UPLOADIMG_URL = 'https://api.weixin.qq.com/cgi-bin/media/uploadimg';
const ADD_MATERIAL_URL = 'https://api.weixin.qq.com/cgi-bin/material/add_material';
const ADD_DRAFT_URL = 'https://api.weixin.qq.com/cgi-bin/draft/add';

export interface ArticleInput {
  title: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  competition: string;
  lead: string;
  body: string[];
  shareQuote: string;
  shortCode: string; // 阅读引导链接 qiuhoushuo.com/m/<shortCode>
}

let cachedToken: { token: string; exp: number } | null = null;
export function __resetMpTokenForTests(): void { cachedToken = null; }

/** 服务号全局 access_token(client_credential),模块级缓存(微信 7200s,留 5min 余量)。40164=IP 未白名单。 */
export async function getMpToken(fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<string | null> {
  if (cachedToken && cachedToken.exp > now + 300_000) return cachedToken.token;
  const appid = process.env.WXPAY_SERVICE_APPID;
  const secret = process.env.WXPAY_SERVICE_SECRET;
  if (!appid || !secret) return null;
  try {
    const res = await fetchImpl(`${TOKEN_URL}?grant_type=client_credential&appid=${appid}&secret=${secret}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!data.access_token) {
      console.warn('[mp-draft] token fail:', data.errcode, data.errmsg); // 40164=服务号 IP 未白名单
      return null;
    }
    cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 7200) * 1000 };
    return cachedToken.token;
  } catch (e) {
    console.warn('[mp-draft] token throw:', (e as Error).message);
    return null;
  }
}

function imageForm(bytes: Buffer, filename = 'card.png'): FormData {
  const fd = new FormData();
  fd.append('media', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), filename);
  return fd;
}

/** 正文内图:返回可直接放进图文 content 的 <img src> url(mmbiz.qpic.cn)。失败 null。 */
export async function uploadContentImage(token: string, bytes: Buffer, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${UPLOADIMG_URL}?access_token=${token}`, { method: 'POST', body: imageForm(bytes) });
    const data = (await res.json()) as { url?: string; errcode?: number; errmsg?: string };
    if (!data.url) { console.warn('[mp-draft] uploadimg fail:', data.errcode, data.errmsg); return null; }
    return data.url;
  } catch (e) {
    console.warn('[mp-draft] uploadimg throw:', (e as Error).message);
    return null;
  }
}

/** 永久图片素材:返回 media_id(用作图文封面 thumb_media_id)。失败 null。 */
export async function addMaterialImage(token: string, bytes: Buffer, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${ADD_MATERIAL_URL}?access_token=${token}&type=image`, { method: 'POST', body: imageForm(bytes) });
    const data = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    if (!data.media_id) { console.warn('[mp-draft] add_material fail:', data.errcode, data.errmsg); return null; }
    return data.media_id;
  } catch (e) {
    console.warn('[mp-draft] add_material throw:', (e as Error).message);
    return null;
  }
}

export interface DraftArticle {
  title: string;
  author: string;
  digest: string;
  content: string;
  thumb_media_id: string;
}

/** 建图文草稿,返回草稿 media_id。失败 null。 */
export async function addDraft(token: string, article: DraftArticle, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${ADD_DRAFT_URL}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // need_open_comment 等可按需;正文已含 AI 标识,作者署名固定。
      body: JSON.stringify({ articles: [{ ...article, content_source_url: '' }] }),
    });
    const data = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    if (!data.media_id) { console.warn('[mp-draft] draft/add fail:', data.errcode, data.errmsg); return null; }
    return data.media_id;
  } catch (e) {
    console.warn('[mp-draft] draft/add throw:', (e as Error).message);
    return null;
  }
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 文章内小程序 CTA 配置。流量来源 7 成是搜一搜陌生人,文内不给小程序入口=读完即走,
 * 这里把搜索流量接进小程序(转化在小程序侧看 scene 1058 + E007 source=mparticle)。
 * MP_DRAFT_WEAPP_CTA:空/1=全开(文字链+可点小程序码);qr=只留码(data-miniprogram 链接需服务号
 * 已关联小程序,未关联时 draft/add 报 45166——码是纯图片不受影响,此档为逃生);0=全关。
 * ⚠️`<mp-miniprogram>` 卡片标签 draft/add API **不收**(45166,仅后台编辑器支持,2026-07-02 生产实测),
 * 卡片形态用「图片式链接」(<a data-miniprogram><img></a>,实测可过)实现:码图点击即跳、长按可识别。
 */
export function resolveWeappCta(): { appid: string | null; qr: boolean } {
  const mode = process.env.MP_DRAFT_WEAPP_CTA;
  if (mode === '0') return { appid: null, qr: false };
  const appid = process.env.WX_APPID || process.env.WXPAY_MINI_APPID || null;
  if (mode === 'qr') return { appid: null, qr: true };
  return { appid, qr: !!appid };
}

/** 小程序 CTA 段:完整战报/球迷形象两条文字链 + 小程序码(有 appid 时码图包成小程序图片链接,点图跳本场战报;长按仍可识别)。 */
function buildWeappCtaHtml(input: ArticleInput, qrImgUrl?: string): string {
  if (process.env.MP_DRAFT_WEAPP_CTA === '0') return ''; // 总闸:调用方即便传了码 url 也不渲染
  const { appid } = resolveWeappCta();
  const parts: string[] = [];
  const reportPath = esc(`pages/report-detail/index?shortCode=${input.shortCode}&from=mparticle`);
  if (appid) {
    const avatarPath = esc('pages/fan-avatar/index?from=mparticle');
    const link = (path: string, text: string) =>
      `<p style="margin:0 0 12px;line-height:1.75;font-size:16px;"><a data-miniprogram-appid="${esc(appid)}" data-miniprogram-path="${path}" href="">${esc(text)}</a></p>`;
    parts.push(link(reportPath, '看这场的完整战报、球员评分和战术卡 →'));
    parts.push(link(avatarPath, '上传自拍,10 秒生成你的球迷形象(免费)→'));
  }
  if (qrImgUrl) {
    const img = `<img src="${qrImgUrl}" style="width:280px;max-width:60%;"/>`;
    const linked = appid
      ? `<a data-miniprogram-appid="${esc(appid)}" data-miniprogram-path="${reportPath}" href="">${img}</a>`
      : img;
    parts.push(`<p style="margin:8px 0 4px;text-align:center;">${linked}</p>`);
    parts.push(`<p style="margin:0 0 16px;text-align:center;font-size:13px;color:#999;">${appid ? '点击图片或长按识别小程序码' : '长按识别小程序码'},看完整战报、整球迷形象</p>`);
  }
  if (!parts.length) return '';
  return `<p style="margin:28px 0 8px;font-weight:700;font-size:16px;color:#111;">📱 进小程序继续看</p>${parts.join('')}`;
}

/** 拼公众号图文正文 HTML:一图看懂(全局视觉:比分/数据/战术/镜头)+ 导语 + 全文 + 战术图 + 金句 + 小程序 CTA(卡片+文字链,MP_DRAFT_WEAPP_CTA 门控)+ 关注引导 + 末尾球迷应援(可选)。
 *  fanPortraitUrls:[主队, 客队] 两张球迷形象 mmbiz url(克制版半写真,AI 生成);仅 all 手动路径附带,缺则不渲染。 */
export function buildArticleHtml(
  input: ArticleInput,
  briefImgUrl?: string,
  tacticsImgUrl?: string,
  fanPortraitUrls?: Array<string | undefined>,
  ratingsImgUrl?: string,
  qrImgUrl?: string,
): string {
  const P = (t: string) => `<p style="margin:0 0 16px;line-height:1.75;font-size:16px;color:#333;">${esc(t)}</p>`;
  const IMG = (u: string) => `<p style="margin:0 0 16px;text-align:center;"><img src="${u}" style="max-width:100%;"/></p>`;
  const parts: string[] = [];
  if (briefImgUrl) parts.push(IMG(briefImgUrl));
  if (input.lead) parts.push(P(input.lead));
  for (const p of input.body) if (p && p.trim()) parts.push(P(p));
  if (tacticsImgUrl) {
    parts.push(`<p style="margin:24px 0 8px;font-weight:700;font-size:16px;color:#111;">战术图解</p>`);
    parts.push(IMG(tacticsImgUrl));
  }
  if (ratingsImgUrl) {
    parts.push(`<p style="margin:24px 0 8px;font-weight:700;font-size:16px;color:#111;">球员评分</p>`);
    parts.push(IMG(ratingsImgUrl));
  }
  if (input.shareQuote) {
    parts.push(`<p style="margin:24px 0 16px;padding:12px 16px;border-left:4px solid #00b8cc;background:#f5fcfd;line-height:1.75;font-size:16px;color:#0a3a40;">${esc(input.shareQuote)}</p>`);
  }
  // 小程序 CTA:金句后、AI 标识前。搜一搜读者 → 小程序的唯一桥(appid 缺且无码 → 空串,不渲染)。
  const weappCta = buildWeappCtaHtml(input, qrImgUrl);
  if (weappCta) parts.push(weappCta);
  parts.push(`<p style="margin:24px 0 8px;font-size:13px;color:#999;">本文由 AI 生成战报整理 · 完整战报 qiuhoushuo.com/m/${esc(input.shortCode)}</p>`);
  // 末尾:球迷应援(主/客队两张,克制版半写真,AI 生成)。比分写进小标题。
  // 注:保留原索引再跳过空项——不能先 filter,否则单张失败时会把客队图错配成主队 caption。
  const fanList = fanPortraitUrls ?? [];
  if (fanList.some((u) => !!u)) {
    parts.push(`<p style="margin:28px 0 8px;font-weight:700;font-size:16px;color:#111;">🎉 球迷应援 · ${esc(input.homeTeam)} ${input.homeScore}:${input.awayScore} ${esc(input.awayTeam)}</p>`);
    const caps = [input.homeTeam, input.awayTeam];
    fanList.forEach((u, i) => {
      if (!u) return;
      parts.push(IMG(u));
      parts.push(`<p style="margin:0 0 16px;text-align:center;font-size:13px;color:#999;">${esc(caps[i] ?? '')}球迷 · AI 生成</p>`);
    });
  }
  return parts.join('');
}

export interface PushDeps {
  input: ArticleInput;
  briefBytes: Buffer | null;   // 一图看懂(必需:用作封面 + 正文首图)
  tacticsBytes?: Buffer | null; // 战术图(可选,正文内)
  ratingsBytes?: Buffer | null; // 球员评分卡(可选,正文内,战术图之后)
  fanPortraitBytes?: Array<Buffer | null>; // [主队, 客队] 球迷形象(可选,正文末尾;仅 all 路径传)
  fetchImpl?: typeof fetch;
}

/**
 * 编排:取 token → 传图(封面 add_material + 正文 uploadimg)→ 拼正文 → draft/add。
 * briefBytes 缺则报错(封面必需)。任一外部调用失败返回 {ok:false,error}。
 */
export async function pushReportToMpDraft(deps: PushDeps): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const f = deps.fetchImpl ?? fetch;
  if (!deps.briefBytes) return { ok: false, error: 'NO_COVER_IMAGE: 一图看懂 未就绪(先确保该场卡片已渲染/预热)' };
  const token = await getMpToken(f);
  if (!token) return { ok: false, error: 'NO_TOKEN: 服务号 access_token 取不到(检查 WXPAY_SERVICE_* + 服务号 IP 白名单 40164)' };

  const thumbMediaId = await addMaterialImage(token, deps.briefBytes, f);
  if (!thumbMediaId) return { ok: false, error: 'COVER_UPLOAD_FAIL: 封面素材上传失败' };

  const briefUrl = await uploadContentImage(token, deps.briefBytes, f);
  const tacticsUrl = deps.tacticsBytes ? await uploadContentImage(token, deps.tacticsBytes, f) : undefined;
  const ratingsUrl = deps.ratingsBytes ? await uploadContentImage(token, deps.ratingsBytes, f) : undefined;

  // 球迷应援图(可选):逐张上传成 mmbiz url 拼到正文末尾;单张失败仅丢该张,不影响草稿。
  const fanUrls: Array<string | undefined> = [];
  for (const bytes of deps.fanPortraitBytes ?? []) {
    fanUrls.push(bytes ? (await uploadContentImage(token, bytes, f)) ?? undefined : undefined);
  }

  // 小程序码(长按识别引流,MP_DRAFT_WEAPP_CTA 门控):上传失败仅丢码,不影响草稿。
  const qrUrl = resolveWeappCta().qr ? await uploadContentImage(token, MP_QR_BADGE_PNG, f) : null;

  const content = buildArticleHtml(deps.input, briefUrl ?? undefined, tacticsUrl ?? undefined, fanUrls, ratingsUrl ?? undefined, qrUrl ?? undefined);
  const title = deps.input.title || `${deps.input.homeTeam} ${deps.input.homeScore}:${deps.input.awayScore} ${deps.input.awayTeam} · 赛后战报`;
  const digest = (deps.input.shareQuote || deps.input.lead || title).slice(0, 120);
  const draftId = await addDraft(token, { title: title.slice(0, 64), author: '超帧球后说', digest, content, thumb_media_id: thumbMediaId }, f);
  if (!draftId) return { ok: false, error: 'DRAFT_ADD_FAIL: 草稿创建失败' };
  return { ok: true, draftId };
}
