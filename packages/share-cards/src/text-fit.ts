export type TextFit = {
  fontSize: number;
  charsPerLine: number;
  lineHeight: number;
  maxLines: number;
};

export type TextFitRule = Partial<TextFit> & {
  minLength: number;
};

export function splitTextLines(value: string, charsPerLine: number, maxLines: number) {
  const chars = [...value];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += charsPerLine) {
    lines.push(chars.slice(i, i + charsPerLine).join(''));
  }

  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    const last = clipped[maxLines - 1] || '';
    clipped[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}...` : '...';
    return clipped;
  }

  return lines;
}

export function fitText(
  value: string | undefined,
  fallback: string,
  base: TextFit,
  rules: TextFitRule[] = [],
) {
  const text = value || fallback;
  const length = [...text].length;
  const rule = rules
    .slice()
    .sort((a, b) => b.minLength - a.minLength)
    .find((candidate) => length >= candidate.minLength);
  const fit = { ...base, ...(rule || {}) };
  return {
    ...fit,
    text,
    lines: splitTextLines(text, fit.charsPerLine, fit.maxLines),
    lineHeightPx: Math.ceil(fit.fontSize * fit.lineHeight),
  };
}
