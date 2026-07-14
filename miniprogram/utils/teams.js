// 2026 国际大赛球队名称映射：API-Football 英文名 → 国旗 emoji + 中文名
const TEAM_MAP = {
  // CONMEBOL
  'Argentina':             { flag: '🇦🇷', zh: '阿根廷' },
  'Brazil':                { flag: '🇧🇷', zh: '巴西' },
  'Colombia':              { flag: '🇨🇴', zh: '哥伦比亚' },
  'Ecuador':               { flag: '🇪🇨', zh: '厄瓜多尔' },
  'Uruguay':               { flag: '🇺🇾', zh: '乌拉圭' },
  'Venezuela':             { flag: '🇻🇪', zh: '委内瑞拉' },
  'Chile':                 { flag: '🇨🇱', zh: '智利' },
  'Bolivia':               { flag: '🇧🇴', zh: '玻利维亚' },
  'Paraguay':              { flag: '🇵🇾', zh: '巴拉圭' },
  'Peru':                  { flag: '🇵🇪', zh: '秘鲁' },

  // CONCACAF
  'USA':                   { flag: '🇺🇸', zh: '美国' },
  'United States':         { flag: '🇺🇸', zh: '美国' },
  'Mexico':                { flag: '🇲🇽', zh: '墨西哥' },
  'Canada':                { flag: '🇨🇦', zh: '加拿大' },
  'Costa Rica':            { flag: '🇨🇷', zh: '哥斯达黎加' },
  'Honduras':              { flag: '🇭🇳', zh: '洪都拉斯' },
  'Jamaica':               { flag: '🇯🇲', zh: '牙买加' },
  'Panama':                { flag: '🇵🇦', zh: '巴拿马' },
  'El Salvador':           { flag: '🇸🇻', zh: '萨尔瓦多' },
  'Trinidad and Tobago':   { flag: '🇹🇹', zh: '特立尼达和多巴哥' },
  'Cuba':                  { flag: '🇨🇺', zh: '古巴' },
  'Guatemala':             { flag: '🇬🇹', zh: '危地马拉' },

  // UEFA
  'Spain':                 { flag: '🇪🇸', zh: '西班牙' },
  'France':                { flag: '🇫🇷', zh: '法国' },
  'Germany':               { flag: '🇩🇪', zh: '德国' },
  'England':               { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', zh: '英格兰' },
  'Portugal':              { flag: '🇵🇹', zh: '葡萄牙' },
  'Netherlands':           { flag: '🇳🇱', zh: '荷兰' },
  'Italy':                 { flag: '🇮🇹', zh: '意大利' },
  'Belgium':               { flag: '🇧🇪', zh: '比利时' },
  'Croatia':               { flag: '🇭🇷', zh: '克罗地亚' },
  'Poland':                { flag: '🇵🇱', zh: '波兰' },
  'Denmark':               { flag: '🇩🇰', zh: '丹麦' },
  'Austria':               { flag: '🇦🇹', zh: '奥地利' },
  'Switzerland':           { flag: '🇨🇭', zh: '瑞士' },
  'Scotland':              { flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', zh: '苏格兰' },
  'Turkey':                { flag: '🇹🇷', zh: '土耳其' },
  'Romania':               { flag: '🇷🇴', zh: '罗马尼亚' },
  'Serbia':                { flag: '🇷🇸', zh: '塞尔维亚' },
  'Ukraine':               { flag: '🇺🇦', zh: '乌克兰' },
  'Hungary':               { flag: '🇭🇺', zh: '匈牙利' },
  'Czech Republic':        { flag: '🇨🇿', zh: '捷克' },
  'Czechia':               { flag: '🇨🇿', zh: '捷克' },
  'Slovakia':              { flag: '🇸🇰', zh: '斯洛伐克' },
  'Slovenia':              { flag: '🇸🇮', zh: '斯洛文尼亚' },
  'Albania':               { flag: '🇦🇱', zh: '阿尔巴尼亚' },
  'Bosnia':                { flag: '🇧🇦', zh: '波黑' },
  'Bosnia & Herzegovina':  { flag: '🇧🇦', zh: '波黑' },
  'Bosnia and Herzegovina':{ flag: '🇧🇦', zh: '波黑' },
  'Georgia':               { flag: '🇬🇪', zh: '格鲁吉亚' },
  'Greece':                { flag: '🇬🇷', zh: '希腊' },
  'Norway':                { flag: '🇳🇴', zh: '挪威' },
  'Sweden':                { flag: '🇸🇪', zh: '瑞典' },
  'Wales':                 { flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', zh: '威尔士' },
  'Iceland':               { flag: '🇮🇸', zh: '冰岛' },

  // CAF
  'Morocco':               { flag: '🇲🇦', zh: '摩洛哥' },
  'Senegal':               { flag: '🇸🇳', zh: '塞内加尔' },
  'Cameroon':              { flag: '🇨🇲', zh: '喀麦隆' },
  'Egypt':                 { flag: '🇪🇬', zh: '埃及' },
  'South Africa':          { flag: '🇿🇦', zh: '南非' },
  "Ivory Coast":           { flag: '🇨🇮', zh: '科特迪瓦' },
  "Cote d'Ivoire":         { flag: '🇨🇮', zh: '科特迪瓦' },
  'Nigeria':               { flag: '🇳🇬', zh: '尼日利亚' },
  'DR Congo':              { flag: '🇨🇩', zh: '刚果（金）' },
  'Congo DR':              { flag: '🇨🇩', zh: '刚果（金）' }, // 数据源用 "Congo DR"(词序反),英文键也要命中
  'Tunisia':               { flag: '🇹🇳', zh: '突尼斯' },
  'Algeria':               { flag: '🇩🇿', zh: '阿尔及利亚' },
  'Mali':                  { flag: '🇲🇱', zh: '马里' },
  'Ghana':                 { flag: '🇬🇭', zh: '加纳' },
  'Guinea':                { flag: '🇬🇳', zh: '几内亚' },
  'Tanzania':              { flag: '🇹🇿', zh: '坦桑尼亚' },
  'Zambia':                { flag: '🇿🇲', zh: '赞比亚' },
  'Uganda':                { flag: '🇺🇬', zh: '乌干达' },
  'Cape Verde':            { flag: '🇨🇻', zh: '佛得角' },

  // AFC
  'Japan':                 { flag: '🇯🇵', zh: '日本' },
  'South Korea':           { flag: '🇰🇷', zh: '韩国' },
  'Korea Republic':        { flag: '🇰🇷', zh: '韩国' },
  'Iran':                  { flag: '🇮🇷', zh: '伊朗' },
  'Saudi Arabia':          { flag: '🇸🇦', zh: '沙特阿拉伯' },
  'Australia':             { flag: '🇦🇺', zh: '澳大利亚' },
  'Qatar':                 { flag: '🇶🇦', zh: '卡塔尔' },
  'Jordan':                { flag: '🇯🇴', zh: '约旦' },
  'Uzbekistan':            { flag: '🇺🇿', zh: '乌兹别克斯坦' },
  'Iraq':                  { flag: '🇮🇶', zh: '伊拉克' },
  'China':                 { flag: '🇨🇳', zh: '中国' },
  'China PR':              { flag: '🇨🇳', zh: '中国' },
  'Indonesia':             { flag: '🇮🇩', zh: '印度尼西亚' },
  'UAE':                   { flag: '🇦🇪', zh: '阿联酋' },
  'United Arab Emirates':  { flag: '🇦🇪', zh: '阿联酋' },
  'Bahrain':               { flag: '🇧🇭', zh: '巴林' },
  'Oman':                  { flag: '🇴🇲', zh: '阿曼' },
  'Kuwait':                { flag: '🇰🇼', zh: '科威特' },
  'Palestine':             { flag: '🇵🇸', zh: '巴勒斯坦' },
  'Kyrgyzstan':            { flag: '🇰🇬', zh: '吉尔吉斯斯坦' },
  'Tajikistan':            { flag: '🇹🇯', zh: '塔吉克斯坦' },

  // OFC
  'New Zealand':           { flag: '🇳🇿', zh: '新西兰' },
  'New Caledonia':         { flag: '🇳🇨', zh: '新喀里多尼亚' },
  'Tahiti':                { flag: '🇵🇫', zh: '塔希提' },

  // 与 web translateTeam 对齐的冷门队 + 拼写变体(服务端可能下发的中文名/未译英文名都要能解析出旗)
  'Haiti':                 { flag: '🇭🇹', zh: '海地' },
  'Curaçao':               { flag: '🇨🇼', zh: '库拉索' },
  'Curacao':               { flag: '🇨🇼', zh: '库拉索' },
  'Suriname':              { flag: '🇸🇷', zh: '苏里南' },
  'Türkiye':               { flag: '🇹🇷', zh: '土耳其' },
  "Côte d'Ivoire":         { flag: '🇨🇮', zh: '科特迪瓦' },
  'Cabo Verde':            { flag: '🇨🇻', zh: '佛得角' },
  'Cape Verde Islands':    { flag: '🇨🇻', zh: '佛得角' },
};

// 反向索引:中文名 → 条目。服务端已把队名中文化(translateTeam),客户端拿到的是中文,
// 仅按英文键查会全落空(此前国旗不显示的真因)→ 中文也要能解析出旗/码。
const ZH_INDEX = {};
for (const k of Object.keys(TEAM_MAP)) { ZH_INDEX[TEAM_MAP[k].zh] = TEAM_MAP[k]; }

// 英文键优先,其次按中文反查(兼容服务端中文 / 偶发未译英文名)。
function entryFor(name) {
  return TEAM_MAP[name] || ZH_INDEX[name] || null;
}

// 子区旗(英格兰/苏格兰/威尔士)无 ISO alpha-2 → 用三字码(eng/sco/wal),与 web/public/flags 文件名一致。
const SUBDIV_CODE = { 英格兰: 'eng', 苏格兰: 'sco', 威尔士: 'wal' };

// 由国旗 emoji(区域指示符对)反推 ISO-3166 alpha-2 小写码;子区旗按中文名特判。
function codeFor(t) {
  if (!t) return '';
  if (SUBDIV_CODE[t.zh]) return SUBDIV_CODE[t.zh];
  const cps = Array.from(t.flag).map((c) => c.codePointAt(0));
  if (cps.length >= 2 && cps[0] >= 0x1f1e6 && cps[0] <= 0x1f1ff && cps[1] >= 0x1f1e6 && cps[1] <= 0x1f1ff) {
    return String.fromCharCode(cps[0] - 0x1f1e6 + 97) + String.fromCharCode(cps[1] - 0x1f1e6 + 97);
  }
  return '';
}

// 纯中文队名(找不到映射返回原名)。旧版返回"🇧🇷 巴西",现拆分:国旗经 flagOf 单独渲染。
function teamZh(name) {
  const t = entryFor(name);
  return t ? t.zh : name;
}

// 结构化国旗:{ code, emoji }。code 驱动国旗图(qiuhoushuo.com/flags/<code>.png),emoji 为兜底。
function flagOf(name) {
  const t = entryFor(name);
  if (!t) return { code: '', emoji: '' };
  return { code: codeFor(t), emoji: t.flag };
}

// 兼容旧调用:现返回纯中文名(不再前缀 emoji,避免 Android/微信把区域指示符 emoji 渲染成字母码)。
function formatTeam(name) {
  return teamZh(name);
}

module.exports = { formatTeam, teamZh, flagOf, codeFor, TEAM_MAP };
