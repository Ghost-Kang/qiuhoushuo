import { describe, expect, it } from 'vitest';
import { translateTeam, teamFlagCode } from '../src';

describe('teamFlagCode', () => {
  it('英文队名 → ISO alpha-2 码;子区旗用三字码', () => {
    expect(teamFlagCode('Germany')).toBe('de');
    expect(teamFlagCode('Brazil')).toBe('br');
    expect(teamFlagCode('England')).toBe('eng');
    expect(teamFlagCode('Scotland')).toBe('sco');
  });

  it('中文队名也能反查(防传入已中文化的队名)', () => {
    expect(teamFlagCode('德国')).toBe('de');
    expect(teamFlagCode('库拉索')).toBe('cw');
    expect(teamFlagCode('海地')).toBe('ht');
  });

  it('拼写变体(API 偶发未译)也命中', () => {
    expect(teamFlagCode('Cape Verde Islands')).toBe('cv');
    expect(teamFlagCode('Türkiye')).toBe('tr');
    expect(teamFlagCode("Côte d'Ivoire")).toBe('ci');
  });

  it('未知队名返回空串(调用方回退,不渲染破图)', () => {
    expect(teamFlagCode('Atlantis')).toBe('');
    expect(teamFlagCode('')).toBe('');
  });

  it('凡 translateTeam 能中文化的常见队名都应有国旗码(无漏码守卫)', () => {
    const names = ['Germany', 'Brazil', 'Japan', 'Haiti', 'Curaçao', 'Suriname', 'New Caledonia', 'Tahiti', 'Wales', 'DR Congo', 'Congo DR', 'Cape Verde'];
    for (const n of names) expect(teamFlagCode(n), `${n} 应有国旗码`).not.toBe('');
  });

  // 数据源用 "Congo DR"(词序与字典里 "DR Congo" 相反)→ 此前漏译漏旗(真机实证:葡萄牙 vs Congo DR 无旗、名是英文)
  it('"Congo DR" 词序变体也命中国旗码', () => {
    expect(teamFlagCode('Congo DR')).toBe('cd');
    expect(teamFlagCode('DR Congo')).toBe('cd');
  });
});

describe('translateTeam', () => {
  it('translates主流英文队名为中文', () => {
    expect(translateTeam('Brazil')).toBe('巴西');
    expect(translateTeam('USA')).toBe('美国');
    expect(translateTeam('South Korea')).toBe('韩国');
    expect(translateTeam('Czechia')).toBe('捷克');
  });

  // 反向验证:生产实测残留的冷门队 + 非 ASCII 拼写变体(6/12 补字典)必须中文化
  it('translates冷门队与非 ASCII 拼写变体', () => {
    expect(translateTeam('Haiti')).toBe('海地');
    expect(translateTeam('Curaçao')).toBe('库拉索');
    expect(translateTeam('Türkiye')).toBe('土耳其'); // 与 Turkey 同译
    expect(translateTeam('Turkey')).toBe('土耳其');
    expect(translateTeam('Suriname')).toBe('苏里南');
    expect(translateTeam("Côte d'Ivoire")).toBe('科特迪瓦');
    expect(translateTeam('Cabo Verde')).toBe('佛得角');
    expect(translateTeam('New Caledonia')).toBe('新喀里多尼亚');
    expect(translateTeam('Congo DR')).toBe('刚果（金）'); // 词序变体,与 DR Congo 同译
    expect(translateTeam('DR Congo')).toBe('刚果（金）');
  });

  it('幂等:已是中文则原样透传,未知名也不丢', () => {
    expect(translateTeam('巴西')).toBe('巴西');
    expect(translateTeam('未知国家队')).toBe('未知国家队');
    expect(translateTeam('')).toBe('');
  });
});
