/**
 * 内容安全 / 合规审核
 *
 * 三道关卡（来自 Stage 1 合规要求）：
 * 1. 本地敏感词黑名单（O(1) 拦截，不走外部）
 * 2. 数美 / 网易易盾文本审核（体育垂类词库）
 * 3. LLM 二审（仅模糊语义场景，控成本）
 *
 * 任何返回 pass=false 的内容必须：
 * - 战报：触发降级（重试 prompt 或用模板兜底）
 * - 群聊：直接拦截不发送 + 增加该用户违规计数
 * - 主持发言：拒绝发送 + 报警（说明 prompt 控制不足）
 *
 * PROCESS §5 升级树接入（W3 5/14）：
 * - politics / discrimination 单次命中 → P1 fire-and-forget 告警
 * - 5min 内同类命中 ≥ 10 次 → P0 升级（可能 prompt 攻击 / UGC 大规模违规）
 * - event_trademark / gambling 不告警（前者是 prompt 修复信号，后者日常运营噪音过大）
 */

import { notifyOpsFireAndForget } from './alerts';
import { ensureBootGuard } from './api/boot-guard';
import { incrWindow } from './api/quota-store';
import { trackServerEventGlobal } from './api/tracker';

export type SafetyScenario = 'report' | 'host' | 'user_chat';

export interface SafetyResult {
  pass: boolean;
  /** 命中的红线类别 */
  category?: 'politics' | 'gambling' | 'porn' | 'discrimination' | 'event_trademark' | 'other';
  reason?: string;
  /** 触发的关键词或片段（debug 用，不返回前端） */
  hit?: string;
}

// 赛事商标硬约束（Stage 1 合规要求）。这些字符串本身是禁词,
// check-trademark.ts 通过行尾的 trademark-allowed 标记豁免本数组定义。
const LOCAL_BLOCKLIST_EVENT_TRADEMARK = [
  'FIFA',       // trademark-allowed
  '世界杯',      // trademark-allowed
  'WORLD CUP',  // trademark-allowed
  'World Cup',  // trademark-allowed
  'world cup',  // trademark-allowed
];

const LOCAL_BLOCKLIST_GAMBLING = [
  // 盘口 / 玩法术语（体育博彩黑话）
  '让球',
  '盘口',
  '赔率',
  '滚球',
  '亚盘',
  '欧赔',
  '初盘',
  '走盘',
  '水位',
  '上盘',
  '下盘',
  '波胆',
  '足彩',
  '胜负彩',
  '推荐扫码',
  '稳胆',
  '过关',
  '串关',
  '半全场',
  '反水',
  '让分',
  '大小球',
  '角球数',
  'AH', // 亚盘 Asian Handicap 缩写，圈内黑话
  '让平',
  '半球盘',
  '一球盘',
];

const LOCAL_BLOCKLIST_POLITICS = [
  // 分裂主义
  '台独',
  '港独',
  '藏独',
  '疆独',
  // 涉及主权 / 一中底线（体育领域常见错误表述）
  '中华民国',
  '台湾国',
  '台湾总统',
  '两个中国',
  '一中一台',
  // 敏感历史 / 政治事件名（生产必接数美 / 易盾完整词库做兜底）
  '六四',
  '法轮功',
  // 国家领导人姓名以拼音 / 谐音规避的常见变体留给远程审核处理，本地不放避免误伤新闻播报
];

/** 球员 / 球队 / 球迷常见侮辱性词（中文社区球场骂战高频）。命中即拦截。 */
const LOCAL_BLOCKLIST_DISCRIMINATION = [
  '黑鬼',
  '白皮猪',
  '黄皮',
  '棒子',
  '高丽棒子',
  '小日本',
  '鬼子',
  '阿三',
  '尼哥',
  // 体育圈对特定球员 / 教练的羞辱标签
  '同性恋' + '猪', // 拆分避免本字符串自身被搜索引擎误抓
  '基佬',
];

/**
 * 本地黑名单快速过滤。命中即返回 fail。
 */
function localCheck(text: string): SafetyResult {
  for (const w of LOCAL_BLOCKLIST_EVENT_TRADEMARK) {
    if (text.includes(w)) {
      return {
        pass: false,
        category: 'event_trademark',
        reason: `命中赛事商标禁词: ${w}`,
        hit: w,
      };
    }
  }
  for (const w of LOCAL_BLOCKLIST_GAMBLING) {
    if (text.includes(w)) {
      return { pass: false, category: 'gambling', reason: `命中博彩: ${w}`, hit: w };
    }
  }
  for (const w of LOCAL_BLOCKLIST_POLITICS) {
    if (text.includes(w)) {
      return { pass: false, category: 'politics', reason: `命中政治: ${w}`, hit: w };
    }
  }
  for (const w of LOCAL_BLOCKLIST_DISCRIMINATION) {
    if (text.includes(w)) {
      return { pass: false, category: 'discrimination', reason: `命中歧视性词: ${w}`, hit: w };
    }
  }
  return { pass: true };
}

/**
 * 主入口：先本地后远程。
 * - report 场景：本地通过即放行（数据已经是 LLM 生成，prompt 已严控；外审仅做抽查）
 * - host 场景：必走远程（AI 主持发言公开度高）
 * - user_chat 场景：必走远程（UGC 风险最高）
 */
/** 高危类别：politics / discrimination 命中即触发告警升级 */
const HIGH_RISK_CATEGORIES: Array<NonNullable<SafetyResult['category']>> = ['politics', 'discrimination'];

/** 5min 内同类命中 ≥ 此阈值 → P0 升级一次 */
const FLOOD_THRESHOLD = 10;

type SafetyEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  'NODE_ENV' | 'SHUMEI_ACCESS_KEY' | 'YIDUN_SECRET_ID' | 'YIDUN_SECRET_KEY' | 'YIDUN_BUSINESS_ID'
>>;

export function assertSafetyConfiguredForBoot(env: SafetyEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.SHUMEI_ACCESS_KEY) return;
  if (env.YIDUN_SECRET_ID && env.YIDUN_SECRET_KEY && env.YIDUN_BUSINESS_ID) return;

  const missing: string[] = [];
  if (!env.SHUMEI_ACCESS_KEY) missing.push('SHUMEI_ACCESS_KEY');
  if (!env.YIDUN_SECRET_ID) missing.push('YIDUN_SECRET_ID');
  if (!env.YIDUN_SECRET_KEY) missing.push('YIDUN_SECRET_KEY');
  if (!env.YIDUN_BUSINESS_ID) missing.push('YIDUN_BUSINESS_ID');

  ensureBootGuard({
    guard: 'safety',
    consequence: 'production 不可上线，远程内容审核 provider 未配（任一路径：SHUMEI_ACCESS_KEY 或 YIDUN 三件套完整）',
    missing,
    context: { NODE_ENV: env.NODE_ENV },
  });
}

function escalateSafetyHit(result: SafetyResult, scenario: SafetyScenario, userId?: string): void {
  if (result.pass || !result.category || !result.hit) return;
  if (!HIGH_RISK_CATEGORIES.includes(result.category)) return;

  // 单次命中：P1 fire-and-forget
  notifyOpsFireAndForget(
    {
      severity: 'P1',
      title: `safety 命中 · ${result.category}`,
      body:
        `**hit**: ${result.hit}\n` +
        `**scenario**: ${scenario}\n` +
        `**user**: ${userId ?? 'anonymous'}\n` +
        `**reason**: ${result.reason ?? '(none)'}\n\n` +
        `本地词库已拦截。如属误报请补 allowlist；如属攻击请追踪 user。`,
      tags: ['safety-hit', result.category, scenario],
    },
    {
      dedupKey: `safety-hit:${result.category}:${scenario}`,
      dedupWindowMs: 5 * 60 * 1000,
    },
  );

  // 5min 阈值计数：count == FLOOD_THRESHOLD 时升级一次 P0（不重复）
  void escalateIfFlooding(result.category);
}

async function escalateIfFlooding(category: NonNullable<SafetyResult['category']>): Promise<void> {
  try {
    const key = `safety:hit:${category}:5m`;
    const { count } = await incrWindow(key, 300);
    if (count === FLOOD_THRESHOLD) {
      notifyOpsFireAndForget(
        {
          severity: 'P0',
          title: `safety 同类命中 5min ≥ ${FLOOD_THRESHOLD} · ${category}`,
          body:
            `5min 窗口内 \`${category}\` 类已命中 ${count} 次。\n` +
            `可能场景：① prompt 注入 / 越狱攻击 ② UGC 大规模违规 ③ 词库误报扩大。\n` +
            `运营 15min 内必须介入：查 events 表近 5min 同 category 的 user_id 分布、看是否需要临时 ban。`,
          tags: ['safety-flood', category],
        },
        {
          dedupKey: `safety-flood:${category}`,
          dedupWindowMs: 30 * 60 * 1000,
        },
      );
    }
  } catch (err) {
    // 计数失败不阻断主链路，仅记 warn
    console.warn('[safety] flood counter failed:', (err as Error).message);
  }
}

export async function contentSafetyCheck(input: {
  text: string;
  scenario: SafetyScenario;
  userId?: string;
}): Promise<SafetyResult> {
  const local = localCheck(input.text);
  if (!local.pass) {
    // E043 report_safety_blocked（hit_redacted = 命中词首 2 字 + ** 防原词外泄）
    trackServerEventGlobal({
      eventId: 'E043',
      userId: input.userId ?? null,
      properties: {
        scenario: input.scenario,
        category: local.category,
        hit_redacted: local.hit ? `${local.hit.slice(0, 2)}**` : '',
      },
    });
    escalateSafetyHit(local, input.scenario, input.userId);
    return local;
  }

  // dev 环境跳过远程审核（避免 token 浪费）
  if (process.env.NODE_ENV !== 'production') {
    return { pass: true };
  }

  if (input.scenario === 'report') {
    // 战报抽样审核：每 10 篇 1 篇走远程
    if (Math.random() > 0.1) return { pass: true };
  }

  return remoteCheck(input.text, input.userId);
}

/**
 * 远程审核 placeholder。
 * 生产环境必须接入数美 / 网易易盾，并签合同 + 上线前测试。
 *
 * 实测时 P95 延迟：< 100ms（数美）/ < 150ms（易盾）
 */
async function remoteCheck(text: string, userId?: string): Promise<SafetyResult> {
  const provider = process.env.SHUMEI_ACCESS_KEY ? 'shumei' : process.env.YIDUN_SECRET_ID ? 'yidun' : null;

  if (!provider) {
    // 上线前必须接入；dev / staging 不阻断
    console.warn('[safety] 远程审核 provider 未配置，放行（不可上线生产）');
    return { pass: true };
  }

  if (provider === 'shumei') {
    return callShumei(text, userId);
  }
  return callYidun(text, userId);
}

async function callShumei(text: string, userId?: string): Promise<SafetyResult> {
  const accessKey = process.env.SHUMEI_ACCESS_KEY;
  const api = process.env.SHUMEI_TEXT_API || 'https://api-text-bj.fengkongcloud.com/text/v4';
  if (!accessKey) return { pass: true };
  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessKey,
        appId: 'qiuhoushuo',
        eventId: 'POST',
        type: 'TEXTRISK',
        data: {
          text,
          tokenId: userId || 'system',
        },
      }),
      signal: AbortSignal.timeout(2000),
    });
    const data = (await res.json()) as { code: number; riskLevel?: string; riskType?: number };
    if (data.code !== 1100) {
      console.warn('[safety] shumei error:', data);
      return { pass: true }; // 数美故障不阻断，但记录
    }
    if (data.riskLevel === 'PASS') return { pass: true };
    return {
      pass: false,
      category: 'other',
      reason: `shumei riskLevel=${data.riskLevel} riskType=${data.riskType}`,
    };
  } catch (err) {
    console.warn('[safety] shumei timeout:', (err as Error).message);
    return { pass: true };
  }
}

// 易盾文本审核 (https://support.dun.163.com/documents/2018041902?docId=152741111494086656)
// 签名算法: MD5(所有参数按 key 升序拼接 key=value + secretKey)
async function callYidun(text: string, userId?: string): Promise<SafetyResult> {
  const secretId = process.env.YIDUN_SECRET_ID;
  const secretKey = process.env.YIDUN_SECRET_KEY;
  const businessId = process.env.YIDUN_BUSINESS_ID;
  if (!secretId || !secretKey || !businessId) return { pass: true };

  const params: Record<string, string> = {
    secretId,
    businessId,
    version: 'v5.2',
    timestamp: Date.now().toString(),
    nonce: Math.random().toString(36).slice(2, 12),
    content: text.slice(0, 10_000),
    dataId: `${userId ?? 'system'}-${Date.now()}`,
  };
  params.signature = yidunSign(params, secretKey);

  try {
    const body = new URLSearchParams(params).toString();
    const res = await fetch('https://as.dun.163.com/v5/text/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(2000),
    });
    const data = (await res.json()) as YidunResp;
    if (data.code !== 200 || !data.result) {
      console.warn('[safety] yidun error:', data.code, data.msg);
      return { pass: true }; // 故障不阻断,记录
    }
    // v5.2 判定字段为 suggestion(0=通过 / 1=嫌疑 / 2=不通过),非 action。
    // 实测原始响应只有 suggestion 无 action,读 action 会恒 undefined → undefined!==0 → 全量误杀。
    const antispam = data.result.antispam;
    if (antispam.suggestion === 0) return { pass: true };
    // suggestion=1(嫌疑)暂同 2 一并拦截(实测正常样本均为 0,不误杀);后续可按场景降级为人工/限流。
    return {
      pass: false,
      category: yidunLabelToCategory(antispam.label),
      reason: `yidun suggestion=${antispam.suggestion} label=${antispam.label ?? ''}${antispam.riskDescription ? ` ${antispam.riskDescription}` : ''}`,
    };
  } catch (err) {
    console.warn('[safety] yidun timeout:', (err as Error).message);
    return { pass: true };
  }
}

interface YidunResp {
  code: number;
  msg?: string;
  result?: {
    antispam: {
      // v5.2 真实判定字段(非 action):0=通过 / 1=嫌疑 / 2=不通过
      suggestion: 0 | 1 | 2;
      label?: number;
      riskDescription?: string;
      labels?: Array<{ label: number; level: number }>;
    };
  };
}

// 易盾 label → 业务 category 映射(实测:100色情 / 200广告 / 400违禁(含赌博) / 500涉政 / 600谩骂·地域黑)。
// politics / discrimination 会触发 PROCESS §5 升级告警,故 500/600 必须映射准确;其余归 other。
export function yidunLabelToCategory(label?: number): SafetyResult['category'] {
  switch (label) {
    case 100: return 'porn';
    case 500: return 'politics';
    case 600: return 'discrimination';
    default: return 'other';
  }
}

function yidunSign(params: Record<string, string>, secretKey: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort();
  const buf = keys.map((k) => `${k}${params[k]}`).join('') + secretKey;
  // 使用 Web Crypto 不可用 (sync 需要),fallback 到 node:crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('md5').update(buf, 'utf8').digest('hex');
}

/**
 * 给所有 AI 生成内容追加合规标识（《生成式 AI 服务管理办法》要求）
 * 战报 / 主持发言 / 卡片必须显式标注「AI 生成」。
 */
export function addAIGCWatermark(content: string, mode: 'inline' | 'footer' = 'footer'): string {
  // 仅声明「AI 生成」事实，不附「已审核」背书（L08 review H4：避免过度声明/与免责矛盾）
  const tag = '【AI 生成内容】';
  return mode === 'inline' ? `${tag} ${content}` : `${content}\n\n${tag}`;
}
