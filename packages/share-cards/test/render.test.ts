import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { renderCard, SIZES, BRACKET_SIZE, type CardPayload, type Platform, type Style } from '../src';
import { splitTextLines } from '../src/text-fit.js';
import hardcore from './fixtures/hardcore.json';
import duanzi from './fixtures/duanzi.json';
import emotion from './fixtures/emotion.json';

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABwYCAqG8p9cAAAAASUVORK5CYII=';
const brief = {
  ...hardcore,
  title: '一图看懂：巴西用效率拆开传控',
  subtitle: '巴西 2:1 西班牙，胜负手落在效率和关键回合。',
  shareQuote: '两分钟看懂这场球的重点。',
  brand: '超帧球后说 · 一图看懂 · AI 生成',
  briefCard: {
    title: '一图看懂：巴西用效率拆开传控',
    match_line: '国际大赛小组赛 · 2026.06.22 · 巴西 2:1 西班牙',
    one_sentence_summary: '巴西 2:1 西班牙，胜负手落在效率和关键回合。',
    focus_tags: ['胜负手', '机会质量', '精彩镜头'],
    key_reasons: [
      { title: '巴西把比分优势守到终场', evidence: '比分只有一球差，关键在禁区前沿。' },
      { title: '数据解释比赛体感', evidence: 'xG 1.9:1.4，巴西机会质量更高。' },
      { title: '情绪落点清晰', evidence: '控球不等于控制，射门质量才是答案。' },
    ],
    timeline: [
      { minute: '关键进球', text: '巴西把比分写进镜头' },
      { minute: '压迫时刻', text: '西班牙连续冲击' },
      { minute: '终场前后', text: '终场哨响后的表情' },
    ],
    data_points: [
      { label: 'xG', value: '1.9:1.4', note: '巴西更接近高质量机会' },
      { label: '射门', value: '11:14', note: '西班牙制造了更多尝试' },
      { label: '射正', value: '5:4', note: '巴西更常打到门框范围' },
      { label: '控球', value: '42:58', note: '西班牙掌握更多球权' },
    ],
    highlight_lens: {
      title: '巴西把比分写进镜头',
      caption: '关键进球 · 禁区前沿的一脚',
      image_url: tinyPngDataUrl,
    },
    share_line: '两分钟看懂这场球的重点。',
    integrity_note: 'AI 生成内容，基于比分、战报与可用技术统计整理。',
  },
} satisfies CardPayload;

const fixtures: Record<'hardcore' | 'duanzi' | 'emotion', CardPayload> = { hardcore, duanzi, emotion };
const styles: Array<'hardcore' | 'duanzi' | 'emotion'> = ['hardcore', 'duanzi', 'emotion'];
const platforms: Platform[] = ['wechat', 'xhs', 'x'];
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderCard', () => {
  it('renders every style and platform as a correctly sized PNG', async () => {
    for (const style of styles) {
      for (const platform of platforms) {
        const buffer = await renderCard(style, platform, fixtures[style]);
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(10_000);
        expect(buffer.subarray(0, 8)).toEqual(pngHeader);
        const image = PNG.sync.read(buffer);
        expect(image.width).toBe(SIZES[platform].w);
        expect(image.height).toBe(SIZES[platform].h);
      }
    }
  }, 60_000);

  it('renders bracket (淘汰赛对阵图) as a tall BRACKET_SIZE PNG (xhs only)', async () => {
    const fin = { date: '6/29', tag: '1/16决赛', homeName: '德国', awayName: '巴拉圭', homeScore: 1, awayScore: 1, penHome: 3, penAway: 4, status: 'finished' };
    const tbd = (n: number) => Array.from({ length: n }, () => ({ date: '待定', status: 'tbd' }));
    const bracketPayload = {
      ...duanzi,
      brand: '超帧球后说 · 淘汰赛对阵图 · AI 生成',
      bracketCard: {
        title: '国际大赛淘汰赛对阵图', subtitle: '（北京时间）',
        topR32: [fin, ...tbd(7)], top16: tbd(4), top8: tbd(2), topSF: tbd(1),
        final: tbd(1), third: tbd(1), botSF: tbd(1), bot8: tbd(2), bot16: tbd(4), botR32: tbd(8),
      },
    } as unknown as CardPayload;
    const buffer = await renderCard('bracket', 'xhs', bracketPayload);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(BRACKET_SIZE.w);
    expect(image.height).toBe(BRACKET_SIZE.h);
  }, 60_000);

  it('bracket 仅支持 xhs(非 xhs 抛错)', async () => {
    await expect(renderCard('bracket', 'wechat', { bracketCard: { topR32: [], top16: [], top8: [], topSF: [], final: [], third: [], botSF: [], bot8: [], bot16: [], botR32: [] } } as unknown as CardPayload))
      .rejects.toThrow(/xhs/);
  });

  it('renders ft(官方战报风)as xhs 3:4 PNG;仅支持 xhs', async () => {
    const ftPayload = {
      ...duanzi,
      brand: '超帧球后说 · 官方战报风 · AI 生成',
      ftCard: {
        meta_line: '国际大赛 2026 · 32强赛 · Hard Rock Stadium',
        date_line: '2026.07.04 · 北京',
        progression: '半场 1:0 · 90分钟 1:1 · 加时 3:2',
        home_scorers: ["29' 梅西", "92' 劳塔罗·马丁内斯", "111' 博尔赫斯(乌龙)"],
        away_scorers: ["59' 杜阿尔特", "103' 卡布拉尔"],
        potm: '全场最佳 梅西 · 9.5（阿根廷）',
        bars: [
          { label: '控球 %', home: '64', away: '36', home_ratio: 64 },
          { label: 'xG 机会质量', home: '2.15', away: '0.36', home_ratio: 85.7 },
        ],
        timeline: [
          { minute: "29'", text: '梅西破门(劳塔罗 助)1:0' },
          { minute: '点球大战', text: '互射 2:4，埃及晋级' },
        ],
        quote: '梅西负责写诗,队友负责写惊悚片剧本',
        integrity_note: 'AI 生成内容，基于比分、战报与可用技术统计整理。',
      },
    } as unknown as CardPayload;
    const buffer = await renderCard('ft', 'xhs', ftPayload);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
    await expect(renderCard('ft', 'wechat', ftPayload)).rejects.toThrow(/xhs/);
  }, 60_000);

  it('ft 缺可选块(progression/potm/quote/bars 空)时降级渲染不崩', async () => {
    const minimalFt = {
      ...duanzi,
      ftCard: {
        meta_line: '国际大赛 2026',
        date_line: '2026.07.04 · 北京',
        home_scorers: [],
        away_scorers: [],
        bars: [],
        timeline: [],
        integrity_note: 'AI 生成内容',
      },
    } as unknown as CardPayload;
    await expect(renderCard('ft', 'xhs', minimalFt)).resolves.toBeInstanceOf(Buffer);
  }, 60_000);

  it('renders when brand contains text that upstream sanitizes', async () => {
    const buffer = await renderCard('duanzi', 'wechat', { ...duanzi, brand: 'AI 战报 · 老李 · 国际足联' });
    expect(buffer.length).toBeGreaterThan(10_000);
  });

  it('renders long duanzi xhs headline without failing layout', async () => {
    const buffer = await renderCard('duanzi', 'xhs', {
      ...duanzi,
      shareQuote: '红牌帽子戏法？墨西哥把南非踢成热锅上的辣椒',
      bodyExcerpt: '第9分钟的进球来得猝不及防，红牌又把南非的阵型直接拆开。长句也不能盖住下面的金句卡。',
      highlightMoment: {
        minute: '第67分钟',
        title: '墨西哥把比分写进镜头',
        description: '一次推进后的射门，让画面有了最醒目的主角。',
        image_url: tinyPngDataUrl,
      },
    });
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('renders long Chinese copy across share-card styles and platforms', async () => {
    const longCopy = {
      title: '红牌帽子戏法之后墨西哥如何用连续压迫把南非的反击路线彻底拆开',
      subtitle: '这是一场比分、红牌、关键镜头和情绪落点都非常密集的比赛。',
      shareQuote: '红牌帽子戏法？墨西哥把南非踢成热锅上的辣椒，重点还藏在第一个丢球后的三分钟里',
      bodyExcerpt: '第9分钟的进球来得猝不及防，红牌又把南非的阵型直接拆开。长句、镜头和金句必须各自待在自己的区域里，不能盖住下面的内容。',
      highlightMoment: {
        minute: '第67分钟',
        title: '墨西哥把比分写进镜头但这句标题故意写得很长',
        description: '一次推进后的射门，让画面有了最醒目的主角，也让分享图需要处理更长文案。',
        image_url: tinyPngDataUrl,
      },
    } satisfies Partial<CardPayload>;

    for (const style of styles) {
      for (const platform of platforms) {
        const buffer = await renderCard(style, platform, { ...fixtures[style], ...longCopy });
        expect(buffer.subarray(0, 8)).toEqual(pngHeader);
        const image = PNG.sync.read(buffer);
        expect(image.width).toBe(SIZES[platform].w);
        expect(image.height).toBe(SIZES[platform].h);
      }
    }
  }, 60_000);

  it('hardcore degrades to a valid PNG when stats are missing (no throw)', async () => {
    const minimal = {
      competition: '国际大赛小组赛', date: '2026.06.22', homeTeam: '巴西', awayTeam: '西班牙', homeScore: 2, awayScore: 1,
      title: '测试标题', shareQuote: '测试金句', brand: 'AI 战报', shortUrl: 'qiuhoushuo.com/m/test',
    } satisfies CardPayload;
    // 缺 stats 时 hardcore 三平台均降级渲染为合法 PNG（隐藏数据区），而非 500
    for (const platform of platforms) {
      const buffer = await renderCard('hardcore', platform, minimal);
      expect(buffer.subarray(0, 8)).toEqual(pngHeader);
      const image = PNG.sync.read(buffer);
      expect(image.width).toBe(SIZES[platform].w);
      expect(image.height).toBe(SIZES[platform].h);
    }
    // 部分缺失（仅缺 xG）也走降级
    await expect(renderCard('hardcore', 'wechat', { ...fixtures.hardcore, homeXG: undefined, awayXG: undefined }))
      .resolves.toBeInstanceOf(Buffer);
    // 其它风格不受影响
    await expect(renderCard('duanzi', 'wechat', minimal)).resolves.toBeInstanceOf(Buffer);
    await expect(renderCard('emotion', 'wechat', minimal)).resolves.toBeInstanceOf(Buffer);
  }, 60_000);

  it('renders highlight moment blocks when a lens moment is present', async () => {
    const withMoment = {
      ...duanzi,
      highlightMoment: {
        minute: '关键进球',
        title: '巴西把比分写进镜头',
        description: '禁区前沿的一脚，让整场球有了主画面。',
      },
    } satisfies CardPayload;

    const buffer = await renderCard('duanzi', 'wechat', withMoment);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.wechat.w);
    expect(image.height).toBe(SIZES.wechat.h);
  }, 60_000);

  it('renders highlight lens with an embedded generated image', async () => {
    const withGeneratedImage = {
      ...emotion,
      highlightMoment: {
        minute: '关键进球',
        title: '阿根廷把比分写进镜头',
        description: '一次转身后的射门，成为这张分享图最先被看见的画面。',
        image_url: tinyPngDataUrl,
        image_alt: '关键进球示意画面',
      },
    } satisfies CardPayload;

    const buffer = await renderCard('emotion', 'xhs', withGeneratedImage);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('renders the full one-image-understand card content as a PNG', async () => {
    const buffer = await renderCard('brief', 'xhs', brief);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    expect(buffer.length).toBeGreaterThan(15_000);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('renders long one-image-understand copy without overflowing the card', async () => {
    const longBrief = {
      ...brief,
      date: '2026.06.12',
      briefCard: {
        ...brief.briefCard,
        title: '一图看懂：59分钟落后到80分钟反超：韩国替补席演爽剧',
        match_line: '国际大赛 2026 - Group Stage - 1 · 2026-06-12 · 韩国 2:1 捷克', // trademark-allowed 改写:模板层不做清洗,夹具须用清洗后形态
        one_sentence_summary: '韩国 2:1 捷克，胜负手落在效率和关键回合。',
        key_reasons: [
          { title: '韩国把比分优势守到终场', evidence: '韩国替补席：我们不生产进球，我们是逆袭的搬运工。' },
          { title: '数据解释比赛体感', evidence: '比分 2:1，先用比分和战报结论解释重点。' },
          { title: '情绪落点清晰', evidence: '当 Krecij 在59分钟为捷克打破僵局时，Estadio Akron 的记分牌像在写剧情。' },
        ],
        timeline: [
          { minute: '第59分钟', text: '捷克先打破僵局' },
          { minute: '第67分钟', text: '韩国扳平比分' },
          { minute: '第80分钟', text: '韩国把比分写进镜头' },
        ],
        data_points: [
          { label: '比分', value: '2:1', note: '先用比分和战报结论解释重点' },
        ],
        share_line: '韩国替补席：我们不生产进球，我们是逆袭的搬运工',
      },
    } satisfies CardPayload;

    const buffer = await renderCard('brief', 'xhs', longBrief);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('rejects brief cards on non-xhs platforms to avoid cropping full content', async () => {
    await expect(renderCard('brief', 'x', brief)).rejects.toThrow('brief cards only support xhs platform');
    await expect(renderCard('brief', 'wechat', brief)).rejects.toThrow('brief cards only support xhs platform');
  });

  it('F67g brief 整合战术阵型:有 formation 渲合法 PNG / 无 formation 降级不崩', async () => {
    const withFormation = {
      ...brief,
      briefCard: { ...brief.briefCard, formation: { home: '4-2-3-1', away: '4-3-3' } },
    } satisfies CardPayload;
    const a = await renderCard('brief', 'xhs', withFormation);
    expect(a.subarray(0, 8)).toEqual(pngHeader);
    expect(PNG.sync.read(a).width).toBe(SIZES.xhs.w);

    // 降级:无 formation(沿用基础 brief,无 formation 字段)仍出合法 PNG
    const b = await renderCard('brief', 'xhs', brief);
    expect(b.subarray(0, 8)).toEqual(pngHeader);
    expect(PNG.sync.read(b).height).toBe(SIZES.xhs.h);

    // 单边阵型非法也不崩(降级 4-4-2)
    const oneBad = {
      ...brief,
      briefCard: { ...brief.briefCard, formation: { home: '4-2-3-1', away: 'not-a-formation' } },
    } satisfies CardPayload;
    const c = await renderCard('brief', 'xhs', oneBad);
    expect(c.subarray(0, 8)).toEqual(pngHeader);
  }, 60_000);

  it('renders brief with pathologically long reason evidence (emotion lead 300+ 字) without throwing', async () => {
    // F67c:情绪落点 evidence 取 emotion lead 可达 300 字,定高单行盒子曾拦腰切断在半字。
    const longEvidence =
      '多伦多的BMO球场今天一半是红枫叶一半是萨拉热窝咖啡——直到第21分钟，波黑前锋 J. Lukic 用一脚射门把咖啡泼向了加拿大的球门，' +
      '整座球场的情绪在那一刻被彻底点燃，看台上红白两色交织成一片喧嚣，随后加拿大用三个换人换来了一个不"多伦"的平局，' +
      '终场哨响时双方都觉得自己本可以赢，却又都没真的输——这就是小组赛该有的样子。';
    expect([...longEvidence].length).toBeGreaterThan(100);
    const longBrief = {
      ...brief,
      briefCard: {
        ...brief.briefCard,
        key_reasons: [
          { title: '加拿大三换救主把比分优势守到终场也守不住——一个不"多伦"的平局', evidence: longEvidence },
          { title: '数据解释比赛体感', evidence: '比分 1:1，先用比分和战报结论解释重点。' },
          { title: '情绪落点清晰', evidence: longEvidence },
        ],
      },
    } satisfies CardPayload;
    const buffer = await renderCard('brief', 'xhs', longBrief);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  describe('brief reasonBox 单行裁剪契约 (splitTextLines maxLines=1)', () => {
    it('短文原样返回,不加省略号', () => {
      const out = splitTextLines('控球不等于控制，射门质量才是答案。', 48, 1);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe('控球不等于控制，射门质量才是答案。');
      expect(out[0]).not.toContain('...');
    });

    it('超长文裁成单行 + 省略号,视觉长度不超 预算+3', () => {
      const long = '多伦多的BMO球场今天一半是红枫叶一半是萨拉热窝咖啡——直到第21分钟，波黑前锋 J. Lukic 用一脚射门把咖啡泼向了加拿大的球门，随后加拿大用三个换人换来了一个不"多伦"的平局。';
      expect([...long].length).toBeGreaterThan(48);
      const out = splitTextLines(long, 48, 1);
      expect(out).toHaveLength(1);
      expect(out[0]!.endsWith('...')).toBe(true);
      expect([...out[0]!].length).toBeLessThanOrEqual(48 + 3);
    });

    it('F67e evidence 走 2 行:~96 字内完整显示不省略,>96 字末行省略', () => {
      // 用户截图的韩国捷克情绪落点(~58 字)应 2 行全显、无省略号。
      const koreaCzech = '当Krejci在59分钟为捷克打破僵局时，Estadio Akron的记分牌像在写"东欧铁骑开进美洲"的剧本，但韩国替补席用两次换人把剧本撕了重写。';
      expect([...koreaCzech].length).toBeGreaterThan(48); // 单行放不下
      expect([...koreaCzech].length).toBeLessThanOrEqual(96); // 2 行放得下
      const fit = splitTextLines(koreaCzech, 48, 2);
      expect(fit).toHaveLength(2);
      expect(fit.join('')).toBe(koreaCzech); // 完整,无省略号
      expect(fit.join('')).not.toContain('...');

      // 真·超长(>96 字)才在末行省略
      const tooLong = koreaCzech + koreaCzech;
      const fit2 = splitTextLines(tooLong, 48, 2);
      expect(fit2).toHaveLength(2);
      expect(fit2[1]!.endsWith('...')).toBe(true);
    });
  });

  it('renders the tactics card with both formations as a PNG', async () => {
    const tactics = {
      ...hardcore,
      title: '战术图解',
      shareQuote: '两队首发站位，一眼看懂攻防侧重。',
      brand: '超帧球后说 · 战术图解 · AI 生成',
      tactics: { homeFormation: '4-3-3', awayFormation: '4-2-3-1' },
    } satisfies CardPayload;
    const buffer = await renderCard('tactics', 'xhs', tactics);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    expect(buffer.length).toBeGreaterThan(15_000);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('tactics falls back to 4-4-2 on missing/invalid formations and rejects non-xhs platforms', async () => {
    const noTactics = { ...hardcore, tactics: { homeFormation: 'bogus', awayFormation: '' } } satisfies CardPayload;
    await expect(renderCard('tactics', 'xhs', noTactics)).resolves.toBeInstanceOf(Buffer);
    await expect(renderCard('tactics', 'wechat', hardcore)).rejects.toThrow('tactics cards only support xhs platform');
  });

  it('renders the player-ratings card (MOTM banner + two team columns) as a PNG', async () => {
    const ratings = {
      ...hardcore,
      title: '球员评分',
      shareQuote: '全场谁踢得最好,一眼看懂。',
      brand: '超帧球后说 · 球员评分 · AI 生成',
      ratingsCard: {
        match_line: '国际大赛小组赛 · 土耳其 3:2 美国',
        motm: { name: 'Hakan Çalhanoglu', team: '土耳其', rating: 8.1, position: '中场' },
        home: {
          team: '土耳其',
          players: [
            { name: 'Arda Güler', rating: 8.7, position: '前锋', goals: 1, assists: 1 },
            { name: 'Kenan Yildiz', rating: 7.4, position: '中场', goals: 0, assists: 1 },
            { name: 'Merih Demiral', rating: 6.8, position: '后卫', goals: 0, assists: 0 },
          ],
        },
        away: {
          team: '美国',
          players: [
            { name: 'S. Berhalter', rating: 7.2, position: '中场', goals: 1, assists: 0 },
            { name: 'Tyler Adams', rating: 5.8, position: '中场', goals: 0, assists: 0 },
            { name: 'Matt Turner', rating: null, position: '门将', goals: 0, assists: 0 },
          ],
        },
        note: '球员评分为第三方数据源算法值 · AI 生成内容整理',
      },
    } satisfies CardPayload;
    const buffer = await renderCard('ratings', 'xhs', ratings);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    expect(buffer.length).toBeGreaterThan(15_000);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('player-ratings degrades when ratingsCard/motm/players are missing, and rejects non-xhs', async () => {
    // 无 ratingsCard(回退主客队名占位)、空 players、无 motm 均不崩
    await expect(renderCard('ratings', 'xhs', hardcore)).resolves.toBeInstanceOf(Buffer);
    const empty = {
      ...hardcore,
      ratingsCard: { match_line: '国际大赛 · A 0:0 B', home: { team: 'A', players: [] }, away: { team: 'B', players: [] } },
    } satisfies CardPayload;
    await expect(renderCard('ratings', 'xhs', empty)).resolves.toBeInstanceOf(Buffer);
    // 竖版卡仅 xhs
    await expect(renderCard('ratings', 'wechat', hardcore)).rejects.toThrow('ratings cards only support xhs platform');
    await expect(renderCard('ratings', 'x', hardcore)).rejects.toThrow('ratings cards only support xhs platform');
  }, 60_000);

  it('renders the scoreboard card (金靴领跑 banner + 射手榜/助攻榜 two columns) as a PNG', async () => {
    const scoreboard = {
      ...hardcore,
      title: '射手榜',
      shareQuote: '本届金靴谁领跑,一眼看懂。',
      brand: '超帧球后说 · 射手榜 · AI 生成',
      scoreboardCard: {
        title_line: '国际大赛 · 射手榜 & 助攻榜',
        asof: '数据截至 2026.06.26',
        scorers: [
          { name: 'L. Messi', team: '阿根廷', count: 5, apps: 2 },
          { name: 'K. Mbappé', team: '法国', count: 4, apps: 3 },
          { name: 'H. Çalhanoglu', team: '土耳其', count: 3, apps: 3 },
        ],
        assists: [
          { name: 'A. Isak', team: '瑞典', count: 3, apps: 3 },
          { name: 'K. De Bruyne', team: '比利时', count: 3, apps: 3 },
        ],
        note: '数据来源第三方足球数据源 · AI 生成内容整理',
      },
    } satisfies CardPayload;
    const buffer = await renderCard('scoreboard', 'xhs', scoreboard);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    expect(buffer.length).toBeGreaterThan(15_000);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('scoreboard degrades when scoreboardCard/leaders are missing, and rejects non-xhs', async () => {
    await expect(renderCard('scoreboard', 'xhs', hardcore)).resolves.toBeInstanceOf(Buffer); // 无 scoreboardCard
    const empty = { ...hardcore, scoreboardCard: { title_line: '国际大赛 · 射手榜 & 助攻榜', scorers: [], assists: [] } } satisfies CardPayload;
    await expect(renderCard('scoreboard', 'xhs', empty)).resolves.toBeInstanceOf(Buffer); // 空榜单
    await expect(renderCard('scoreboard', 'wechat', hardcore)).rejects.toThrow('scoreboard cards only support xhs platform');
    await expect(renderCard('scoreboard', 'x', hardcore)).rejects.toThrow('scoreboard cards only support xhs platform');
  }, 60_000);

  it('renders the standings card (single group, 4 teams, qualification zone) as a PNG', async () => {
    const standings = {
      ...hardcore,
      title: '积分榜',
      shareQuote: 'A组出线形势,一眼看懂。',
      brand: '超帧球后说 · 积分榜 · AI 生成',
      standingsCard: {
        title_line: '国际大赛 · A组 积分榜',
        asof: '数据截至 2026.06.26',
        rows: [
          { rank: 1, team: '墨西哥', played: 3, win: 3, draw: 0, lose: 0, goalsDiff: 6, points: 9, qualified: true },
          { rank: 2, team: '荷兰', played: 3, win: 2, draw: 0, lose: 1, goalsDiff: 3, points: 6, qualified: true },
          { rank: 3, team: '韩国', played: 3, win: 1, draw: 0, lose: 2, goalsDiff: -2, points: 3, qualified: false },
          { rank: 4, team: '沙特阿拉伯', played: 3, win: 0, draw: 0, lose: 3, goalsDiff: -7, points: 0, qualified: false },
        ],
        note: '积分/排名来自第三方足球数据源 · AI 生成内容整理',
      },
    } satisfies CardPayload;
    const buffer = await renderCard('standings', 'xhs', standings);
    expect(buffer.subarray(0, 8)).toEqual(pngHeader);
    expect(buffer.length).toBeGreaterThan(15_000);
    const image = PNG.sync.read(buffer);
    expect(image.width).toBe(SIZES.xhs.w);
    expect(image.height).toBe(SIZES.xhs.h);
  }, 60_000);

  it('standings degrades when standingsCard/rows are missing, and rejects non-xhs', async () => {
    await expect(renderCard('standings', 'xhs', hardcore)).resolves.toBeInstanceOf(Buffer); // 无 standingsCard
    const empty = { ...hardcore, standingsCard: { title_line: '国际大赛 · A组 积分榜', rows: [] } } satisfies CardPayload;
    await expect(renderCard('standings', 'xhs', empty)).resolves.toBeInstanceOf(Buffer); // 空组
    await expect(renderCard('standings', 'wechat', hardcore)).rejects.toThrow('standings cards only support xhs platform');
    await expect(renderCard('standings', 'x', hardcore)).rejects.toThrow('standings cards only support xhs platform');
  }, 60_000);

  it('withQr overlays the mini-program QR (larger PNG, same dimensions) and is opt-in', async () => {
    const base = await renderCard('hardcore', 'wechat', fixtures.hardcore);
    const qr = await renderCard('hardcore', 'wechat', fixtures.hardcore, { withQr: true });
    // 带码版:合法 PNG、尺寸不变、字节更大(码渲染进去了);默认不带码(opt-in,站外安全)。
    expect(qr.subarray(0, 8)).toEqual(pngHeader);
    const img = PNG.sync.read(qr);
    expect(img.width).toBe(SIZES.wechat.w);
    expect(img.height).toBe(SIZES.wechat.h);
    expect(qr.length).toBeGreaterThan(base.length);
  }, 60_000);

  it('红线护栏:站外平台(小红书/微博)即便 withQr:true 也强制不叠码(带码=限流封号)', async () => {
    for (const platform of ['xhs', 'x'] as Platform[]) {
      const base = await renderCard('hardcore', platform, fixtures.hardcore);
      const forced = await renderCard('hardcore', platform, fixtures.hardcore, { withQr: true });
      // 站外:withQr 被硬护栏忽略 → 与不带码完全字节相等(没有叠加任何码)。
      expect(forced.equals(base)).toBe(true);
    }
  }, 60_000);

  it('qrOverlayAllowed:只有 wechat 允许叠码', async () => {
    const { qrOverlayAllowed } = await import('../src');
    expect(qrOverlayAllowed('wechat')).toBe(true);
    expect(qrOverlayAllowed('xhs')).toBe(false);
    expect(qrOverlayAllowed('x')).toBe(false);
  });
});

// 审查回归(P3-7/P3-2):重叠修复 stackLines、无图兜底 heroFallbackText、wechat xG 成对守卫,
// 走结构断言(尺寸/不崩冒烟测覆盖不到这些)。
describe('stackLines / heroFallbackText / xG 守卫(结构回归)', () => {
  // 扁平化 satori 树取全部文字
  function treeText(node: unknown): string {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(treeText).join(' ');
    const props = (node as { props?: { children?: unknown } }).props;
    return treeText(props?.children);
  }

  it('stackLines:每行定高盒 + nowrap + 裁剪 + lineHeight:1(防多行重叠回归)', async () => {
    const { stackLines } = await import('../src/templates/wechat-layout.js');
    const out = stackLines({ lines: ['第一行很长很长很长', '第二行'], fontSize: 40, lineHeightPx: 50 }, { color: '#fff', fontWeight: 900 }) as Array<{ props: { style: Record<string, unknown> } }>;
    expect(out).toHaveLength(2);
    for (const node of out) {
      expect(node.props.style.height).toBe(50);
      expect(node.props.style.whiteSpace).toBe('nowrap');
      expect(node.props.style.overflow).toBe('hidden');
      expect(node.props.style.lineHeight).toBe(1);
      expect(node.props.style.fontSize).toBe(40);
    }
  });

  it('heroFallbackText:有 bodyExcerpt 返「本场要点」面板,全空返 null', async () => {
    const { heroFallbackText } = await import('../src/templates/wechat-layout.js');
    const { TOKENS } = await import('../src');
    const withBody = heroFallbackText({ bodyExcerpt: '本场要点正文' } as CardPayload, TOKENS.hardcore as never);
    expect(treeText(withBody)).toContain('本场要点');
    expect(treeText(withBody)).toContain('本场要点正文');
    expect(heroFallbackText({} as CardPayload, TOKENS.hardcore as never)).toBeNull();
  });

  it('wechat xG 成对守卫:只一侧有 xG → 两侧都不显(防单边不对称)', async () => {
    const { wechatLayout } = await import('../src/templates/wechat-layout.js');
    const { TOKENS } = await import('../src');
    const both = treeText(wechatLayout({ homeTeam: 'A', awayTeam: 'B', homeScore: 1, awayScore: 0, homeXG: '1.9', awayXG: '1.4', shareQuote: 'q' } as CardPayload, TOKENS.hardcore as never));
    expect(both).toContain('xG 1.9');
    const oneSide = treeText(wechatLayout({ homeTeam: 'A', awayTeam: 'B', homeScore: 1, awayScore: 0, homeXG: '1.9', shareQuote: 'q' } as CardPayload, TOKENS.hardcore as never));
    expect(oneSide).not.toContain('xG 1.9'); // 单边 xG 不显
  });
});
