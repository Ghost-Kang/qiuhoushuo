import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMpTokenForTests,
  addDraft,
  addMaterialImage,
  buildArticleHtml,
  getMpToken,
  pushReportToMpDraft,
  resolveWeappCta,
  uploadContentImage,
  type ArticleInput,
} from '@/lib/api/mp-draft';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetMpTokenForTests();
});

const INPUT: ArticleInput = {
  title: '巴西用效率拆开传控',
  homeTeam: '巴西', awayTeam: '西班牙', homeScore: 2, awayScore: 1,
  competition: '国际大赛', lead: '导语<带特殊&字符>', body: ['第一段', '第二段'],
  shareQuote: '控球率赢了，比分输了', shortCode: '8a3f',
};

function res(body: object) { return new Response(JSON.stringify(body), { status: 200 }); }

describe('buildArticleHtml', () => {
  it('含首图/导语/全部正文/战术图/金句/短链,且转义特殊字符', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', 'https://mmbiz.qpic.cn/tac.png');
    expect(html).toContain('https://mmbiz.qpic.cn/brief.png');
    expect(html).toContain('https://mmbiz.qpic.cn/tac.png');
    expect(html).toContain('第一段');
    expect(html).toContain('第二段');
    expect(html).toContain('控球率赢了');
    expect(html).toContain('qiuhoushuo.com/m/8a3f');
    expect(html).toContain('战术图解');
    expect(html).toContain('&lt;带特殊&amp;字符&gt;'); // 转义
    expect(html).not.toMatch(/qiu\.app/);
  });
  it('无图也能拼(只文字)', () => {
    const html = buildArticleHtml(INPUT);
    expect(html).toContain('第一段');
    expect(html).not.toContain('<img');
  });
  it('附球迷应援:主/客队两张 + 比分小标题 + AI 生成 caption', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', undefined, [
      'https://mmbiz.qpic.cn/home.png',
      'https://mmbiz.qpic.cn/away.png',
    ]);
    expect(html).toContain('球迷应援 · 巴西 2:1 西班牙');
    expect(html).toContain('https://mmbiz.qpic.cn/home.png');
    expect(html).toContain('https://mmbiz.qpic.cn/away.png');
    expect(html).toContain('巴西球迷 · AI 生成');
    expect(html).toContain('西班牙球迷 · AI 生成');
  });
  it('球迷形象单张失败:跳过空项,但 caption 仍正确对位(客队不被错标成主队)', () => {
    const html = buildArticleHtml(INPUT, undefined, undefined, [undefined, 'https://mmbiz.qpic.cn/away.png']);
    expect(html).toContain('https://mmbiz.qpic.cn/away.png');
    expect(html).toContain('西班牙球迷 · AI 生成');
    expect(html).not.toContain('巴西球迷'); // 主队那张缺失,不应出现主队 caption
  });
  it('无球迷形象 → 不渲染应援段', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png');
    expect(html).not.toContain('球迷应援');
  });
  it('附球员评分卡:小标题 + 图,排在战术图解之后', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', 'https://mmbiz.qpic.cn/tac.png', undefined, 'https://mmbiz.qpic.cn/ratings.png');
    expect(html).toContain('球员评分');
    expect(html).toContain('https://mmbiz.qpic.cn/ratings.png');
    // 顺序:战术图解 在 球员评分 之前
    expect(html.indexOf('战术图解')).toBeLessThan(html.indexOf('球员评分'));
  });
  it('无球员评分 → 不渲染评分段', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', 'https://mmbiz.qpic.cn/tac.png');
    expect(html).not.toContain('球员评分');
  });
});

describe('buildArticleHtml · 小程序 CTA(搜一搜读者 → 小程序转化桥)', () => {
  it('有 WX_APPID:两条文字链深链本场,& 转义,带 from=mparticle 埋点;不用 mp-miniprogram 卡片标签(draft/add 45166 不收)', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png');
    expect(html).not.toContain('<mp-miniprogram'); // API 不支持,实测 45166
    expect(html).toContain('data-miniprogram-appid="wxTEST"');
    expect(html).toContain('data-miniprogram-path="pages/report-detail/index?shortCode=8a3f&amp;from=mparticle"');
    expect(html).toContain('看这场的完整战报、球员评分和战术卡');
    expect(html).toContain('data-miniprogram-path="pages/fan-avatar/index?from=mparticle"');
    expect(html).toContain('上传自拍');
    // 位置:金句之后、AI 标识行之前
    expect(html.indexOf('控球率赢了')).toBeLessThan(html.indexOf('进小程序继续看'));
    expect(html.indexOf('进小程序继续看')).toBeLessThan(html.indexOf('本文由 AI 生成'));
  });
  it('有 appid + 码图:码图包成小程序图片链接(点图跳本场),caption 提示点击或长按', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    const html = buildArticleHtml(INPUT, undefined, undefined, undefined, undefined, 'https://mmbiz.qpic.cn/qr.png');
    expect(html).toContain('<a data-miniprogram-appid="wxTEST" data-miniprogram-path="pages/report-detail/index?shortCode=8a3f&amp;from=mparticle" href=""><img src="https://mmbiz.qpic.cn/qr.png"');
    expect(html).toContain('点击图片或长按识别小程序码');
  });
  it('WX_APPID 缺时兜底 WXPAY_MINI_APPID', () => {
    vi.stubEnv('WX_APPID', '');
    vi.stubEnv('WXPAY_MINI_APPID', 'wxMINI');
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png');
    expect(html).toContain('data-miniprogram-appid="wxMINI"');
  });
  it('无 appid → 整段不渲染(与历史正文一致)', () => {
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png');
    expect(html).not.toContain('data-miniprogram');
    expect(html).not.toContain('进小程序继续看');
  });
  it('MP_DRAFT_WEAPP_CTA=0 一键关(卡片/文字链/码全关)', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', '0');
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', undefined, undefined, undefined, 'https://mmbiz.qpic.cn/qr.png');
    expect(html).not.toContain('data-miniprogram');
    expect(html).not.toContain('长按识别');
    expect(html).not.toContain('进小程序继续看');
  });
  it('带小程序码 url:码图 + 长按识别 caption,排在文字链之后', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', undefined, undefined, undefined, 'https://mmbiz.qpic.cn/qr.png');
    expect(html).toContain('https://mmbiz.qpic.cn/qr.png');
    expect(html).toContain('长按识别小程序码');
    expect(html.indexOf('上传自拍')).toBeLessThan(html.indexOf('长按识别'));
  });
  it('MP_DRAFT_WEAPP_CTA=qr:只留码(服务号未关联小程序的逃生档),无 data-miniprogram 标签,caption 只提长按', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', 'qr');
    const html = buildArticleHtml(INPUT, 'https://mmbiz.qpic.cn/brief.png', undefined, undefined, undefined, 'https://mmbiz.qpic.cn/qr.png');
    expect(html).not.toContain('data-miniprogram');
    expect(html).toContain('长按识别小程序码');
    expect(html).not.toContain('点击图片或');
    expect(html).toContain('进小程序继续看'); // 段标题仍在
  });
});

describe('resolveWeappCta 三档开关', () => {
  it('默认(有 appid):卡片/文字链 + 码全开', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    expect(resolveWeappCta()).toEqual({ appid: 'wxTEST', qr: true });
  });
  it('=qr:appid 置空只留码', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', 'qr');
    expect(resolveWeappCta()).toEqual({ appid: null, qr: true });
  });
  it('=0:全关;无 appid:全关(码也不放,保持旧行为)', () => {
    vi.stubEnv('WX_APPID', 'wxTEST');
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', '0');
    expect(resolveWeappCta()).toEqual({ appid: null, qr: false });
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', '');
    vi.stubEnv('WX_APPID', '');
    vi.stubEnv('WXPAY_MINI_APPID', '');
    expect(resolveWeappCta()).toEqual({ appid: null, qr: false });
  });
});

describe('getMpToken', () => {
  it('缺服务号 env → null', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', '');
    vi.stubEnv('WXPAY_SERVICE_SECRET', '');
    expect(await getMpToken(vi.fn())).toBeNull();
  });
  it('取到并缓存(第二次不再请求)', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    const f = vi.fn(async () => res({ access_token: 'TK', expires_in: 7200 }));
    expect(await getMpToken(f as unknown as typeof fetch)).toBe('TK');
    expect(await getMpToken(f as unknown as typeof fetch)).toBe('TK');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('40164(IP 未白名单)→ null 不抛', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    const f = vi.fn(async () => res({ errcode: 40164, errmsg: 'invalid ip' }));
    expect(await getMpToken(f as unknown as typeof fetch)).toBeNull();
  });
});

describe('uploadContentImage / addMaterialImage / addDraft', () => {
  it('uploadimg 返回 url;errcode→null', async () => {
    expect(await uploadContentImage('TK', Buffer.from('x'), vi.fn(async () => res({ url: 'U' })) as unknown as typeof fetch)).toBe('U');
    expect(await uploadContentImage('TK', Buffer.from('x'), vi.fn(async () => res({ errcode: 1 })) as unknown as typeof fetch)).toBeNull();
  });
  it('add_material 返回 media_id;errcode→null', async () => {
    expect(await addMaterialImage('TK', Buffer.from('x'), vi.fn(async () => res({ media_id: 'M' })) as unknown as typeof fetch)).toBe('M');
    expect(await addMaterialImage('TK', Buffer.from('x'), vi.fn(async () => res({ errcode: 1 })) as unknown as typeof fetch)).toBeNull();
  });
  it('draft/add 返回 media_id + articles 体含封面/正文', async () => {
    let captured: { thumb: string; hasContent: boolean } | null = null;
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)); const a = b.articles[0];
      captured = { thumb: a.thumb_media_id, hasContent: typeof a.content === 'string' && a.content.length > 0 };
      return res({ media_id: 'DRAFT1' });
    });
    const id = await addDraft('TK', { title: 't', author: '超帧球后说', digest: 'd', content: '<p>c</p>', thumb_media_id: 'M' }, f as unknown as typeof fetch);
    expect(id).toBe('DRAFT1');
    expect(captured!.thumb).toBe('M');
    expect(captured!.hasContent).toBe(true);
  });
});

describe('pushReportToMpDraft 编排', () => {
  function routedFetch() {
    return vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('cgi-bin/token')) return res({ access_token: 'TK', expires_in: 7200 });
      if (u.includes('add_material')) return res({ media_id: 'COVER' });
      if (u.includes('uploadimg')) return res({ url: 'https://mmbiz.qpic.cn/x.png' });
      if (u.includes('draft/add')) return res({ media_id: 'DRAFT1' });
      return res({ errcode: -1 });
    });
  }
  it('缺一图看懂(封面)→ NO_COVER 不调微信', async () => {
    const f = vi.fn();
    const r = await pushReportToMpDraft({ input: INPUT, briefBytes: null, fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NO_COVER/);
    expect(f).not.toHaveBeenCalled();
  });
  it('取不到 token → NO_TOKEN', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', '');
    vi.stubEnv('WXPAY_SERVICE_SECRET', '');
    const r = await pushReportToMpDraft({ input: INPUT, briefBytes: Buffer.from('x'), fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NO_TOKEN/);
  });
  it('happy:封面 + 正文图 + 建草稿 → draftId', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    const f = routedFetch();
    const r = await pushReportToMpDraft({ input: INPUT, briefBytes: Buffer.from('b'), tacticsBytes: Buffer.from('t'), fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    expect(r.draftId).toBe('DRAFT1');
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('add_material'))).toBe(true);
    expect(urls.filter((u) => u.includes('uploadimg')).length).toBe(2); // brief + tactics
    expect(urls.some((u) => u.includes('draft/add'))).toBe(true);
  });
  it('带球员评分:多上传一张 + 草稿正文含评分段', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    let draftContent = '';
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('cgi-bin/token')) return res({ access_token: 'TK', expires_in: 7200 });
      if (u.includes('add_material')) return res({ media_id: 'COVER' });
      if (u.includes('uploadimg')) return res({ url: 'https://mmbiz.qpic.cn/x.png' });
      if (u.includes('draft/add')) { draftContent = JSON.parse(String(init?.body)).articles[0].content; return res({ media_id: 'DRAFT1' }); }
      return res({ errcode: -1 });
    });
    const r = await pushReportToMpDraft({
      input: INPUT, briefBytes: Buffer.from('b'), tacticsBytes: Buffer.from('t'), ratingsBytes: Buffer.from('r'),
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('uploadimg')).length).toBe(3); // brief + tactics + 球员评分
    expect(draftContent).toContain('球员评分');
  });
  it('开 CTA(有 WX_APPID):多上传一张小程序码 + 正文含文字链/可点码图/引导语', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    vi.stubEnv('WX_APPID', 'wxTEST');
    let draftContent = '';
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('cgi-bin/token')) return res({ access_token: 'TK', expires_in: 7200 });
      if (u.includes('add_material')) return res({ media_id: 'COVER' });
      if (u.includes('uploadimg')) return res({ url: 'https://mmbiz.qpic.cn/x.png' });
      if (u.includes('draft/add')) { draftContent = JSON.parse(String(init?.body)).articles[0].content; return res({ media_id: 'DRAFT1' }); }
      return res({ errcode: -1 });
    });
    const r = await pushReportToMpDraft({ input: INPUT, briefBytes: Buffer.from('b'), tacticsBytes: Buffer.from('t'), fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('uploadimg')).length).toBe(3); // brief + tactics + 小程序码
    expect(draftContent).toContain('data-miniprogram-appid="wxTEST"');
    expect(draftContent).not.toContain('<mp-miniprogram'); // draft/add 45166 不收该标签
    expect(draftContent).toContain('href=""><img'); // 码图=图片式小程序链接
    expect(draftContent).toContain('长按识别小程序码');
  });
  it('MP_DRAFT_WEAPP_CTA=0:不传码不加 CTA(与旧正文一致)', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    vi.stubEnv('WX_APPID', 'wxTEST');
    vi.stubEnv('MP_DRAFT_WEAPP_CTA', '0');
    let draftContent = '';
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('cgi-bin/token')) return res({ access_token: 'TK', expires_in: 7200 });
      if (u.includes('add_material')) return res({ media_id: 'COVER' });
      if (u.includes('uploadimg')) return res({ url: 'https://mmbiz.qpic.cn/x.png' });
      if (u.includes('draft/add')) { draftContent = JSON.parse(String(init?.body)).articles[0].content; return res({ media_id: 'DRAFT1' }); }
      return res({ errcode: -1 });
    });
    const r = await pushReportToMpDraft({ input: INPUT, briefBytes: Buffer.from('b'), tacticsBytes: Buffer.from('t'), fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('uploadimg')).length).toBe(2); // brief + tactics(无码)
    expect(draftContent).not.toContain('data-miniprogram');
  });
  it('带球迷形象:多上传两张 + 草稿正文含应援段', async () => {
    vi.stubEnv('WXPAY_SERVICE_APPID', 'a');
    vi.stubEnv('WXPAY_SERVICE_SECRET', 's');
    let draftContent = '';
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('cgi-bin/token')) return res({ access_token: 'TK', expires_in: 7200 });
      if (u.includes('add_material')) return res({ media_id: 'COVER' });
      if (u.includes('uploadimg')) return res({ url: 'https://mmbiz.qpic.cn/x.png' });
      if (u.includes('draft/add')) { draftContent = JSON.parse(String(init?.body)).articles[0].content; return res({ media_id: 'DRAFT1' }); }
      return res({ errcode: -1 });
    });
    const r = await pushReportToMpDraft({
      input: INPUT, briefBytes: Buffer.from('b'), tacticsBytes: Buffer.from('t'),
      fanPortraitBytes: [Buffer.from('home'), Buffer.from('away')], fetchImpl: f as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('uploadimg')).length).toBe(4); // brief + tactics + 主/客两张球迷
    expect(draftContent).toContain('球迷应援');
    expect(draftContent).toContain('巴西球迷 · AI 生成');
  });
});
