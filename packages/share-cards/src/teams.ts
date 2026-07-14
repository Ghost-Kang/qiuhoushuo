const ZH: Record<string, string> = {
  'Argentina': '阿根廷', 'Brazil': '巴西', 'Colombia': '哥伦比亚',
  'Ecuador': '厄瓜多尔', 'Uruguay': '乌拉圭', 'Venezuela': '委内瑞拉',
  'Chile': '智利', 'Bolivia': '玻利维亚', 'Paraguay': '巴拉圭', 'Peru': '秘鲁',
  'USA': '美国', 'United States': '美国', 'Mexico': '墨西哥', 'Canada': '加拿大',
  'Costa Rica': '哥斯达黎加', 'Honduras': '洪都拉斯', 'Jamaica': '牙买加',
  'Panama': '巴拿马', 'El Salvador': '萨尔瓦多',
  'Trinidad and Tobago': '特立尼达和多巴哥', 'Cuba': '古巴', 'Guatemala': '危地马拉',
  'Spain': '西班牙', 'France': '法国', 'Germany': '德国', 'England': '英格兰',
  'Portugal': '葡萄牙', 'Netherlands': '荷兰', 'Italy': '意大利', 'Belgium': '比利时',
  'Croatia': '克罗地亚', 'Poland': '波兰', 'Denmark': '丹麦', 'Austria': '奥地利',
  'Switzerland': '瑞士', 'Scotland': '苏格兰', 'Turkey': '土耳其', 'Türkiye': '土耳其',
  'Romania': '罗马尼亚', 'Serbia': '塞尔维亚', 'Ukraine': '乌克兰',
  'Hungary': '匈牙利', 'Czech Republic': '捷克', 'Czechia': '捷克',
  'Slovakia': '斯洛伐克', 'Slovenia': '斯洛文尼亚', 'Albania': '阿尔巴尼亚',
  'Bosnia': '波黑', 'Bosnia & Herzegovina': '波黑', 'Bosnia and Herzegovina': '波黑',
  'Georgia': '格鲁吉亚', 'Greece': '希腊', 'Norway': '挪威', 'Sweden': '瑞典',
  'Wales': '威尔士', 'Iceland': '冰岛',
  'Morocco': '摩洛哥', 'Senegal': '塞内加尔', 'Cameroon': '喀麦隆',
  'Egypt': '埃及', 'South Africa': '南非', "Ivory Coast": '科特迪瓦',
  "Cote d'Ivoire": '科特迪瓦', 'Nigeria': '尼日利亚',
  'DR Congo': '刚果（金）', 'Congo DR': '刚果（金）', // 数据源用 "Congo DR"(词序与 "DR Congo" 反),两种都要命中
  'Tunisia': '突尼斯', 'Algeria': '阿尔及利亚', 'Mali': '马里', 'Ghana': '加纳',
  'Guinea': '几内亚', 'Tanzania': '坦桑尼亚', 'Zambia': '赞比亚',
  'Uganda': '乌干达', 'Cape Verde': '佛得角',
  'Japan': '日本', 'South Korea': '韩国', 'Korea Republic': '韩国',
  'Iran': '伊朗', 'Saudi Arabia': '沙特阿拉伯', 'Australia': '澳大利亚',
  'Qatar': '卡塔尔', 'Jordan': '约旦', 'Uzbekistan': '乌兹别克斯坦',
  'Iraq': '伊拉克', 'China': '中国', 'China PR': '中国', 'Indonesia': '印度尼西亚',
  'UAE': '阿联酋', 'United Arab Emirates': '阿联酋', 'Bahrain': '巴林',
  'Oman': '阿曼', 'Kuwait': '科威特', 'Palestine': '巴勒斯坦',
  'Kyrgyzstan': '吉尔吉斯斯坦', 'Tajikistan': '塔吉克斯坦',
  'New Zealand': '新西兰', 'New Caledonia': '新喀里多尼亚', 'Tahiti': '塔希提',
  // 6/12 生产实测残留(冷门队 + 非 ASCII 拼写变体):赛事页/卡面统一中文化
  'Haiti': '海地', 'Curaçao': '库拉索', 'Suriname': '苏里南',
  "Côte d'Ivoire": '科特迪瓦', 'Cabo Verde': '佛得角', 'Cape Verde Islands': '佛得角',
};

export function translateTeam(name: string): string {
  return ZH[name] ?? name;
}

// 国旗码(ISO-3166 alpha-2 小写;子区旗 eng/sco/wal,与 web/public/flags 文件名一致)。
// 与赛事/战报小程序端同一套国旗图;键集对齐 ZH(新增队两处一起加,share-cards 测试有"无漏码"守卫)。
const CODE: Record<string, string> = {
  Argentina: 'ar', Brazil: 'br', Colombia: 'co', Ecuador: 'ec', Uruguay: 'uy', Venezuela: 've',
  Chile: 'cl', Bolivia: 'bo', Paraguay: 'py', Peru: 'pe',
  USA: 'us', 'United States': 'us', Mexico: 'mx', Canada: 'ca', 'Costa Rica': 'cr', Honduras: 'hn',
  Jamaica: 'jm', Panama: 'pa', 'El Salvador': 'sv', 'Trinidad and Tobago': 'tt', Cuba: 'cu', Guatemala: 'gt',
  Spain: 'es', France: 'fr', Germany: 'de', England: 'eng', Portugal: 'pt', Netherlands: 'nl', Italy: 'it',
  Belgium: 'be', Croatia: 'hr', Poland: 'pl', Denmark: 'dk', Austria: 'at', Switzerland: 'ch', Scotland: 'sco',
  Turkey: 'tr', 'Türkiye': 'tr', Romania: 'ro', Serbia: 'rs', Ukraine: 'ua', Hungary: 'hu',
  'Czech Republic': 'cz', Czechia: 'cz', Slovakia: 'sk', Slovenia: 'si', Albania: 'al',
  Bosnia: 'ba', 'Bosnia & Herzegovina': 'ba', 'Bosnia and Herzegovina': 'ba', Georgia: 'ge', Greece: 'gr',
  Norway: 'no', Sweden: 'se', Wales: 'wal', Iceland: 'is',
  Morocco: 'ma', Senegal: 'sn', Cameroon: 'cm', Egypt: 'eg', 'South Africa': 'za', 'Ivory Coast': 'ci',
  "Cote d'Ivoire": 'ci', "Côte d'Ivoire": 'ci', Nigeria: 'ng', 'DR Congo': 'cd', 'Congo DR': 'cd', Tunisia: 'tn', Algeria: 'dz',
  Mali: 'ml', Ghana: 'gh', Guinea: 'gn', Tanzania: 'tz', Zambia: 'zm', Uganda: 'ug',
  'Cape Verde': 'cv', 'Cabo Verde': 'cv', 'Cape Verde Islands': 'cv',
  Japan: 'jp', 'South Korea': 'kr', 'Korea Republic': 'kr', Iran: 'ir', 'Saudi Arabia': 'sa', Australia: 'au',
  Qatar: 'qa', Jordan: 'jo', Uzbekistan: 'uz', Iraq: 'iq', China: 'cn', 'China PR': 'cn', Indonesia: 'id',
  UAE: 'ae', 'United Arab Emirates': 'ae', Bahrain: 'bh', Oman: 'om', Kuwait: 'kw', Palestine: 'ps',
  Kyrgyzstan: 'kg', Tajikistan: 'tj', 'New Zealand': 'nz', 'New Caledonia': 'nc', Tahiti: 'pf',
  Haiti: 'ht', 'Curaçao': 'cw', Suriname: 'sr',
};

// 反查:中文名 → 码(防调用方传的是已中文化的队名)。
const ZH_TO_CODE: Record<string, string> = {};
for (const [en, zh] of Object.entries(ZH)) { if (CODE[en]) ZH_TO_CODE[zh] = CODE[en]; }

/** 队名(英文或中文)→ 国旗码。找不到返回空串(调用方据此回退,不渲染破图)。 */
export function teamFlagCode(name: string): string {
  return CODE[name] || ZH_TO_CODE[name] || '';
}
