/**
 * 作品复盘视频(16:9)章节素材卡生成器 — 同行/招聘向,克制·专业·沉稳风格。
 * 用法: cd web && ./node_modules/.bin/tsx scripts/portfolio/render-portfolio-cards.ts
 * 输出: tasks/assets/portfolio-*-20260710.png (1920×1080)
 *
 * 7/20 决赛后回填终值重渲染:只需改下面 DATA 常量里的数字/文案,重新跑一次即可。
 * 「git log / ~/.claude/agents」两张终端卡的数字取自真实命令(见 sh() 调用),会随仓库状态自动更新;
 * DATA.terminalRoster.names 是人工挑选的代表性 agent 文件名(非全量),需要人工维护。
 *
 * 红线(遵循 tasks 交办口径):
 *  - 不出现 /path/to 绝对路径 / IP / 密钥 / appid / 备案号 / 球星人名 / 「押」字 / 「养量·藏·绕·防审核」类词
 *  - 正文只用 CJK、数字、英文字母、·(禁止 unicode 箭头/序号字形,NotoSansSC 缺字会豆腐块)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const Ff = (w: string) => require.resolve(`@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-${w}-normal.woff`);
const FONTS = [
  { name: 'NotoSansSC', data: readFileSync(Ff('400')), weight: 400 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(Ff('700')), weight: 700 as const, style: 'normal' as const },
  { name: 'NotoSansSC', data: readFileSync(Ff('900')), weight: 900 as const, style: 'normal' as const },
];
// web/scripts/portfolio/render-portfolio-cards.ts -> repo root 是往上三级
const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const OUT_DIR = `${REPO_ROOT}/tasks/assets`;

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', shell: '/bin/zsh' }).trim();
}

// ────────────────────────────────────────────────────────────────────────
// 数据块(唯一改动点):所有文案/数字集中在此,7/20 决赛后回填终值只改这里。
// ────────────────────────────────────────────────────────────────────────
const FOOTER_STANDARD = '截至 2026-07-10 · 项目实测 · 终值 7/20 复核';

const DATA = {
  overview: {
    title: '成本工程',
    subtitle: '产品重设计,让最贵的路径不再被需要',
    rows: [
      { label: '口播成片 单条成本', before: '4-8 元', after: '几分钱', note: '注:结构性移除最贵生成路径 · 非降质' },
      { label: '卡片缓存命中', before: '8.5s', after: '0.12s', note: '注:网络回环问题根治' },
      { label: '赛前榜单预热', before: '792 张约 10 分钟', after: '200ms', note: '注:事件驱动预热' },
    ],
  },
  seedance: { eyebrow: '口播成片 单条成本', before: '4-8 元/条', after: '几分钱/条', caption: '结构性移除 · 非降质' },
  hairpin: { before: '8.5s', after: '0.12s', caption: '卡片缓存命中' },
  prewarm: { before: '约 10 分钟(792 张)', after: '200ms', caption: '赛前榜单预热' },
  timeline: {
    title: '每个坑,都变成一条红线',
    items: [
      { pit: '「默认自动同意」三次驳回', mid: '根因:逐页挂门,总会漏一页', redline: '根治:应用级单一卡口' },
      { pit: '人像一致性不稳', mid: '身份绑定提示词 + 分辨率升级', redline: '连跑三次全过' },
      { pit: 'shell 变量花括号写法一天踩 4 次', redline: '脚本红线 + 自查清单' },
      { pit: '险些为素材点名退役球员', redline: '红线:点名必查现役 · 素材不改事实' },
    ],
  },
  terminalCommits: {
    caption: '工艺版 · 终值 7/20 重截',
    commands: [
      { cmd: 'git log --oneline | wc -l', out: sh('git log --oneline | wc -l') },
      { cmd: "git log --reverse --format='%ad' --date=short | head -1", out: sh("git log --reverse --format='%ad' --date=short | head -1") },
    ],
  },
  terminalRoster: {
    kicker: 'AI 员工花名册 · 实盘',
    command: { cmd: 'ls ~/.claude/agents | wc -l', out: sh('ls ~/.claude/agents | wc -l') },
    names: [
      'engineering-backend-architect.md', 'engineering-frontend-developer.md',
      'engineering-code-reviewer.md', 'engineering-security-engineer.md',
      'engineering-devops-automator.md', 'engineering-database-optimizer.md',
      'product-manager.md', 'product-sprint-prioritizer.md',
      'marketing-content-creator.md', 'marketing-seo-specialist.md',
      'marketing-social-media-strategist.md', 'testing-api-tester.md',
      'testing-accessibility-auditor.md', 'sales-engineer.md',
      'finance-financial-analyst.md', 'specialized-mcp-builder.md',
      'support-analytics-reporter.md', 'project-management-project-shepherd.md',
      'deep-reasoner.md', 'fast-worker.md',
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────
// 视觉规范(7 张统一):深藏青底 · 米白正文 · 单一金色强调
// ────────────────────────────────────────────────────────────────────────
const W = 1920, H = 1080;
const BG = 'linear-gradient(155deg, #0A0D1C 0%, #131830 48%, #060710 100%)';
const TEXT = '#F0ECE0';
const GOLD = '#C7A76B';
const GOLD_BRIGHT = '#DCC08A';
const MUTED = '#8E93A8';
const DIVIDER = 'rgba(199,167,107,0.25)';
const PAD = 96, TOP_PAD = 88, BOTTOM_PAD = 64;

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
function el(type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  let p = props || {};
  if (type === 'div') { const s = (p.style || {}) as Record<string, unknown>; if (!s.display) p = { ...p, style: { display: 'flex', ...s } }; }
  return { type, props: { ...p, children: kids.length === 1 ? kids[0] : kids } };
}

const rootDiv = (children: Node[]): Node => el('div', {
  style: { width: W, height: H, flexDirection: 'column', backgroundImage: BG, fontFamily: 'NotoSansSC', position: 'relative', padding: `${TOP_PAD}px ${PAD}px ${BOTTOM_PAD}px` },
}, ...children);

const footer = (text: string): Node => el('div', {
  style: { position: 'absolute', left: 0, right: PAD, bottom: 40, justifyContent: 'flex-end', color: MUTED, fontSize: 26, fontWeight: 400 },
}, text);

// 前→后对比一律用布局表达:上下排列 — 前值(米白/浅灰、删除线)叠在后值(金色、加粗放大)之上,
// 不用 unicode 箭头字形。(footnote: satori 不支持 CSS border 三角拼接技巧 —— 实测会渲染成实心矩形
// 而非三角形,故弃用该方案,改走「上下排列」这条 spec 允许的备选路径。)
const beforeAfter = (before: string, after: string, beforeFs: number, afterFs: number, gap: number): Node => el('div', { style: { flexDirection: 'column' } },
  el('div', { style: { color: MUTED, fontSize: beforeFs, fontWeight: 700, textDecoration: 'line-through' } }, before),
  el('div', { style: { color: GOLD_BRIGHT, fontSize: afterFs, fontWeight: 900, marginTop: gap } }, after),
);

const dot = (color: string): Node => el('div', { style: { width: 16, height: 16, borderRadius: 999, backgroundColor: color } });

function terminalWindow(w: number, commands: { cmd: string; out: string }[]): Node {
  // 高度不写死:内容(topbar + 命令行)自然撑开,避免固定高度裁掉后面的命令输出行。
  return el('div', { style: { width: w, flexDirection: 'column', backgroundColor: '#0A0C14', border: `1px solid ${DIVIDER}`, borderRadius: 20, overflow: 'hidden' } },
    el('div', { style: { height: 56, alignItems: 'center', paddingLeft: 28, gap: 14, backgroundColor: '#11141F' } },
      dot('#FF5F57'), dot('#FEBC2E'), dot('#28C840')),
    el('div', { style: { flexDirection: 'column', padding: '44px 48px', gap: 30 } },
      ...commands.map((c) => el('div', { style: { flexDirection: 'column' } },
        el('div', { style: { color: TEXT, fontSize: 34, fontWeight: 400, letterSpacing: 1 } }, `$ ${c.cmd}`),
        el('div', { style: { color: GOLD_BRIGHT, fontSize: 34, fontWeight: 700, marginTop: 14, letterSpacing: 1 } }, c.out),
      )),
    ),
  );
}

// ── Card 1: 成本工程总览 ──────────────────────────────────────────────
// 三组数据横向三栏并列(每栏:小标题/划线旧值/金色大字新值/注),
// 用满整幅画布宽度并在剩余高度内垂直居中,替代原先纵向堆叠导致右半画布空白的问题。
function buildOverview(): Node {
  const { title, subtitle, rows } = DATA.overview;
  const colEls: Node[] = [];
  rows.forEach((r, i) => {
    colEls.push(el('div', { style: { flex: 1, flexDirection: 'column' } },
      el('div', { style: { color: GOLD, fontSize: 28, fontWeight: 700 } }, r.label),
      el('div', { style: { marginTop: 26 } }, beforeAfter(r.before, r.after, 32, 58, 10)),
      el('div', { style: { color: MUTED, fontSize: 22, fontWeight: 400, marginTop: 22, lineHeight: 1.4 } }, r.note),
    ));
    if (i < rows.length - 1) {
      colEls.push(el('div', { style: { width: 1, alignSelf: 'stretch', backgroundColor: DIVIDER, marginLeft: 56, marginRight: 56 } }));
    }
  });
  return rootDiv([
    el('div', { style: { flexDirection: 'column' } },
      el('div', { style: { color: TEXT, fontSize: 88, fontWeight: 900, lineHeight: 1.05 } }, title),
      el('div', { style: { color: MUTED, fontSize: 34, fontWeight: 400, marginTop: 16 } }, subtitle),
    ),
    el('div', { style: { flexGrow: 1, flexDirection: 'column', justifyContent: 'center' } },
      el('div', { style: { flexDirection: 'row', alignItems: 'flex-start' } }, ...colEls),
    ),
    footer(FOOTER_STANDARD),
  ]);
}

// ── Card 2/3/4: 单项大数字卡 ──────────────────────────────────────────
function buildSingleMetric(before: string, after: string, caption: string, eyebrow?: string): Node {
  return rootDiv([
    eyebrow
      ? el('div', { style: { color: GOLD, fontSize: 40, fontWeight: 700, alignSelf: 'center', marginTop: 24 } }, eyebrow)
      : el('div', { style: { height: 40 } }),
    el('div', { style: { flexGrow: 1, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' } },
      el('div', { style: { flexDirection: 'column', alignItems: 'center' } },
        beforeAfter(before, after, 68, 152, 20),
      ),
      el('div', { style: { color: MUTED, fontSize: 42, fontWeight: 400, marginTop: 44 } }, caption),
    ),
    footer(FOOTER_STANDARD),
  ]);
}

// ── Card 5: 失败时间轴 ────────────────────────────────────────────────
// 全角引号(「『)字形在字身框内偏右,同样左内边距下视觉上比其他汉字/字母起始更靠右,
// 用负 marginLeft 做光学补偿,统一各条目标题左缘。
function pitIndentFix(text: string): number {
  return text.startsWith('「') || text.startsWith('『') ? -22 : 0;
}

// 行高按「标题 +(mid?)+ 红线」的实际内容估算,再统一加一段固定留白(ROW_GAP)。
// 这样不管条目有没有 mid 行,内容块结束到下一条目标题开始的视觉间距都相等 —— 真正的等间距节奏;
// 若简单钉死同一行高,3 行内容的条目会被挤到近乎溢出,2 行内容的条目又会留白过多(已实测踩过)。
const TIMELINE_TITLE_FS = 46, TIMELINE_MID_FS = 30, TIMELINE_REDLINE_FS = 32;
const TIMELINE_LINE_H = 1.2, TIMELINE_ROW_GAP = 48;
function timelineRowHeight(hasMid: boolean): number {
  const titleH = TIMELINE_TITLE_FS * TIMELINE_LINE_H;
  const midH = hasMid ? 12 + TIMELINE_MID_FS * TIMELINE_LINE_H : 0;
  const redlineH = 12 + TIMELINE_REDLINE_FS * TIMELINE_LINE_H;
  return Math.round(titleH + midH + redlineH + TIMELINE_ROW_GAP);
}

function timelineRow(item: { pit: string; mid?: string; redline: string }, isLast: boolean): Node {
  const rowH = timelineRowHeight(!!item.mid);
  return el('div', { style: { flexDirection: 'row', height: rowH } },
    el('div', { style: { width: 44, flexDirection: 'column', alignItems: 'center', height: rowH } },
      el('div', { style: { width: 22, height: 22, borderRadius: 999, backgroundColor: GOLD_BRIGHT, flexShrink: 0 } }),
      isLast
        ? el('div', { style: { width: 2 } })
        : el('div', { style: { width: 2, flexGrow: 1, backgroundColor: DIVIDER, marginTop: 8 } }),
    ),
    el('div', { style: { flexDirection: 'column', marginLeft: 36, justifyContent: 'flex-start' } },
      el('div', { style: { color: TEXT, fontSize: TIMELINE_TITLE_FS, fontWeight: 800, marginLeft: pitIndentFix(item.pit) } }, item.pit),
      item.mid ? el('div', { style: { color: MUTED, fontSize: TIMELINE_MID_FS, fontWeight: 400, marginTop: 12 } }, item.mid) : el('div', {}),
      el('div', { style: { color: GOLD_BRIGHT, fontSize: TIMELINE_REDLINE_FS, fontWeight: 700, marginTop: 12 } }, item.redline),
    ),
  );
}

function buildTimeline(): Node {
  const { title, items } = DATA.timeline;
  return rootDiv([
    el('div', { style: { color: TEXT, fontSize: 88, fontWeight: 900, lineHeight: 1.08 } }, title),
    el('div', { style: { flexDirection: 'column', marginTop: 48 } },
      ...items.map((it, i) => timelineRow(it, i === items.length - 1))),
    footer(FOOTER_STANDARD),
  ]);
}

// ── Card 6: 终端 · 提交节奏 ───────────────────────────────────────────
function buildTerminalCommits(): Node {
  const { caption, commands } = DATA.terminalCommits;
  return rootDiv([
    el('div', { style: { flexGrow: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
      terminalWindow(1500, commands),
      el('div', { style: { color: MUTED, fontSize: 30, marginTop: 32 } }, caption),
    ),
    footer(FOOTER_STANDARD),
  ]);
}

// ── Card 7: 终端 · AI 员工花名册 ─────────────────────────────────────
function buildTerminalRoster(): Node {
  const { kicker, command, names } = DATA.terminalRoster;
  const cols = 4;
  const cellW = (W - PAD * 2 - 48 * (cols - 1)) / cols;
  const grid: string[][] = [];
  for (let i = 0; i < names.length; i += cols) grid.push(names.slice(i, i + cols));
  return rootDiv([
    el('div', { style: { flexGrow: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
      el('div', { style: { color: GOLD, fontSize: 44, fontWeight: 700 } }, kicker),
      el('div', { style: { marginTop: 40 } }, terminalWindow(1300, [command])),
      el('div', { style: { flexDirection: 'column', marginTop: 52, gap: 26 } },
        ...grid.map((rowNames) => el('div', { style: { flexDirection: 'row', gap: 48 } },
          ...rowNames.map((n) => el('div', { style: { flexDirection: 'row', alignItems: 'center', width: cellW, gap: 16 } },
            el('div', { style: { width: 10, height: 10, borderRadius: 999, backgroundColor: GOLD_BRIGHT, flexShrink: 0 } }),
            el('div', { style: { color: TEXT, fontSize: 28, fontWeight: 400 } }, n),
          )),
        )),
      ),
    ),
    footer(FOOTER_STANDARD),
  ]);
}

// ────────────────────────────────────────────────────────────────────────
async function renderOne(tree: Node, out: string): Promise<void> {
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts: FONTS });
  const png = new Resvg(svg, { background: '#060710' }).render().asPng();
  writeFileSync(out, png);
  console.log('WROTE', out, png.length);
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  await renderOne(buildOverview(), `${OUT_DIR}/portfolio-cost-overview-20260710.png`);
  await renderOne(buildSingleMetric(DATA.seedance.before, DATA.seedance.after, DATA.seedance.caption, DATA.seedance.eyebrow), `${OUT_DIR}/portfolio-cost-seedance-20260710.png`);
  await renderOne(buildSingleMetric(DATA.hairpin.before, DATA.hairpin.after, DATA.hairpin.caption), `${OUT_DIR}/portfolio-cost-hairpin-20260710.png`);
  await renderOne(buildSingleMetric(DATA.prewarm.before, DATA.prewarm.after, DATA.prewarm.caption), `${OUT_DIR}/portfolio-cost-prewarm-20260710.png`);
  await renderOne(buildTimeline(), `${OUT_DIR}/portfolio-failure-timeline-20260710.png`);
  await renderOne(buildTerminalCommits(), `${OUT_DIR}/portfolio-terminal-commits-20260710.png`);
  await renderOne(buildTerminalRoster(), `${OUT_DIR}/portfolio-terminal-roster-20260710.png`);
})();
