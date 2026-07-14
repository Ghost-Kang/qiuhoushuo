/**
 * 阵型字符串 → 半场站位坐标（纯函数，供 tactics 模板使用）。
 *
 * 坐标系：每队只在自己半场内布点，返回分数坐标
 *   fx ∈ [0,1]  横向（0=左边线，1=右边线）
 *   fy ∈ [0,1]  纵向（0=本方球门线，1=中线）
 * 模板侧负责按主/客半场翻转并换算像素。
 */

export interface FormationDot {
  fx: number;
  fy: number;
  /** 0=门将，1..N=后场到前场的第几条线 */
  line: number;
}

const GK_FY = 0.08;
const FIRST_LINE_FY = 0.3;
const LAST_LINE_FY = 0.92;

/**
 * 解析 "4-3-3" / "4-2-3-1" 这类阵型串为各线人数。
 * 约束：1-5 条线、每线 1-6 人、外场球员合计 10（容忍少于 10——红牌/数据缺漏时仍可画）。
 * 非法输入返回 null，调用方决定降级方式。
 */
export function parseFormation(formation: string): number[] | null {
  const trimmed = (formation ?? '').trim();
  if (!/^\d(-\d){0,4}$/.test(trimmed)) return null;
  const lines = trimmed.split('-').map(Number);
  if (lines.some((n) => n < 1 || n > 6)) return null;
  const total = lines.reduce((a, b) => a + b, 0);
  if (total > 10) return null;
  return lines;
}

/**
 * 阵型 → 半场 11 个点（含门将）。非法阵型返回 null。
 * 各线纵向均匀分布于 [FIRST_LINE_FY, LAST_LINE_FY]；线内横向均匀分布。
 */
export function formationDots(formation: string): FormationDot[] | null {
  const lines = parseFormation(formation);
  if (!lines) return null;
  const dots: FormationDot[] = [{ fx: 0.5, fy: GK_FY, line: 0 }];
  const lineCount = lines.length;
  lines.forEach((players, lineIdx) => {
    const fy = lineCount === 1
      ? (FIRST_LINE_FY + LAST_LINE_FY) / 2
      : FIRST_LINE_FY + ((LAST_LINE_FY - FIRST_LINE_FY) * lineIdx) / (lineCount - 1);
    for (let i = 0; i < players; i += 1) {
      dots.push({ fx: (i + 1) / (players + 1), fy, line: lineIdx + 1 });
    }
  });
  return dots;
}
