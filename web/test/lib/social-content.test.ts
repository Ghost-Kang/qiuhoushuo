import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATFORMS,
  PLATFORM_IDS,
  STATION_OUT_FORBIDDEN,
  CHANNELS_FORBIDDEN,
  hasForbidden,
  buildKindPrompt,
  parseOneNote,
  generateSocialBundle,
  renderSocialMarkdown,
  matchFolderName,
  buildSocialAlert,
  loadSocialFactsFromDb,
  writeSocialBundle,
  generateSocialFromFacts,
  pushMatchCardImagesToWecom,
  sendWecomImage,
  socialAutoGenEnabled,
  type SocialFacts,
  type SocialDb,
  type PlatformId,
  type PlatformSpec,
} from '@/lib/api/social-content';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const FACTS: SocialFacts = {
  matchId: '11111111-1111-4111-8111-111111111111',
  date: '2026-06-29',
  matchLabel: '巴西 2:1 西班牙',
  home: '巴西',
  away: '西班牙',
  score: '2:1',
  competition: '国际大赛',
  reports: {
    hardcore: { title: '巴西用效率拆传控', shareQuote: '控球输了比分赢了', lead: '导语', body: ['段一内容', '段二'] },
    duanzi: { title: '这场笑死', shareQuote: '名场面', lead: 'l', body: ['b1', 'b2'] },
    emotion: { title: '意难平', shareQuote: '破防', lead: 'l', body: ['b1', 'b2'] },
  },
  briefCardUrl: 'https://qiuhoushuo.com/api/card/x?variant=brief',
  ratingsCardUrl: 'https://qiuhoushuo.com/api/card/x?variant=ratings',
};

/** 单条 note 的 LLM 返回(可注入禁词)。 */
function rawNote(kind: string, opts: { bad?: boolean } = {}): string {
  return JSON.stringify({
    note: {
      coverTitle: '封面',
      coverSub: '副',
      title: `标题-${kind}`,
      body: opts.bad ? '加我微信看抖音' : `正文 [0-3s] 画面+口播 ${kind}`,
      tags: ['看球'],
    },
  });
}

describe('注册表', () => {
  it('三平台齐全', () => {
    expect(PLATFORM_IDS).toEqual(['xhs', 'douyin', 'channels']);
    expect(PLATFORMS.xhs.name).toBe('小红书');
    expect(PLATFORMS.douyin.name).toBe('抖音');
    expect(PLATFORMS.channels.name).toBe('视频号');
  });
});

describe('禁词集差异(站外 vs 站内)', () => {
  it('站外(上线后):允许"微信搜超帧球后说"搜索导流,禁二维码/扫码/加微信/外链', () => {
    expect(hasForbidden('微信搜小程序「超帧球后说」', STATION_OUT_FORBIDDEN)).toBe(false);
    expect(hasForbidden('搜小程序', STATION_OUT_FORBIDDEN)).toBe(false);
    expect(hasForbidden('扫二维码', STATION_OUT_FORBIDDEN)).toBe(true);
    expect(hasForbidden('加我微信', STATION_OUT_FORBIDDEN)).toBe(true);
    expect(hasForbidden('看 https://x.com', STATION_OUT_FORBIDDEN)).toBe(true);
  });
  it('视频号(站内)允许 小程序/公众号,但禁竞品平台名 + 外链', () => {
    expect(hasForbidden('戳下方小程序看战报', CHANNELS_FORBIDDEN)).toBe(false);
    expect(hasForbidden('关注公众号', CHANNELS_FORBIDDEN)).toBe(false);
    expect(hasForbidden('去抖音看', CHANNELS_FORBIDDEN)).toBe(true);
    expect(hasForbidden('小红书同款', CHANNELS_FORBIDDEN)).toBe(true);
    expect(hasForbidden('打开 qiuhoushuo.com', CHANNELS_FORBIDDEN)).toBe(true);
  });
});

describe.each(PLATFORM_IDS)('平台 %s 通用契约', (platform: PlatformId) => {
  const spec = PLATFORMS[platform];
  const kind0 = spec.llmKinds[0]!;
  // 本场实际用的关注话术:小红书=动态追更承诺,抖音/视频号=静态(followCtaFor 未实现,行为冻结)
  const cta = spec.followCtaFor?.(FACTS) ?? spec.followCta;

  it('buildKindPrompt:system=平台红线,user 含比赛 + 单条 JSON + 该类要求 + 关注话术', () => {
    const msgs = buildKindPrompt(spec, kind0, FACTS);
    expect(msgs[0]!.role).toBe('system');
    const user = msgs[1]!.content;
    expect(user).toContain('巴西 2:1 西班牙');
    expect(user).toContain('"note"');
    expect(user).toContain(cta);
    expect(user).toContain(spec.kindBrief[kind0]!.slice(0, 6));
  });

  it('parseOneNote 合法 → 带关注话术 + #国际大赛 + 不命中禁词', () => {
    const n = parseOneNote(spec, kind0, rawNote(kind0), FACTS);
    expect(n.kind).toBe(kind0);
    expect(n.body.trimEnd().endsWith(cta)).toBe(true);
    expect(n.tags).toContain('#国际大赛');
    expect(hasForbidden(`${n.title}\n${n.body}\n${n.tags.join(' ')}`, spec.forbidden)).toBe(false);
  });

  it('parseOneNote 命中禁词 → 回退干净模板', () => {
    const n = parseOneNote(spec, kind0, rawNote(kind0, { bad: true }), FACTS);
    expect(hasForbidden(`${n.title}\n${n.body}`, spec.forbidden)).toBe(false);
  });

  it('parseOneNote 非法 JSON / 缺字段 → 模板兜底', () => {
    expect(parseOneNote(spec, kind0, 'not json', FACTS).title.length).toBeGreaterThan(0);
    expect(parseOneNote(spec, kind0, '{"note":{"body":"只有正文"}}', FACTS).title.length).toBeGreaterThan(0);
  });

  it('所有 fallback + extra 模板对该平台禁词集自洽', () => {
    const all = [...spec.llmKinds.map((k) => spec.fallbackNote(k, FACTS)), ...spec.extraNotes(FACTS)];
    for (const n of all) {
      expect(hasForbidden(`${n.coverTitle}\n${n.coverSub}\n${n.title}\n${n.body}\n${n.tags.join(' ')}`, spec.forbidden)).toBe(false);
      expect(n.body).toContain(cta);
      expect(n.tags).toContain('#国际大赛');
    }
  });

  it('generateSocialBundle:每类**单独并行**调 LLM,条数 = llmKinds + extraNotes', async () => {
    const llm = vi.fn(async (o: { caller?: string }) => ({
      content: rawNote(String(o.caller).split(':').pop() || ''),
      provider: 'doubao' as const,
      meta: { model: 'm', latencyMs: 1 },
    }));
    const bundle = await generateSocialBundle(FACTS, spec, { llm });
    expect(bundle.platform).toBe(platform);
    expect(llm).toHaveBeenCalledTimes(spec.llmKinds.length); // 单条单调
    expect(bundle.notes).toHaveLength(spec.llmKinds.length + spec.extraNotes(FACTS).length);
  });

  it('generateSocialBundle:某条 LLM 抛错 → 仅该条回退,其余正常', async () => {
    let n = 0;
    const llm = vi.fn(async (o: { caller?: string }) => {
      n += 1;
      if (n === 1) throw new Error('boom'); // 第一条超时
      return { content: rawNote(String(o.caller).split(':').pop() || ''), provider: 'doubao' as const, meta: { model: 'm', latencyMs: 1 } };
    });
    const bundle = await generateSocialBundle(FACTS, spec, { llm });
    expect(bundle.notes).toHaveLength(spec.llmKinds.length + spec.extraNotes(FACTS).length);
    for (const note of bundle.notes) {
      expect(note.title.length).toBeGreaterThan(0);
      expect(hasForbidden(note.body, spec.forbidden)).toBe(false);
    }
  });
});

describe('平台特性', () => {
  it('小红书有球迷写真条、含两队 + AI生成', () => {
    const xz = PLATFORMS.xhs.extraNotes(FACTS)[0]!;
    expect(xz.kind).toBe('xiezhen');
    expect(xz.body).toContain('巴西');
    expect(xz.body).toContain('西班牙');
    expect(xz.body).toContain('AI生成');
  });
  it('抖音/视频号 fallback 是短视频脚本(含分镜时间轴)', () => {
    expect(PLATFORMS.douyin.fallbackNote('kadian', FACTS).body).toContain('[0-3s');
    expect(PLATFORMS.channels.fallbackNote('jieshuo', FACTS).body).toContain('[0-3s');
  });
  it('视频号 CTA 走微信生态(挂小程序)且不踩自家红线', () => {
    expect(PLATFORMS.channels.followCta).toContain('小程序');
    expect(hasForbidden(PLATFORMS.channels.followCta, CHANNELS_FORBIDDEN)).toBe(false);
  });
  it('上线后:小红书/抖音 CTA 走"微信搜"搜索导流,且不踩站外红线', () => {
    expect(PLATFORMS.xhs.followCta).toContain('微信搜');
    expect(PLATFORMS.douyin.followCta).toContain('微信搜');
    expect(hasForbidden(PLATFORMS.xhs.followCta, STATION_OUT_FORBIDDEN)).toBe(false);
    expect(hasForbidden(PLATFORMS.douyin.followCta, STATION_OUT_FORBIDDEN)).toBe(false);
  });
});

describe('渲染 / 落盘 / 通知 / 取数', () => {
  it('renderSocialMarkdown:README + 每条一 .md', () => {
    const bundle = { platform: 'douyin' as const, matchId: FACTS.matchId, matchLabel: FACTS.matchLabel, notes: PLATFORMS.douyin.extraNotes(FACTS) };
    const files = renderSocialMarkdown(PLATFORMS.douyin, bundle);
    expect(files[0]!.name).toBe('README.md');
    expect(files[0]!.content).toContain('抖音内容');
    expect(files.length).toBe(bundle.notes.length + 1);
  });

  it('matchFolderName = 日期-主-客-id8', () => {
    expect(matchFolderName(FACTS)).toBe('2026-06-29-巴西-西班牙-11111111');
  });

  it('buildSocialAlert:极简——标题含平台+比赛,正文=标题+正文+标签(不塞文件夹路径/配图链接)', () => {
    const note = PLATFORMS.channels.fallbackNote('jieshuo', FACTS);
    const bundle = { platform: 'channels' as const, matchId: FACTS.matchId, matchLabel: FACTS.matchLabel, notes: [note] };
    const a = buildSocialAlert(PLATFORMS.channels, bundle, '/data/x', true);
    expect(a.title).toContain('视频号');
    expect(a.title).toContain('巴西 2:1 西班牙');
    expect(a.body).toContain(note.title);
    expect(a.body).toContain(PLATFORMS.channels.followCta);
    expect(a.body).not.toContain('/data/x'); // 落盘成功不塞路径
    expect(a.body).not.toContain('http'); // 配图已单独推图,不塞链接
    expect(a.tags).toEqual(['social', 'channels']);
  });
  it('多条 → 一行小尾巴"另有N条";落盘失败才显示路径', () => {
    const notes = [...PLATFORMS.xhs.llmKinds.map((k) => PLATFORMS.xhs.fallbackNote(k, FACTS)), ...PLATFORMS.xhs.extraNotes(FACTS)];
    const bundle = { platform: 'xhs' as const, matchId: FACTS.matchId, matchLabel: FACTS.matchLabel, notes };
    expect(buildSocialAlert(PLATFORMS.xhs, bundle, '/data/x', true).body).toContain(`另有 ${notes.length - 1} 条`);
    expect(buildSocialAlert(PLATFORMS.xhs, bundle, '/data/x', false).body).toContain('落盘失败');
  });

  it('writeSocialBundle 写到 <根>/<比赛>/<平台>/', async () => {
    const base = await mkdtemp(join(tmpdir(), 'social-test-'));
    vi.stubEnv('SOCIAL_CONTENT_DIR', base);
    try {
      const files = [{ name: 'README.md', content: 'hi' }];
      const { dir, archived } = await writeSocialBundle(FACTS, PLATFORMS.xhs, files);
      expect(archived).toBe(true);
      expect(dir).toBe(`${base}/${matchFolderName(FACTS)}/小红书`);
      expect(await readFile(`${dir}/README.md`, 'utf8')).toBe('hi');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('generateSocialFromFacts:三平台落到各自子目录(LLM 失败也照样出模板)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'social-test2-'));
    vi.stubEnv('SOCIAL_CONTENT_DIR', base);
    const llm = vi.fn(async () => ({ content: '{bad', provider: 'doubao' as const, meta: { model: 'm', latencyMs: 1 } }));
    try {
      for (const p of PLATFORM_IDS) {
        const r = await generateSocialFromFacts(FACTS, p, { llm });
        expect(r.archived).toBe(true);
        expect(r.dir.endsWith(`/${PLATFORMS[p].name}`)).toBe(true);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('loadSocialFactsFromDb:有战报 → facts;无 → null', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://qiuhoushuo.com');
    const db = (rows: unknown[]): SocialDb => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) });
    const rows = [{ style: 'duanzi', title: 't', lead: 'l', body: ['b'], share_quote: 'q', matches: { home_team: 'Brazil', away_team: 'Spain', home_score: 2, away_score: 1, competition: '', match_date: '2026-06-29T20:00:00Z' } }];
    const facts = await loadSocialFactsFromDb(db(rows), FACTS.matchId);
    expect(facts!.score).toBe('2:1');
    expect(facts!.competition).toBe('国际大赛');
    expect(facts!.briefCardUrl).toContain('/api/card/');
    expect(await loadSocialFactsFromDb(db([]), FACTS.matchId)).toBeNull();
  });
});

describe('sendWecomImage (B:企微图片消息)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });
  it('无 webhook → 不发', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sendWecomImage(Buffer.from('abc'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('有 webhook → image 消息含 base64 + 32 位 md5', async () => {
    vi.stubEnv('WECOM_BOT_WEBHOOK', 'https://qyapi.example/webhook');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const bytes = Buffer.from('PNGDATA');
    await sendWecomImage(bytes);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.msgtype).toBe('image');
    expect(body.image.base64).toBe(bytes.toString('base64'));
    expect(body.image.md5).toMatch(/^[0-9a-f]{32}$/);
  });
  it('超 2MB → 跳过', async () => {
    vi.stubEnv('WECOM_BOT_WEBHOOK', 'https://qyapi.example/webhook');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await sendWecomImage(Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pushMatchCardImagesToWecom (B:企微推图)', () => {
  it('取 brief+ratings 卡 → 各发一条企微 image 消息', async () => {
    vi.stubEnv('WECOM_BOT_WEBHOOK', 'https://qyapi.example/webhook');
    const orig = globalThis.fetch;
    const webhookBodies: Array<{ msgtype: string }> = [];
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes('/api/card/')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      webhookBodies.push(JSON.parse(init!.body as string));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await pushMatchCardImagesToWecom('match-1');
      expect(webhookBodies).toHaveLength(2); // 一图看懂 + 数据卡
      expect(webhookBodies.every((b) => b.msgtype === 'image')).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('卡 404(如无球员评分)→ 跳过该图、不发空消息', async () => {
    vi.stubEnv('WECOM_BOT_WEBHOOK', 'https://qyapi.example/webhook');
    const orig = globalThis.fetch;
    let webhook = 0;
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/api/card/')) return new Response('no', { status: 404 });
      webhook += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await pushMatchCardImagesToWecom('match-2');
      expect(webhook).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('球迷形象/球星合影引流(门控+取星+文案)', () => {
  it('socialFanPortraitEnabled / socialCostarShowcaseEnabled 缺省关·1/true 开', async () => {
    const m = await import('@/lib/api/social-content');
    expect(m.socialFanPortraitEnabled()).toBe(false);
    expect(m.socialCostarShowcaseEnabled()).toBe(false);
    vi.stubEnv('SOCIAL_FAN_PORTRAIT', '1');
    vi.stubEnv('SOCIAL_COSTAR_SHOWCASE', 'true');
    expect(m.socialFanPortraitEnabled()).toBe(true);
    expect(m.socialCostarShowcaseEnabled()).toBe(true);
  });

  it('球迷形象/合影 off → push 函数直接返回不抛(不碰 provider/网络)', async () => {
    const m = await import('@/lib/api/social-content');
    await expect(m.pushFanPortraitSamplesToWecom(FACTS)).resolves.toBeUndefined();
    await expect(m.pushCostarShowcaseToWecom(FACTS)).resolves.toBeUndefined();
  });

  it('costar showcase on 但无当场球星 → 跳过(facts.star 缺)', async () => {
    vi.stubEnv('SOCIAL_COSTAR_SHOWCASE', '1');
    const m = await import('@/lib/api/social-content');
    await expect(m.pushCostarShowcaseToWecom({ ...FACTS, star: undefined })).resolves.toBeUndefined();
  });

  it('loadSocialFactsFromDb 取当场球星:MOTM 优先 → 进球者 → 哨兵跳过', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://qiuhoushuo.com');
    const db = (mm: Record<string, unknown>): SocialDb => ({
      from: () => ({ select: () => ({ eq: async () => ({ data: [{ style: 'duanzi', title: 't', lead: 'l', body: ['b'], share_quote: 'q', matches: { home_team: 'Brazil', away_team: 'Spain', home_score: 2, away_score: 1, competition: '', match_date: '2026-06-29', ...mm } }] }) }) }),
    });
    const { loadSocialFactsFromDb } = await import('@/lib/api/social-content');
    const motm = await loadSocialFactsFromDb(db({ stats: { players: { motm: { name: 'L. Messi', team: 'Argentina' } } }, events: [{ type: 'goal', player: 'X' }] }), 'm1');
    expect(motm!.star).toBe('L. Messi'); // MOTM 优先于进球者
    const goal = await loadSocialFactsFromDb(db({ events: [{ type: 'goal', player: 'Y. Goalscorer' }] }), 'm1');
    expect(goal!.star).toBe('Y. Goalscorer'); // 无 MOTM → 进球者
    const sentinel = await loadSocialFactsFromDb(db({ events: [{ type: 'goal', player: '未知球员' }] }), 'm1');
    expect(sentinel!.star).toBeUndefined(); // 哨兵名跳过
  });
});

describe('socialAutoGenEnabled', () => {
  it('各平台独立 env 门控,缺省关', () => {
    expect(socialAutoGenEnabled('xhs')).toBe(false);
    vi.stubEnv('DOUYIN_AUTO_GEN', '1');
    expect(socialAutoGenEnabled('douyin')).toBe(true);
    expect(socialAutoGenEnabled('xhs')).toBe(false);
    vi.stubEnv('CHANNELS_AUTO_GEN', 'true');
    expect(socialAutoGenEnabled('channels')).toBe(true);
  });
});
