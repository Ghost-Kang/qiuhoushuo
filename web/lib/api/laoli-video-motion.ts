export interface LaoliMetricCard {
  label: string;
  percent: number;
  homeValue?: number;
  awayValue?: number;
  suffix?: string;
}

export function buildMetricCards(lines: string[]): LaoliMetricCard[] {
  const joined = lines.join('。');
  const structured = [
    metricFromPair(joined, /射正\s*(\d+)\s*比\s*(\d+)/, '射正'),
    metricFromPair(joined, /射门\s*(\d+)\s*比\s*(\d+)/, '射门'),
    metricFromPair(joined, /控球\s*(\d+)%?\s*比\s*(\d+)%?/, '控球', '%'),
  ].filter((item): item is LaoliMetricCard => item !== null);
  const pieces = lines
    .flatMap((line) => line.split(/[；。]/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/射正|射门|控球/.test(line))
    .slice(0, 4);
  const fallback = ['胜负转折已经落定', '关键回合决定走势', '数据与赛果互相印证'];
  const textCards = (pieces.length ? pieces : fallback).map((label, index) => ({
    label: label.length > 32 ? `${label.slice(0, 32)}…` : label,
    percent: 64 + index * 8,
  }));
  return [...structured, ...textCards].slice(0, 4);
}

function metricFromPair(
  source: string,
  pattern: RegExp,
  label: string,
  suffix = '',
): LaoliMetricCard | null {
  const matched = source.match(pattern);
  if (!matched) return null;
  const homeValue = Number(matched[1]);
  const awayValue = Number(matched[2]);
  const total = homeValue + awayValue;
  return {
    label,
    homeValue,
    awayValue,
    suffix,
    percent: total > 0 ? Math.round(homeValue / total * 100) : 50,
  };
}
