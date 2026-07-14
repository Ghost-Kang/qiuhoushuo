/**
 * 球员名渲染安全化 + 取姓。
 *
 * 卡片字体只有 NotoSansSC(覆盖 ASCII + Latin-1 + CJK,**不含 Latin Extended**)。
 * /fixtures/players 的名字常带土耳其/波兰等变音符:ğ ı ş ł đ … → 渲染成豆腐块(用户报修)。
 * fontSafe:保留 Latin-1(ü é ç ñ 正常)与 CJK(中文队名),把 Latin Extended 转写成 ASCII。
 */

import { lookupPlayerZh } from '@/lib/api-football/player-names-zh';

// 不可被 NFD 分解的基础字母(NFD 只能去组合音标,这些要显式映射)。
const TRANSLIT: Record<string, string> = {
  ı: 'i', İ: 'I', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o', Ø: 'O',
  æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ħ: 'h', Ħ: 'H',
};

export function fontSafe(name: string): string {
  let out = '';
  for (const ch of name || '') {
    const cp = ch.codePointAt(0) ?? 0;
    // 保留:ASCII + Latin-1(ü é ç…)、CJK 符号/假名/Ext-A/统一表意(0x3000–0x9FFF)、全角(0xFF00–0xFFEF)。
    // 上界封顶在 BMP——加载的 NotoSansSC 子集 cmap 只到 BMP(无 astral),开放式 cp>=0x4e00 会放过
    // 🟥/𝕊 等星平面字与 ★●♥ 等未覆盖符号,渲成豆腐块,违背本函数"绝不渲豆腐块"契约。
    if (cp < 0x100 || (cp >= 0x3000 && cp <= 0x9fff) || (cp >= 0xff00 && cp <= 0xffef)) { out += ch; continue; }
    if (TRANSLIT[ch]) { out += TRANSLIT[ch]; continue; }
    const nfd = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); // 可分解(ğ→g、ş→s…)→ 去音标取基字母
    out += nfd !== ch && /^[\x00-\x7f]+$/.test(nfd) ? nfd : ''; // 仅当转写结果是纯 ASCII 才保留;否则(希/西里尔重音基字母 ά→α 仍无字形)丢弃
  }
  return out;
}

/** 取姓(末段)+ 字体安全。**优先中文译名**(lookupPlayerZh,一图看懂时间线等所有 shortPlayer 面统一中文);
 *  查不到才回退取姓。时间线行宽有限,全名会被截;"未知球员"/空/全丢弃 → 空串。 */
export function shortPlayer(player: string): string {
  const raw = (player || '').trim();
  if (!raw) return '';
  const zh = lookupPlayerZh(raw);
  if (zh) return zh;
  const parts = fontSafe(raw).split(/\s+/).filter(Boolean); // filter:丢弃字符留下的空段不算姓
  if (!parts.length || parts.join(' ') === '未知球员') return '';
  return parts[parts.length - 1]!;
}

/**
 * 字体安全 + 控长(评分卡行宽有限)。全名 ≤maxChars 原样;超了就把前面的名缩成首字母保住姓
 * (Sebastian Berhalter → S. Berhalter),比硬截 "Sebastian Berha…" 可读。单段名/姓本身超长则交模板截。
 */
export function compactName(player: string, maxChars = 16): string {
  const parts = fontSafe((player || '').trim()).split(/\s+/).filter(Boolean);
  const full = parts.join(' '); // 由 filter 后的段重组:丢弃字符不会留下孤儿空格(否则 "Модрич Smith"→" Smith")
  if ([...full].length <= maxChars || parts.length < 2) return full;
  const surname = parts[parts.length - 1]!;
  const initial = (p: string): string => [...p][0] ?? '';
  for (let keep = parts.length - 1; keep >= 1; keep--) {
    const initials = parts.slice(0, keep).map((p) => `${initial(p)}.`).join(' ');
    const candidate = `${initials} ${surname}`;
    if ([...candidate].length <= maxChars) return candidate;
  }
  return `${initial(parts[0]!)}. ${surname}`; // 姓太长,交模板兜底截断
}
