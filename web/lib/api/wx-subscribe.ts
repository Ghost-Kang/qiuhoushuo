/**
 * 微信订阅消息(一次性):开赛前提醒 + 战报就绪提醒。
 * - 用户点「提醒我」→ wx.requestSubscribeMessage(两模板)→ /api/subscribe 记一条订阅(sent_at=null)。
 * - 触发:开赛前 cron(/api/cron/match-reminders)推 match_start;auto-report 出战报后推 report_ready。
 * - 微信「一次订阅一次推送」:推完(成功或被拒)都标 sent_at,不重推(避免刷)。
 * - access_token 走小程序 cgi-bin/token(WX_APPID/WX_SECRET),需服务器出口 IP 在小程序后台白名单(否则 40164)。
 */

import { translateTeam } from '@qhs/share-cards';
import { sanitizeCompetition } from '@/lib/api/match-brief-card';

// 2026-06-15 公众平台选用的模板(字段均 thing,≤20 字)。非密钥,可硬编。
export const TMPL_MATCH_START = 'wB1a91M3bO9fyWDB6DnuqbtuoiEVRTUchqJl4L-wuM8';
export const TMPL_REPORT_READY = '8UaxcxIeZS6LzTh6eSLJo_Y-60AVlzSEpSSLXnVdM-o';

export type SubKind = 'match_start' | 'report_ready';

// 两模板字段同形(thing1/2/3),给具体类型便于调用方直接取字段(免 noUncheckedIndexedAccess 报 undefined)。
export interface MsgData { thing1: { value: string }; thing2: { value: string }; thing3: { value: string }; [key: string]: { value: string } }

interface MatchLike {
  home_team?: string | null;
  away_team?: string | null;
  competition?: string | null;
  match_date?: string | null;
}

interface SubsRow { id: string; openid: string }
export interface SubsDb {
  from(table: 'match_subscriptions'): {
    select(columns: string): {
      eq(column: 'match_id', value: string): {
        eq(column: 'kind', value: SubKind): {
          is(column: 'sent_at', value: null): PromiseLike<{ data: SubsRow[] | null }>;
        };
      };
    };
    update(values: { sent_at: string }): {
      eq(column: 'id', value: string): PromiseLike<{ data: null }>;
    };
  };
}

/** thing 字段:≤20 字;空值会被微信拒收(45xxx),兜 '-'。 */
export function clampThing(s: string | null | undefined): string {
  const v = String(s ?? '').trim();
  if (!v) return '-';
  return v.length > 20 ? `${v.slice(0, 19)}…` : v;
}

function matchName(home?: string | null, away?: string | null): string {
  return clampThing(`${translateTeam(home || '')} vs ${translateTeam(away || '')}`);
}

function kickoffText(matchDate?: string | null): string {
  if (!matchDate) return '即将开始';
  return new Date(matchDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 开赛提醒数据:thing1=比赛名称 / thing2=比赛时间 / thing3=赛事类别 */
export function buildMatchStartData(m: MatchLike): MsgData {
  return {
    thing1: { value: matchName(m.home_team, m.away_team) },
    thing2: { value: clampThing(kickoffText(m.match_date)) },
    thing3: { value: clampThing(sanitizeCompetition(m.competition ?? undefined) || '国际大赛') },
  };
}

/** 战报就绪数据:thing1=活动内容(战报标题) / thing2=回顾类型 / thing3=所属活动(比赛) */
export function buildReportReadyData(m: MatchLike, title: string): MsgData {
  return {
    thing1: { value: clampThing(title || '赛后战报已生成') },
    thing2: { value: '赛后战报' },
    thing3: { value: matchName(m.home_team, m.away_team) },
  };
}

// access_token 模块级缓存(微信 7200s 有效,留 5min 余量)。
let cachedToken: { token: string; exp: number } | null = null;

export async function getMiniAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp > Date.now() + 300_000) return cachedToken.token;
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) return null;
  try {
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!data.access_token) {
      console.warn('[wx-subscribe] token fail:', data.errcode, data.errmsg); // 40164=IP 未加白名单
      return null;
    }
    cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 7200) * 1000 };
    return cachedToken.token;
  } catch (e) {
    console.warn('[wx-subscribe] token throw:', (e as Error).message);
    return null;
  }
}

export function __resetTokenCacheForTests(): void { cachedToken = null; }

/** 发一条订阅消息。errcode 0=成功;43101=用户未订阅/已拒收(正常,非错误);其余打日志。 */
export async function sendSubscribeMessage(params: {
  openid: string;
  templateId: string;
  page?: string;
  data: Record<string, { value: string }>;
}): Promise<{ ok: boolean; errcode: number }> {
  const token = await getMiniAccessToken();
  if (!token) return { ok: false, errcode: -1 };
  try {
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: params.openid,
        template_id: params.templateId,
        page: params.page,
        miniprogram_state: 'formal',
        lang: 'zh_CN',
        data: params.data,
      }),
    });
    const out = (await res.json()) as { errcode?: number; errmsg?: string };
    const errcode = out.errcode ?? -3;
    if (errcode !== 0 && errcode !== 43101) console.warn('[wx-subscribe] send non-zero:', errcode, out.errmsg);
    return { ok: errcode === 0, errcode };
  } catch (e) {
    console.warn('[wx-subscribe] send throw:', (e as Error).message);
    return { ok: false, errcode: -2 };
  }
}

/**
 * 给某场某类的待推订阅逐条推送,推完标 sent_at(成功/被拒都标,一次额度一次推)。
 * data/page/templateId 由调用方按 kind 拼好传入。
 */
export async function pushPendingForMatch(
  db: SubsDb,
  opts: { matchId: string; kind: SubKind; templateId: string; page: string; data: Record<string, { value: string }> },
): Promise<{ sent: number; total: number }> {
  const { data: subs } = await db
    .from('match_subscriptions')
    .select('id,openid')
    .eq('match_id', opts.matchId)
    .eq('kind', opts.kind)
    .is('sent_at', null);
  const rows = subs ?? [];
  let sent = 0;
  for (const s of rows) {
    const r = await sendSubscribeMessage({ openid: s.openid, templateId: opts.templateId, page: opts.page, data: opts.data });
    await db.from('match_subscriptions').update({ sent_at: new Date().toISOString() }).eq('id', s.id);
    if (r.ok) sent += 1;
  }
  return { sent, total: rows.length };
}

/** 跳转页:点订阅消息打开对应页。开赛→赛事首页;战报就绪→该场战报详情。 */
export function pageForKind(kind: SubKind, matchId: string): string {
  return kind === 'report_ready'
    ? `pages/report-detail/index?id=${matchId}&style=duanzi&from=sub_report`
    : 'pages/home/index';
}
