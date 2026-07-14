const test = require('node:test');
const assert = require('node:assert');
const { teamZh, flagOf, formatTeam, codeFor, TEAM_MAP } = require('../utils/teams');

test('teamZh 返回纯中文,未知队名原样返回', () => {
  assert.strictEqual(teamZh('Brazil'), '巴西');
  assert.strictEqual(teamZh('Japan'), '日本');
  assert.strictEqual(teamZh('Atlantis'), 'Atlantis');
});

test('formatTeam 兼容旧调用但只给中文(不再前缀 emoji,避免 Android 退化字母码)', () => {
  assert.strictEqual(formatTeam('Brazil'), '巴西');
  assert.doesNotMatch(formatTeam('Brazil'), /🇧🇷/);
});

test('flagOf 由 emoji 反推 ISO alpha-2 小写码 + 保留 emoji 兜底', () => {
  assert.deepStrictEqual(flagOf('Brazil'), { code: 'br', emoji: '🇧🇷' });
  assert.deepStrictEqual(flagOf('Germany'), { code: 'de', emoji: '🇩🇪' });
  assert.deepStrictEqual(flagOf('Japan'), { code: 'jp', emoji: '🇯🇵' });
});

test('flagOf 子区旗(英格兰/苏格兰/威尔士)用三字码,不走 emoji 反推', () => {
  assert.strictEqual(flagOf('England').code, 'eng');
  assert.strictEqual(flagOf('Scotland').code, 'sco');
  assert.strictEqual(flagOf('Wales').code, 'wal');
});

test('flagOf/teamZh 兼容服务端中文名(反查)——此前国旗不显示的真因', () => {
  // 服务端 translateTeam 已把队名中文化,客户端拿到的是中文,必须能反查出旗
  assert.strictEqual(flagOf('德国').code, 'de');
  assert.strictEqual(flagOf('日本').code, 'jp');
  assert.strictEqual(flagOf('库拉索').code, 'cw'); // 冷门队:此前小程序表缺 → 空白
  assert.strictEqual(flagOf('海地').code, 'ht');
  assert.strictEqual(flagOf('苏格兰').code, 'sco'); // 子区旗中文反查
  assert.strictEqual(teamZh('德国'), '德国');
});

test('flagOf 兼容服务端偶发未译英文变体', () => {
  assert.strictEqual(flagOf('Cape Verde Islands').code, 'cv');
  assert.strictEqual(flagOf('Türkiye').code, 'tr');
});

test('Congo DR(数据源词序变体)出旗 + 中文(此前无旗、名是英文)', () => {
  assert.strictEqual(flagOf('Congo DR').code, 'cd'); // 英文键直接命中
  assert.strictEqual(flagOf('刚果（金）').code, 'cd'); // 服务端中文化后反查
  assert.strictEqual(teamZh('Congo DR'), '刚果（金）');
});

test('flagOf 未知队名返回空(WXML 回退 emoji 文案,卡片不塌)', () => {
  assert.deepStrictEqual(flagOf('Atlantis'), { code: '', emoji: '' });
});

test('全表每个映射都能解析出非空 code(防新增队漏码 → 国旗图 404)', () => {
  const missing = Object.keys(TEAM_MAP).filter((n) => !codeFor(TEAM_MAP[n]));
  assert.deepStrictEqual(missing, [], `这些队名解析不出国旗码: ${missing.join(', ')}`);
});
