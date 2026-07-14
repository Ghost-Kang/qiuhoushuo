export const TRADEMARK_FORBIDDEN_TERMS = [
  'FIFA', // trademark-allowed
  '世界杯', // trademark-allowed
  'World Cup', // trademark-allowed
  'world cup', // trademark-allowed
  'WORLD CUP', // trademark-allowed
] as const;

export function sanitizeTrademarkText(value: string): string {
  return value
    .replace(/world\s*cup/gi, '国际大赛') // trademark-allowed
    .replace(/\bfifa\b/gi, '') // trademark-allowed
    .replace(/世界杯/g, '国际大赛') // trademark-allowed
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function containsTrademarkTerm(value: string): boolean {
  return TRADEMARK_FORBIDDEN_TERMS.some((term) => value.includes(term));
}
