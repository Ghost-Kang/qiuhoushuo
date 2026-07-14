import { describe, expect, it } from 'vitest';
import { fontSafe, shortPlayer, compactName } from '@/lib/api/player-name';

// 卡片字体 NotoSansSC 只覆盖 ASCII + Latin-1 + CJK。Latin Extended(ğ ı ş ł đ…)无字形 → 豆腐块。
describe('fontSafe(球员名渲染安全化)', () => {
  it('Latin Extended 变音符转写成 ASCII(可分解的去音标)', () => {
    expect(fontSafe('Hakan Çalhanoğlu')).toBe('Hakan Çalhanoglu'); // ç 保留(Latin-1)、ğ→g
    expect(fontSafe('Kerem Aktürkoğlu')).toBe('Kerem Aktürkoglu'); // ü 保留、ğ→g
    expect(fontSafe('Wojciech Szczęsny')).toBe('Wojciech Szczesny'); // ę→e
  });

  it('不可分解的基础字母走显式映射表', () => {
    expect(fontSafe('Kenan Yıldız')).toBe('Kenan Yildiz'); // ı→i
    expect(fontSafe('Łukasz')).toBe('Lukasz'); // Ł→L
    expect(fontSafe('İlkay')).toBe('Ilkay'); // İ→I
    expect(fontSafe('Đorđe')).toBe('Dorde'); // Đ→D、đ→d
  });

  it('Latin-1 变音符(NotoSansSC 有字形)原样保留', () => {
    expect(fontSafe('Thomas Müller')).toBe('Thomas Müller');
    expect(fontSafe('Kylian Mbappé')).toBe('Kylian Mbappé');
    expect(fontSafe('Antoine Griezmann')).toBe('Antoine Griezmann');
  });

  it('CJK 与 ASCII 原样;空值安全', () => {
    expect(fontSafe('梅西')).toBe('梅西');
    expect(fontSafe('')).toBe('');
    expect(fontSafe(undefined as unknown as string)).toBe('');
  });

  it('无映射且不可分解的字符直接丢弃,绝不渲豆腐块', () => {
    // 故意塞一个不在表里的扩展字符(例:ŧ U+0167 不可分解、无映射 → 丢弃)
    expect(fontSafe('aŧb')).toBe('ab');
  });

  it('星平面字 + 未覆盖 BMP 符号丢弃(字体子集只到 BMP,开放式 cp>=0x4e00 会放过它们成豆腐块)', () => {
    expect(fontSafe('A🟥B')).toBe('AB'); // 🟥 U+1F7E5 astral → 丢
    expect(fontSafe('𝕊tar')).toBe('tar'); // 𝕊 U+1D54A math-bold astral → 丢
    expect(fontSafe('★A●B♥')).toBe('AB'); // ★●♥ 未覆盖 BMP 符号 → 丢
  });

  it('希/西里尔重音基字母经 NFD 后仍非 ASCII → 丢弃(不留豆腐块基字母)', () => {
    expect(fontSafe('ά')).toBe(''); // ά→α(U+03B1)仍无字形 → 丢
    expect(fontSafe('Модрич')).toBe(''); // 西里尔整体丢弃
  });

  it('CJK 队名/球员名(BMP 内)保留', () => {
    expect(fontSafe('梅西')).toBe('梅西');
    expect(fontSafe('土耳其')).toBe('土耳其');
  });
});

describe('shortPlayer(取姓 + 字体安全)', () => {
  it('优先中文译名;字典查不到才取末段为姓并转写', () => {
    expect(shortPlayer('Hakan Çalhanoğlu')).toBe('恰尔汗奥卢'); // 字典命中 → 中文
    expect(shortPlayer('Sebastian Berhalter')).toBe('贝哈尔特'); // 字典命中 → 中文
    expect(shortPlayer('Zz Unknownplayer Xyz')).toBe('Xyz'); // 字典未命中 → 取姓
    expect(shortPlayer('梅西')).toBe('梅西');
  });

  it('空/占位 → 空串', () => {
    expect(shortPlayer('')).toBe('');
    expect(shortPlayer('未知球员')).toBe('');
    expect(shortPlayer('  ')).toBe('');
  });
});

describe('compactName(字体安全 + 控长)', () => {
  it('短名(≤maxChars)原样', () => {
    expect(compactName('Arda Güler', 16)).toBe('Arda Güler');
    expect(compactName('Tyler Adams', 16)).toBe('Tyler Adams');
  });

  it('长名把前面的名缩成首字母,保住姓', () => {
    expect(compactName('Sebastian Berhalter', 16)).toBe('S. Berhalter');
    expect(compactName('Christian Pulisic', 16)).toBe('C. Pulisic');
  });

  it('三段长名逐段缩首字母直到放下', () => {
    expect(compactName('Luis Javier Suarez Diaz', 16)).toBe('L. J. S. Diaz');
  });

  it('转写后再判定长度(豆腐块字符不占长)', () => {
    expect(compactName('Hakan Çalhanoğlu', 16)).toBe('Hakan Çalhanoglu'); // 恰 16,原样
    expect(compactName('Hakan Çalhanoğlu', 14)).toBe('H. Çalhanoglu'); // 超 14 → 缩
  });

  it('单段名无法缩,原样交模板兜底', () => {
    expect(compactName('Ronaldinho', 6)).toBe('Ronaldinho');
  });

  it('前导名整段被丢弃时不留孤儿空格(#5)', () => {
    expect(compactName('Модрич Smith', 16)).toBe('Smith'); // 西里尔名丢弃,不返回 " Smith"
    expect(compactName('Лука Модрич Smith', 16)).toBe('Smith'); // 多段丢弃也不留多空格
    expect(compactName('Лука Модрич', 16)).toBe(''); // 全丢弃 → 空串(非 " ")
  });
});
