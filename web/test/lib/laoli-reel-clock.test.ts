import { describe, expect, it } from 'vitest';
import {
  classifyMatchClock,
  detectOvertime,
  toChineseInteger,
  arabicNumberToSpoken,
  percentToSpoken,
  ratioToSpoken,
  normalizeSpokenMinute,
} from '@/lib/api/laoli-reel-clock';

describe('toChineseInteger', () => {
  it('覆盖比赛分钟/加时的整数区间', () => {
    expect(toChineseInteger(0)).toBe('零');
    expect(toChineseInteger(3)).toBe('三');
    expect(toChineseInteger(10)).toBe('十');
    expect(toChineseInteger(12)).toBe('十二');
    expect(toChineseInteger(22)).toBe('二十二');
    expect(toChineseInteger(90)).toBe('九十');
    expect(toChineseInteger(93)).toBe('九十三');
    expect(toChineseInteger(100)).toBe('一百');
    expect(toChineseInteger(105)).toBe('一百零五');
    expect(toChineseInteger(110)).toBe('一百一十');
    expect(toChineseInteger(112)).toBe('一百一十二');
    expect(toChineseInteger(121)).toBe('一百二十一');
  });
});

describe('阿拉伯 → 中文口播', () => {
  it('小数逐位念', () => {
    expect(arabicNumberToSpoken('1.93')).toBe('一点九三');
    expect(arabicNumberToSpoken('0.73')).toBe('零点七三');
    expect(arabicNumberToSpoken('8.9')).toBe('八点九');
    expect(arabicNumberToSpoken('22')).toBe('二十二');
  });
  it('百分数 / 比分', () => {
    expect(percentToSpoken(59)).toBe('百分之五十九');
    expect(percentToSpoken(100)).toBe('百分之一百');
    expect(ratioToSpoken(1, 2)).toBe('一比二');
    expect(ratioToSpoken(3, 1)).toBe('三比一');
  });
});

describe('classifyMatchClock（加时分层判定）', () => {
  // 4. 加时九十三分钟：elapsed=93, phase=ET1 → 加时，不得出现补时
  it('elapsed=93 phase=ET1 → 加时九十三分钟（非补时）', () => {
    const c = classifyMatchClock({ elapsed: 93, phase: 'ET1' }, { wentToExtraTime: true });
    expect(c).toEqual({ phase: '加时', label: '加时九十三分钟', numericValue: 93 });
    expect(c!.label).not.toContain('补时');
  });

  // 5. 加时一百一十二分钟
  it('elapsed=112 phase=ET2 → 加时一百一十二分钟', () => {
    expect(classifyMatchClock({ elapsed: 112, phase: 'ET2' }, { wentToExtraTime: true }))
      .toEqual({ phase: '加时', label: '加时一百一十二分钟', numericValue: 112 });
  });

  // 6. 加时一百二十一分钟（不得归点球/补时）
  it('elapsed=120 extra=1 phase=ET2 → 加时一百二十一分钟', () => {
    const c = classifyMatchClock({ elapsed: 120, extra: 1, phase: 'ET2' }, { wentToExtraTime: true });
    expect(c).toEqual({ phase: '加时', label: '加时一百二十一分钟', numericValue: 121 });
    expect(c!.phase).not.toBe('点球大战');
  });

  // 7. 正常补时识别：不得误判加时
  it('elapsed=90 extra=3 phase=H2 → 下半场补时三分钟（非加时九十三）', () => {
    const c = classifyMatchClock({ elapsed: 90, extra: 3, phase: 'H2' }, { wentToExtraTime: false });
    expect(c).toEqual({ phase: '补时', label: '下半场补时三分钟', numericValue: 3 });
    expect(c!.label).not.toContain('加时');
  });

  it('elapsed=45 extra=2 phase=H1 → 上半场补时两分钟', () => {
    expect(classifyMatchClock({ elapsed: 45, extra: 2, phase: 'H1' }, { wentToExtraTime: false }))
      .toEqual({ phase: '补时', label: '上半场补时二分钟', numericValue: 2 });
  });

  it('phase=PEN → 点球大战', () => {
    expect(classifyMatchClock({ elapsed: 120, phase: 'PEN' }, { wentToExtraTime: true }))
      .toEqual({ phase: '点球大战', label: '点球大战' });
  });

  it('常规时间：elapsed=72 无 extra → 七十二分钟', () => {
    expect(classifyMatchClock({ elapsed: 72 }, { wentToExtraTime: false }))
      .toEqual({ phase: '常规时间', label: '七十二分钟', numericValue: 72 });
  });

  // 8. 压平分钟拒绝猜测：仅 minute=93，无 phase/extra、无加时信号 → null
  it('压平 minute=93、无 phase/status、未进加时 → null（时间不确定，禁写补时/加时）', () => {
    expect(classifyMatchClock({ elapsed: 93 }, { wentToExtraTime: false })).toBeNull();
  });

  it('压平 minute=93 但 match 级 wentToExtraTime=true → 下游即时判定为加时', () => {
    expect(classifyMatchClock({ elapsed: 93 }, { wentToExtraTime: true }))
      .toEqual({ phase: '加时', label: '加时九十三分钟', numericValue: 93 });
  });
});

describe('detectOvertime（三级分层）', () => {
  it('scoreBreakdown.extratime 非空 → true（存量数据即生效）', () => {
    expect(detectOvertime({ stats: { scoreBreakdown: { extratime: { home: 1, away: 0 } } } })).toBe(true);
  });
  it('statusRaw ∈ {AET,PEN} → true', () => {
    expect(detectOvertime({ stats: { statusRaw: 'AET' } })).toBe(true);
    expect(detectOvertime({ stats: { statusRaw: 'PEN' } })).toBe(true);
  });
  it('兜底：90 分钟战平 + 90<minute≤120 进球 → true', () => {
    expect(detectOvertime({
      stats: { scoreBreakdown: { fulltime: { home: 1, away: 1 } } },
      events: [{ minute: 112, type: 'goal' }],
    })).toBe(true);
  });
  it('普通 FT（无加时信号）→ false', () => {
    expect(detectOvertime({ stats: { statusRaw: 'FT' }, events: [{ minute: 93, type: 'goal' }] })).toBe(false);
  });
});

describe('normalizeSpokenMinute', () => {
  it('去掉序数「第」', () => {
    expect(normalizeSpokenMinute({ phase: '加时', label: '第一百一十二分钟' })).toBe('一百一十二分钟');
    expect(normalizeSpokenMinute({ phase: '加时', label: '加时一百一十二分钟' })).toBe('加时一百一十二分钟');
  });
});
