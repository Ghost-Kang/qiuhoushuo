import { describe, expect, it } from 'vitest';
import { lookupPlayerZh, normalizeName, PLAYER_ZH, PLAYER_ZH_FULL } from '@/lib/api-football/player-names-zh';

// API 名字形态不一(缩写首字母/全名/变音符)→ 归一化后查同一中文,查不到 null(调用方回退英文)。
describe('lookupPlayerZh', () => {
  it('缩写名(topscorers 形态)命中', () => {
    expect(lookupPlayerZh('L. Messi')).toBe('梅西');
    expect(lookupPlayerZh('O. Dembélé')).toBe('登贝莱');
    expect(lookupPlayerZh('E. Haaland')).toBe('哈兰德');
  });

  it('全名 + 变音符命中', () => {
    expect(lookupPlayerZh('Kylian Mbappé')).toBe('姆巴佩');
    expect(lookupPlayerZh('Vinícius Júnior')).toBe('维尼修斯');
    expect(lookupPlayerZh('Matheus Cunha')).toBe('马特乌斯·库尼亚');
    expect(lookupPlayerZh('Hakan Çalhanoğlu')).toBe('恰尔汗奥卢');
    expect(lookupPlayerZh('M. Ødegaard')).toBe('厄德高');
  });

  it('全员译名兜底(PLAYER_ZH_FULL):冷门队球员也有中文', () => {
    expect(lookupPlayerZh('Jalal Hassan')).toBe('哈桑'); // 伊拉克(原回退英文)
    expect(lookupPlayerZh('Akram Afif')).toBe('阿菲夫'); // 卡塔尔
    expect(lookupPlayerZh('Abbosbek Fayzullaev')).toBe('法伊祖拉耶夫'); // 乌兹别克
  });

  it('缩写键已有、全名键漏配的场景(评分卡传全名;2026-07-04 澳埃战三漏)', () => {
    expect(lookupPlayerZh('Jackson Irvine')).toBe('厄温'); // 澳,缩写 j irvine 已有
    expect(lookupPlayerZh('Karim Hafez')).toBe('哈菲兹'); // 埃,缩写 k hafez 已有
    expect(lookupPlayerZh('Haissem Hassan')).toBe('哈桑'); // 埃
    expect(lookupPlayerZh('D. Borges')).toBe('博尔赫斯'); // 佛得角,不在 Top5 批量之列(111' 乌龙者)
    expect(lookupPlayerZh('Gustavo Puerta')).toBe('普埃尔塔'); // 哥,缩写 g puerta 已有(2026-07-04 哥加战两漏)
    expect(lookupPlayerZh('Jhon Arias')).toBe('阿里亚斯'); // 哥,缩写 j arias 已有
    expect(lookupPlayerZh('Niko Sigur')).toBe('西居尔'); // 加,缩写 n sigur 已有(2026-07-05 加摩战三漏)
    expect(lookupPlayerZh('Jacob Shaffelburg')).toBe('沙夫尔堡'); // 加,缩写 j shaffelburg 已有
    expect(lookupPlayerZh('Yassine Bounou')).toBe('布努'); // 摩门将,全名/缩写此前双缺
    expect(lookupPlayerZh('Y. Bounou')).toBe('布努'); // 缩写一并补齐(事件时间线用缩写形)
    expect(lookupPlayerZh('Jules Koundé')).toBe('孔德'); // 法,缩写 j kounde 已有(2026-07-05 巴法战两漏;é 归一化)
    expect(lookupPlayerZh('Omar Alderete')).toBe('阿尔德雷特'); // 巴拉圭,缩写 o alderete 已有
    expect(lookupPlayerZh('Dayot Upamecano')).toBe('乌帕梅卡诺'); // 译名勘误:于帕→乌帕(主流媒体口径),全名/缩写双改
    expect(lookupPlayerZh('G. Martinelli')).toBe('马丁内利'); // 巴,缩写/全名/姓氏三键(2026-07-06 巴挪战两漏)
    expect(lookupPlayerZh('Gabriel Martinelli')).toBe('马丁内利');
    expect(lookupPlayerZh('Sander Berge')).toBe('贝尔格'); // 挪,与 Patrick Berg(贝里)不同人不同拼写
    expect(lookupPlayerZh('S. Berge')).toBe('贝尔格');
    expect(lookupPlayerZh('P. Berg')).toBe('贝里'); // 反向验证:贝里不被 berge 误伤
    expect(lookupPlayerZh('Charles De Ketelaere')).toBe('德凯特拉雷'); // 比,缩写 c de ketelaere 已有(2026-07-11 西比战评分卡漏)
    expect(lookupPlayerZh('De Ketelaere')).toBe('德凯特拉雷'); // 姓氏兜底
  });

  it('精校 PLAYER_ZH 优先于全员兜底(Güler→居莱尔,不被覆盖)', () => {
    expect(lookupPlayerZh('Arda Güler')).toBe('阿尔达·居莱尔');
  });

  it('不变量:精校字典与全员兜底字典 key 互斥(防 FULL 错译被精校掩盖、调序即冒出)', () => {
    const overlap = Object.keys(PLAYER_ZH_FULL).filter((k) => k in PLAYER_ZH);
    expect(overlap).toEqual([]); // FULL 只放未精校的名;重叠的 14 条错译(范戴克/恰尔汉奥卢…)已清,以精校为准
  });

  it('查不到 → null(调用方回退英文)', () => {
    expect(lookupPlayerZh('Zzz Nobodyxyz')).toBeNull();
    expect(lookupPlayerZh('')).toBeNull();
  });

  it('normalizeName:去变音符/点/连字符,小写,折叠空格', () => {
    expect(normalizeName('Kylian Mbappé')).toBe('kylian mbappe');
    expect(normalizeName('L. Messi')).toBe('l messi');
    expect(normalizeName('Son Heung-min')).toBe('son heung min');
  });
});
