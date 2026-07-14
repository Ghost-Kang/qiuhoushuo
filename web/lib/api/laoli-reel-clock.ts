/**
 * 老李旁白/话术重构 · 确定性「时间与数字口播」层（NARRATION-REDESIGN Phase 1，2026-07-12）。
 *
 * 职责：把比赛的原始时钟与阿拉伯数字，**确定性**转换成纯中文口播文本，供上层 LLM「逐字复制」。
 * LLM 不再从分钟数推断补时/加时，也不再自己生成中文数字——这两件事全部锁死在这里。
 *
 * 核心裁决（综合 spec §1 D1 + §2）：
 *  - 加时分层判定：优先 per-event phase（ET1/ET2/PEN）→ 其次 match 级 wentToExtraTime（存量数据即生效）
 *    → 压平且无 phase/status = 返回 null（标时间不确定，禁 LLM 写补时/加时）。
 *  - 中文数字精确集合匹配：facts 确定性生成 spokenNumberTokens，旁白只能逐字复制。
 */

/** 事件级原始时钟（尽量保留 elapsed + extra + phase；存量事件常只有 elapsed）。 */
export interface MatchClockInput {
  /** 官方主计时（H1≤45、H2≤90、ET1≤105、ET2≤120）。 */
  elapsed: number;
  /** 补时/伤停补时分钟（如 90+3 的 3）。缺省/0 = 无补时。 */
  extra?: number | null;
  /** 比赛阶段：上/下半场、加时上/下半场、点球大战。缺省 = 存量压平数据。 */
  phase?: 'H1' | 'H2' | 'ET1' | 'ET2' | 'PEN';
}

/** match 级时间上下文（下游即时判定：存量数据即可用）。 */
export interface MatchTimingContext {
  /** 原始赛果状态码（FT/AET/PEN…）。 */
  statusRaw?: string;
  /** 是否进过加时（detectOvertime 分层判定的结果）。 */
  wentToExtraTime: boolean;
}

/** 确定性时间标签。null = 信息不足，标时间不确定（禁 LLM 写补时/加时）。 */
export interface ClassifiedClock {
  phase: '常规时间' | '补时' | '加时' | '点球大战';
  /** 唯一可说的中文时间文本，如「加时一百一十二分钟」「下半场补时三分钟」。LLM 逐字复制。 */
  label: string;
  /** 可选数值（排序/判定用，不入旁白）。 */
  numericValue?: number;
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/**
 * 阿拉伯整数 → 中文整数口播（0..999，覆盖比赛分钟/加时；超范围不硬译，回退原样）。
 * 例：112→一百一十二、121→一百二十一、93→九十三、90→九十、10→十、3→三、100→一百、105→一百零五。
 */
export function toChineseInteger(n: number): string {
  if (!Number.isFinite(n)) return '';
  const neg = n < 0;
  const int = Math.trunc(Math.abs(n));
  const body = chineseIntBody(int);
  return neg ? `负${body}` : body;
}

function chineseIntBody(int: number): string {
  if (int === 0) return '零';
  if (int < 10) return CN_DIGITS[int]!;
  if (int < 20) return int === 10 ? '十' : `十${CN_DIGITS[int % 10]!}`;
  if (int < 100) {
    const tens = Math.floor(int / 10);
    const ones = int % 10;
    return `${CN_DIGITS[tens]!}十${ones ? CN_DIGITS[ones]! : ''}`;
  }
  if (int < 1000) {
    const hundreds = Math.floor(int / 100);
    const rem = int % 100;
    const head = `${CN_DIGITS[hundreds]!}百`;
    if (rem === 0) return head;
    if (rem < 10) return `${head}零${CN_DIGITS[rem]!}`; // 一百零五
    if (rem < 20) return `${head}一十${rem % 10 ? CN_DIGITS[rem % 10]! : ''}`; // 一百一十二 / 一百一十
    const tens = Math.floor(rem / 10);
    const ones = rem % 10;
    return `${head}${CN_DIGITS[tens]!}十${ones ? CN_DIGITS[ones]! : ''}`;
  }
  return String(int);
}

/**
 * 阿拉伯数字 token（可含一位小数点）→ 中文口播。小数部分逐位念。
 * 例：1.93→一点九三、0.73→零点七三、8.9→八点九、22→二十二。
 */
export function arabicNumberToSpoken(token: string): string {
  const clean = token.trim().replace(/[^\d.]/g, '');
  if (!clean) return '';
  const [intPart, fracPart] = clean.split('.');
  let out = toChineseInteger(Number(intPart || '0'));
  if (fracPart) {
    out += `点${[...fracPart].map((d) => CN_DIGITS[Number(d)] ?? '').join('')}`;
  }
  return out;
}

/** 百分数 → 中文口播。例：59→百分之五十九、100→百分之一百。 */
export function percentToSpoken(value: number): string {
  return `百分之${toChineseInteger(value)}`;
}

/** 比分/比值 → 中文口播。例：(1,2)→一比二、(3,1)→三比一。 */
export function ratioToSpoken(a: number, b: number): string {
  return `${toChineseInteger(a)}比${toChineseInteger(b)}`;
}

/**
 * 确定性时间归一化（Codex classifyMatchClock 全文实现，spec §6.2）。
 * 硬原则：
 *  - phase=PEN → 点球大战。
 *  - phase=ET1/ET2 → 加时（elapsed+extra 合计）。
 *  - phase=H1/H2 且 extra>0 → 上/下半场补时。
 *  - 无 phase 但 elapsed≤90 且 extra>0 → 补时（按 elapsed 猜上/下半场）。
 *  - 无 phase、wentToExtraTime 且 elapsed>90 → 加时。
 *  - elapsed≤90 且无 extra → 常规时间。
 *  - 其余（压平后 93/112 等无 phase/status）→ null，标时间不确定。
 */
export function classifyMatchClock(
  clock: MatchClockInput,
  timing: MatchTimingContext,
): ClassifiedClock | null {
  const extra = clock.extra ?? 0;

  if (clock.phase === 'PEN') {
    return { phase: '点球大战', label: '点球大战' };
  }

  if (clock.phase === 'ET1' || clock.phase === 'ET2') {
    const total = clock.elapsed + extra;
    return { phase: '加时', label: `加时${toChineseInteger(total)}分钟`, numericValue: total };
  }

  if (clock.phase === 'H1' && extra > 0) {
    return { phase: '补时', label: `上半场补时${toChineseInteger(extra)}分钟`, numericValue: extra };
  }

  if (clock.phase === 'H2' && extra > 0) {
    return { phase: '补时', label: `下半场补时${toChineseInteger(extra)}分钟`, numericValue: extra };
  }

  // phase 缺失时，只接受仍能无歧义判断的原始字段。
  if (clock.elapsed <= 90 && extra > 0) {
    return {
      phase: '补时',
      label: `${clock.elapsed <= 45 ? '上半场' : '下半场'}补时${toChineseInteger(extra)}分钟`,
      numericValue: extra,
    };
  }

  if (timing.wentToExtraTime && clock.elapsed > 90) {
    const total = clock.elapsed + extra;
    return { phase: '加时', label: `加时${toChineseInteger(total)}分钟`, numericValue: total };
  }

  if (clock.elapsed <= 90 && extra === 0) {
    return { phase: '常规时间', label: `${toChineseInteger(clock.elapsed)}分钟`, numericValue: clock.elapsed };
  }

  // 只剩压平后的 93、112 等 minute 且无 phase/status → 信息不足，拒绝使用时间描述。
  return null;
}

/**
 * 时间标签统一去「第」（所有分钟口播不加序数「第」，避免撞极限词守卫）。
 * 例：第一百一十二分钟 → 一百一十二分钟。
 */
export function normalizeSpokenMinute(clock: ClassifiedClock): string {
  return clock.label
    .replace(/^第/, '')
    .replace(/第(?=[零〇一二两三四五六七八九十百千万])/g, '');
}

/** 加时分段比分类型（stats.scoreBreakdown 子集）。 */
interface ScorePair {
  home: number;
  away: number;
}

/**
 * 加时分层判定（Opus detectOvertime 兜底，spec §1 D1）。三级：
 *  1. stats.scoreBreakdown.extratime 非空 → true（存量数据即生效）。
 *  2. stats.statusRaw ∈ {AET, PEN} → true。
 *  3. 兜底：90 分钟战平 + 存在 90<minute≤120 的决胜进球 → true。
 * 其余 → false。
 */
export function detectOvertime(match: {
  stats?: {
    scoreBreakdown?: { extratime?: ScorePair | null; fulltime?: ScorePair | null } | null;
    statusRaw?: string;
  };
  events?: Array<{ minute: number; type: string }>;
  final_score?: string;
}): boolean {
  const sb = match.stats?.scoreBreakdown ?? null;
  if (sb?.extratime) return true;

  const status = (match.stats?.statusRaw ?? '').toUpperCase();
  if (status === 'AET' || status === 'PEN') return true;

  // 兜底：90 分钟(fulltime 分段)战平且有 90<minute≤120 的进球。
  const ft = sb?.fulltime ?? null;
  const levelAt90 = ft ? ft.home === ft.away : false;
  const hasEtGoal = (match.events ?? []).some(
    (e) => (e.type === 'goal' || e.type === 'penalty') && e.minute > 90 && e.minute <= 120,
  );
  return levelAt90 && hasEtGoal;
}
