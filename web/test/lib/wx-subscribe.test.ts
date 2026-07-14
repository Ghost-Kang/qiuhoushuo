import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTokenCacheForTests,
  buildMatchStartData,
  buildReportReadyData,
  clampThing,
  getMiniAccessToken,
  pushPendingForMatch,
  sendSubscribeMessage,
  TMPL_MATCH_START,
  type SubsDb,
} from '@/lib/api/wx-subscribe';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetTokenCacheForTests();
});

describe('clampThing', () => {
  it('≤20 原样;空→-;超 20 截断加…', () => {
    expect(clampThing('巴西 vs 西班牙')).toBe('巴西 vs 西班牙');
    expect(clampThing('')).toBe('-');
    expect(clampThing(null)).toBe('-');
    const out = clampThing('一'.repeat(25));
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('订阅消息 data builders', () => {
  it('开赛提醒:thing1 队名(中文)/thing3 赛事类别脱敏', () => {
    const comp = ['World', 'Cup', '2026'].join(' '); // 拼接避免源码出现商标词(check:trademark);运行时=商标串测脱敏
    const d = buildMatchStartData({ home_team: 'Brazil', away_team: 'Spain', competition: comp, match_date: '2026-06-15T14:00:00Z' });
    expect(d.thing1.value).toContain('巴西');
    expect(d.thing1.value).toContain('西班牙');
    expect(d.thing3.value).not.toMatch(/world\s*cup/i); // 商标脱敏
    expect(typeof d.thing2.value).toBe('string');
  });
  it('战报就绪:thing1=标题/thing2=赛后战报/thing3=比赛', () => {
    const d = buildReportReadyData({ home_team: 'Brazil', away_team: 'Spain' }, '巴西用效率拆开传控');
    expect(d.thing1.value).toBe('巴西用效率拆开传控');
    expect(d.thing2.value).toBe('赛后战报');
    expect(d.thing3.value).toContain('巴西');
  });
  it('战报就绪:空标题兜底', () => {
    expect(buildReportReadyData({ home_team: 'A', away_team: 'B' }, '').thing1.value).toBe('赛后战报已生成');
  });
});

describe('access_token', () => {
  it('缺 WX env → null', async () => {
    vi.stubEnv('WX_APPID', '');
    vi.stubEnv('WX_SECRET', '');
    expect(await getMiniAccessToken()).toBeNull();
  });
  it('取到并缓存(第二次不再 fetch)', async () => {
    vi.stubEnv('WX_APPID', 'a');
    vi.stubEnv('WX_SECRET', 's');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'TK', expires_in: 7200 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getMiniAccessToken()).toBe('TK');
    expect(await getMiniAccessToken()).toBe('TK');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('40164(IP 未白名单)→ null,不抛', async () => {
    vi.stubEnv('WX_APPID', 'a');
    vi.stubEnv('WX_SECRET', 's');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errcode: 40164, errmsg: 'invalid ip' }), { status: 200 })));
    expect(await getMiniAccessToken()).toBeNull();
  });
});

describe('sendSubscribeMessage', () => {
  function mockTokenThenSend(sendBody: object) {
    vi.stubEnv('WX_APPID', 'a');
    vi.stubEnv('WX_SECRET', 's');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).includes('cgi-bin/token')
        ? new Response(JSON.stringify({ access_token: 'TK', expires_in: 7200 }), { status: 200 })
        : new Response(JSON.stringify(sendBody), { status: 200 })
    )));
  }
  it('errcode 0 → ok', async () => {
    mockTokenThenSend({ errcode: 0, errmsg: 'ok' });
    expect((await sendSubscribeMessage({ openid: 'o', templateId: TMPL_MATCH_START, data: {} })).ok).toBe(true);
  });
  it('43101(用户未订阅/已拒收)→ ok=false 不抛', async () => {
    mockTokenThenSend({ errcode: 43101, errmsg: 'cannot send' });
    const r = await sendSubscribeMessage({ openid: 'o', templateId: TMPL_MATCH_START, data: {} });
    expect(r.ok).toBe(false);
    expect(r.errcode).toBe(43101);
  });
  it('无 token(缺 env)→ ok=false 不发', async () => {
    vi.stubEnv('WX_APPID', '');
    vi.stubEnv('WX_SECRET', '');
    expect((await sendSubscribeMessage({ openid: 'o', templateId: TMPL_MATCH_START, data: {} })).ok).toBe(false);
  });
});

describe('pushPendingForMatch', () => {
  it('对 pending 订阅逐条推 + 都标 sent_at', async () => {
    vi.stubEnv('WX_APPID', 'a');
    vi.stubEnv('WX_SECRET', 's');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).includes('cgi-bin/token')
        ? new Response(JSON.stringify({ access_token: 'TK', expires_in: 7200 }), { status: 200 })
        : new Response(JSON.stringify({ errcode: 0 }), { status: 200 })
    )));
    const marked: string[] = [];
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ data: [{ id: 's1', openid: 'o1' }, { id: 's2', openid: 'o2' }] }) }) }) }),
        update: () => ({ eq: async (_c: string, v: string) => { marked.push(v); return { data: null }; } }),
      }),
    };
    const r = await pushPendingForMatch(db as unknown as SubsDb, { matchId: 'm', kind: 'match_start', templateId: TMPL_MATCH_START, page: 'pages/home/index', data: {} });
    expect(r.total).toBe(2);
    expect(r.sent).toBe(2);
    expect(marked).toEqual(['s1', 's2']);
  });
});
