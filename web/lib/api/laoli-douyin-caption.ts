/**
 * 老李抖音发帖话术（标题/简介/自评）· 唯一业务实现（NARRATION-REDESIGN Phase 1，2026-07-12）。
 *
 * 从 deploy/laoli-douyin-caption.sh 内联 python 收回代码库：不再从成片旁白反向正则猜事实，
 * 改为**与 reel 六拍弧共享同一个 ReelFactsEnvelope + selectedAngle + 全套守卫**——
 * 「视频说加时、发帖也说加时；视频抛的争议、标题抛同一个」。
 *
 * 守卫与 reel 同级（不因是发帖就放松）：中文数字白名单逐字复制、时间口径逐字、极限词遮蔽序数、
 * 「成/倍」相对数拒、平台红线（微信/搜/小程序/链接/博彩/黑哨）拒、纯 CJK 字符集。
 * 三级兜底：豆包 → DeepSeek → 按角度确定性模板；任一字段越界=该字段回退模板并记录原因（不静默清洗后继续）。
 * 删除旧脚本的危险推断：「旁白出现姆巴佩就写姆巴佩点球制胜」「每天十九秒」。
 */
import { z } from 'zod';
import { backupProvidersFor, callLLM, defaultProvider } from '../llm';
import {
  buildReelFactsEnvelope,
  spokenNumbersAllowed,
  containsRelativeMagnitude,
  violatesPlatformRedline,
  type ReelFactsEnvelope,
  type TournamentContext,
  type RecentReelHistory,
  type AngleKind,
} from './laoli-reel-story';
import {
  containsExtremeTerm,
  validateSpokenScene,
  parseTeams,
  clampBannerHook,
  type LaoliVideoReport,
} from './laoli-video-script';
import type { MatchData, ReportStyle } from '../prompts';

export type CaptionSource = 'llm' | 'mixed' | 'template';

export interface DouyinCaption {
  title: string;
  intro: string;
  self: string;
  angleId: AngleKind;
  source: CaptionSource;
  /** true = 至少一个字段回退到确定性模板（不静默）。 */
  degraded: boolean;
  /** 各字段来源/回退原因（可观测）。 */
  fields: { title: 'llm' | 'template'; intro: 'llm' | 'template'; self: 'llm' | 'template' };
  fallbackReason?: string;
}

export interface DouyinCaptionOptions {
  matchId?: string;
  /** 测试注入；不传用真 callLLM（无 key 环境秒回退模板）。 */
  llm?: typeof callLLM;
  tournament?: TournamentContext;
  recent?: RecentReelHistory;
  /** 已批准旁白（仅作 LLM 上下文提示，绝不反向解析成事实）。 */
  approvedNarration?: string;
}

const TITLE_MAX = 24;
const INTRO_MAX = 120;
const SELF_MAX = 34;

const CaptionSchema = z.object({
  title: z.string().default(''),
  intro: z.string().default(''),
  self: z.string().default(''),
});

/** 单字段守卫：任一越界 → null（该字段回退确定性模板）。与 reel scene 同级。 */
function validateField(
  text: string,
  max: number,
  allowed: Set<string>,
  timingPhases: Set<string>,
): string | null {
  const t = (text || '').trim();
  if (!t || t.length > max) return null;
  if (!validateSpokenScene(t, t)) return null; // 纯 CJK、无阿拉伯/英文/符号
  if (containsExtremeTerm(t)) return null; // 极限词（遮蔽合法序数后）
  if (containsRelativeMagnitude(t)) return null; // 成/倍
  if (!spokenNumbersAllowed(t, allowed)) return null; // 中文数字白名单
  if (violatesPlatformRedline(t)) return null; // 微信/搜/博彩/黑哨/外链
  if (t.includes('加时') && !timingPhases.has('加时')) return null; // 加时口径一致
  if (t.includes('补时') && !timingPhases.has('补时')) return null;
  return t;
}

/** 从事实清单里挑一条「有料」的中文事实（进球/红牌/数据），做模板简介的剧情句。 */
function pickMeatyFactText(envelope: ReelFactsEnvelope): string {
  const fact = envelope.facts.find((f) => /进球|点球|罚下|评分王|控球|射门|射正|预期进球/.test(f.text));
  return fact?.text ?? envelope.facts[0]?.text ?? '';
}

/** 确定性模板（按 selectedAngle 生成，全部走同一守卫，绝不越界）。 */
function templateTitle(envelope: ReelFactsEnvelope, max: number): string {
  return clampBannerHook(envelope.selectedAngle.thesis, max);
}
function templateIntro(envelope: ReelFactsEnvelope, max: number): string {
  const q = envelope.selectedAngle.openingQuestion;
  const meat = pickMeatyFactText(envelope);
  const line = meat ? `${q}${meat}。这事儿你怎么看？` : `${q}这场球的劲儿都在里头，你怎么看？`;
  return line.length <= max ? line : `${q}你怎么看？`.slice(0, max);
}
function templateSelf(envelope: ReelFactsEnvelope, max: number): string {
  const line = `${envelope.selectedAngle.openingQuestion}评论区聊聊你的判断。`;
  return line.length <= max ? line : `你觉得呢？评论区聊聊。`;
}

const CAPTION_SYSTEM_PROMPT = [
  '你是抖音体育短视频账号「老李赛后说」的发帖文案。老李是五十岁北方老球迷,唠嗑口吻、接地气、爱聊数据反差,但不靠口头禅撑内容。',
  '你要围绕**系统已经选定的同一个话题角度**,写标题、简介、自评三段发帖话术——和视频旁白说的是同一个争议,不另起话题。',
  '',
  '用户消息给四个区块:一、选定角度;二、事实清单(每条唯一编号);三、时间口径(逐字复制);四、允许数字口播词(旁白/文案所有数字只能逐字用这里的中文词)。',
  '',
  '写作要求:',
  '标题:埋中文队名 + 角度主角/看点,带悬念或反差,十四到二十四字。',
  '简介:问题或判断 → 两三拍剧情 → 数据解答 → 一个能让人站队的问题,口语、女生友好、自然不硬。',
  '自评:一句,提一个能站队的问题,老李口吻,不引战、不暗示裁判阴谋。',
  '',
  '铁律:',
  '一、所有可见文本只含汉字、姓名间隔点、中文基本标点;不得出现阿拉伯数字、英文字母、百分号、井号、表情、圈号、特殊符号。',
  '二、每个数字必须逐字来自「允许数字口播词」;不得自行换算、相减、四舍五入或组合新数字;禁止「成」「倍」相对数。',
  '三、时间说法逐字复制「时间口径」;不得把加时写成补时、补时写成加时。',
  '四、不得出现「最」「第一」「绝对」「必」「史上」等极限词(时间序数由系统规范,不得自行加「第」)。',
  '五、不得出现微信、搜索、小程序、二维码、链接、网址、公众号等站外导流;不得出现博彩、赔率、盘口、大小球、买球、下注。',
  '六、不得辱骂球员、黑哨、操纵、阴谋论,不评价球员私生活;不编造事实清单外的位置、榜单、晋级、伤病、纪录、下一场。',
  '七、不写「每天十九秒」之类固定话术,系统会另接;话题标签与站内关注由系统追加。',
  '',
  '只输出 JSON:{"title":"...","intro":"...","self":"..."}',
].join('\n');

function buildUserMessage(envelope: ReelFactsEnvelope, approvedNarration?: string): string {
  return [
    '一、选定角度',
    `id:${envelope.selectedAngle.id}`,
    `主角命题:${envelope.selectedAngle.thesis}`,
    `核心问题:${envelope.selectedAngle.openingQuestion}`,
    '',
    '二、事实清单',
    ...envelope.facts.map((f) => `[${f.id}] ${f.text}`),
    '',
    '三、时间口径(逐字复制)',
    ...(envelope.timingLabels.length ? envelope.timingLabels.map((t) => `${t.label}(${t.phase})`) : ['(无确定时间口径,禁写补时/加时)']),
    '',
    '四、允许数字口播词',
    envelope.allowedSpokenNumbers.join('、') || '(无)',
    ...(approvedNarration ? ['', '已批准视频旁白(仅供语气参考,数字仍以上面白名单为准):', approvedNarration] : []),
    '',
    '请严格输出 JSON。',
  ].join('\n');
}

/**
 * 生成抖音发帖话术。豆包→DeepSeek→模板三级;每字段独立守卫,越界即回退该字段模板并记录原因。
 * 绝不失败：最差返回全模板（degraded:true, source:'template'）。
 */
export async function buildLaoliDouyinCaption(
  match: MatchData,
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>,
  options: DouyinCaptionOptions = {},
): Promise<DouyinCaption> {
  void reports; // 事实源走 envelope，不再从旁白/战报反向猜
  const envelope = buildReelFactsEnvelope(match, { tournament: options.tournament, recent: options.recent });
  const allowed = new Set(envelope.allowedSpokenNumbers);
  const timingPhases = new Set(envelope.timingLabels.map((t) => t.phase));
  const angleId = envelope.selectedAngle.id;

  let llmTitle: string | null = null;
  let llmIntro: string | null = null;
  let llmSelf: string | null = null;

  const llm = options.llm;
  const hasLlm = Boolean(llm || process.env.DOUBAO_API_KEY || process.env.DEEPSEEK_API_KEY);
  if (hasLlm) {
    try {
      const result = await (llm || callLLM)({
        messages: [
          { role: 'system', content: CAPTION_SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(envelope, options.approvedNarration) },
        ],
        temperature: 0.6,
        maxTokens: 700,
        responseFormat: 'json',
        caller: 'laoli-douyin-caption',
        timeoutMs: 90_000,
        fallback: backupProvidersFor(defaultProvider()),
      });
      const parsed = CaptionSchema.safeParse(JSON.parse(result.content));
      if (parsed.success) {
        llmTitle = validateField(parsed.data.title, TITLE_MAX, allowed, timingPhases);
        llmIntro = validateField(parsed.data.intro, INTRO_MAX, allowed, timingPhases);
        llmSelf = validateField(parsed.data.self, SELF_MAX, allowed, timingPhases);
      }
    } catch {
      // 两家都挂/超时/非法 JSON → 全模板
    }
  }

  const title = llmTitle ?? templateTitle(envelope, TITLE_MAX);
  const intro = llmIntro ?? templateIntro(envelope, INTRO_MAX);
  const self = llmSelf ?? templateSelf(envelope, SELF_MAX);

  const fields = {
    title: (llmTitle ? 'llm' : 'template') as 'llm' | 'template',
    intro: (llmIntro ? 'llm' : 'template') as 'llm' | 'template',
    self: (llmSelf ? 'llm' : 'template') as 'llm' | 'template',
  };
  const templated = Object.entries(fields).filter(([, v]) => v === 'template').map(([k]) => k);
  const source: CaptionSource = templated.length === 0 ? 'llm' : templated.length === 3 ? 'template' : 'mixed';

  return {
    title,
    intro,
    self,
    angleId,
    source,
    degraded: templated.length > 0,
    fields,
    fallbackReason: templated.length ? `${templated.join(',')}:template` : undefined,
  };
}

/**
 * 渲染发帖 md（把原 shell python 的排版收回 TS）：话题标签 + 站内关注 CTA 由代码确定性追加，
 * 不含「每天十九秒」、不含微信/搜/小程序/外链。发布永远人工。
 */
export function renderCaptionMarkdown(
  caption: DouyinCaption,
  meta: { match: MatchData },
): string {
  const teams = parseTeams(meta.match.match);
  const scoreMatch = (meta.match.final_score || '').match(/(\d+)\s*[:\-：]\s*(\d+)/);
  const score = scoreMatch ? `${scoreMatch[1]}:${scoreMatch[2]}` : '';
  const tags = ['#国际大赛', '#足球', `#${teams.home}`, `#${teams.away}`].join(' ');
  const srcLabel = caption.source === 'llm' ? 'LLM' : caption.source === 'mixed' ? 'LLM+模板兜底' : '模板兜底';
  return [
    `# 抖音话术 · ${teams.home} ${score} ${teams.away}(老李赛后说)`,
    '',
    `> 全自动生成(${srcLabel}·角度=${caption.angleId})。发布永远人工:抖音勾「内容由 AI 生成」+ 挂合集;严禁站外导流/二维码。`,
    '',
    '## 标题',
    caption.title,
    '',
    '## 简介(整段粘,含话题)',
    caption.intro,
    // §25b 复盘落地(2026-07-13):高曝光爆款结尾确定性嵌「连载兑现钩」= 关注理由(押球/评分每场兑现),不只放低曝光连载条。
    `📌 ${REDEEM_HOOK}`,
    tags,
    '',
    '## 自评(压第一票)',
    caption.self,
    `对了,押球和评分档案每场都更、赛后原地对答案,关注老李蹲兑现别错过~`,
    '',
    '## 站内 CTA',
    '关注老李,押球评分每场兑现,别错过下一集。',
    '',
  ].join('\n');
}

/** 连载兑现钩(§25b 硬规范·爆款结尾必带·把关注理由从低曝光连载条搬进高曝光爆款) */
const REDEEM_HOOK = '押球每场赛前封存比分、赛后对答案,评分档案每场更——关注老李,别错过下一集';
