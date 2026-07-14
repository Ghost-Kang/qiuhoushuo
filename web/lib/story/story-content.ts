export type AudienceId = 'client' | 'employer' | 'developer' | 'fan';
export type LeadRole = 'client' | 'employer' | 'developer' | 'other';

export interface StorySection {
  id: string;
  title: string;
  lead: string;
}

export interface StoryStat {
  label: string;
  value: string;
  asOf: string;
  verified: boolean;
}

export interface StoryCounter {
  label: string;
  value: string;
  note: string;
}

export interface StoryAudience {
  id: AudienceId;
  label: string;
  badge: string;
  highlight: string;
  cta: string;
}

export interface ProofFeature {
  title: string;
  userSees: string;
  systemDoes: string;
  transferableTo: string;
}

export interface OrgLayer {
  title: string;
  members: string[];
}

export interface FactoryLane {
  title: string;
  steps: string[];
}

export interface CostPair {
  title: string;
  before: string;
  after: string;
}

export interface GovernanceBadge {
  label: string;
  status: string;
}

export interface TimelineItem {
  date: string;
  title: string;
  fix: string;
}

export interface PlaybookCard {
  title: string;
  summary: string;
}

export interface SkillCard {
  title: string;
  summary: string;
}

export interface ContactCta {
  role: LeadRole;
  title: string;
  body: string;
}

export interface StoryFormCopy {
  title: string;
  lead: string;
  roleLabel: string;
  industryLabel: string;
  needLabel: string;
  contactLabel: string;
  contactPlaceholder: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
  roleOptions: Array<{ value: LeadRole; label: string }>;
}

export interface StoryContent {
  hero: StorySection & {
    counters: StoryCounter[];
    audiences: StoryAudience[];
    assetPlaceholder: string;
  };
  sections: {
    facts: StorySection;
    proof: StorySection;
    org: StorySection;
    factory: StorySection;
    cost: StorySection;
    governance: StorySection;
    timeline: StorySection;
    assets: StorySection;
    contact: StorySection;
  };
  stats: StoryStat[];
  proofFeatures: ProofFeature[];
  org: {
    layers: OrgLayer[];
    roster: string[];
  };
  factory: {
    lanes: FactoryLane[];
  };
  cost: {
    pairs: CostPair[];
  };
  governance: {
    badges: GovernanceBadge[];
    wall: PlaybookCard[];
  };
  timeline: TimelineItem[];
  assets: {
    playbooks: PlaybookCard[];
    skills: SkillCard[];
  };
  contact: {
    ctas: ContactCta[];
    form: StoryFormCopy;
    miniProgramEntry: string;
  };
  labels: {
    verified: string;
    unverified: string;
    userSees: string;
    systemDoes: string;
    transferableTo: string;
    before: string;
    after: string;
  };
}

export const storyContent: StoryContent = {
  hero: {
    id: 'hero',
    title: '一个人,带一支 AI 员工团队,40 天做出一个会自己运转的产品',
    lead: '国际大赛 AI 球评小程序「超帧球后说」:一套内容覆盖 6 端,5 条内容线无人值守;从想法、产品、合规到商业化预埋,每一步都可回溯。',
    assetPlaceholder: '素材占位:hero-product-montage(7/20 后替换)',
    counters: [
      { label: '开发周期', value: '40 天', note: '2026-06-10 首次提交 → 07-20 决赛收官' },
      { label: '代码提交', value: '432', note: 'commits · 截至 2026-07-09' },
      { label: '内容线', value: '5 条', note: '无人值守 · 双平台分发' },
    ],
    audiences: [
      {
        id: 'client',
        label: '潜在客户',
        badge: '看产能与可迁移',
        highlight: '产能、成本、合规与可迁移性:一场球到全套内容的流水线,可映射到电商、演出、财经、教育等场景。',
        cta: '预约 30 分钟诊断',
      },
      {
        id: 'employer',
        label: '雇主 / 合作方',
        badge: '看端到端能力',
        highlight: '端到端能力、工程质量、复杂判断与失败复盘;作品手册提供完整的能力地图与证据链。',
        cta: '下载作品手册',
      },
      {
        id: 'developer',
        label: '开发者',
        badge: '看方法论与坑位',
        highlight: 'playbook、AI 编排方法论与工程实战:缓存回环、服务端渲染卡片、结构性去成本的完整思路。',
        cta: '读脱敏 playbook 样章',
      },
      {
        id: 'fan',
        label: '球迷',
        badge: '直接看球',
        highlight: '不用看方法论,直接体验产品:战报、评分、对阵图、提醒一站看全。',
        cta: '微信搜「超帧球后说」',
      },
    ],
  },
  sections: {
    facts: {
      id: 'facts',
      title: '事实速览',
      lead: '关键数字一览:每个数字都带日期与口径,可回溯到原始记录;未复核的终值不进大字。',
    },
    proof: {
      id: 'proof',
      title: '产品实证 · 它不只是个战报机',
      lead: '内容管道再强,也得先证明这是一个产品。留存功能补齐:提醒、榜单、评分、对阵图、积分榜、分享卡,给用户一套完整的回访理由;每个功能都标注可迁移的行业方向。',
    },
    org: {
      id: 'org',
      title: '主脊 · 一个人怎么带一支 AI 员工团队',
      lead: '单人开发的瓶颈不在打字速度,而在同一时间只能想一件事。主控负责规划、拆解、综合;推理密集的活派给深度推理角色,机械活派给快速执行角色,高风险决策由两个模型家族双盲互证——一个人拿到接近团队的吞吐,质量由对抗式审查兜底。',
    },
    factory: {
      id: 'factory',
      title: '内容工厂 · 终场哨响后,内容自己出好',
      lead: '内容日更靠人肉顶,迟早断更。5 条内容线接入统一调度器,每 30 分钟唤醒一次,三种触发范式加事实门把关;终场哨响约 30 分钟后全套产物出好,人只负责审核与发布两件事。',
    },
    cost: {
      id: 'cost',
      title: '成本工程 · 把一条内容做到几分钱',
      lead: 'AI 内容想规模化,单条成本必须压到可忽略。重新设计版式,使成本大头的生成路径不再被需要——结构性移除,而非降质;再配缓存、预热与压缩兜底,单条成片从约 4-8 元降到几分钱,零画质损失。',
    },
    governance: {
      id: 'governance',
      title: '合规与治理 · 合规是能力,不是负担',
      lead: '境内 AI 内容产品,合规不是事后补票,而是与开发并行的工程:备案立项即启动,隐私指引按「声明项=代码实际接口」做实,上线后用红线机制管住日常内容——按规矩过审、按规矩运营。',
    },
    timeline: {
      id: 'timeline',
      title: '失败诚实 · 每个坑都变成一条红线',
      lead: '无菌的成功故事不可信。每次踩坑都走完「踩坑→根因→红线」三步,把偶发事故固化成机制;同类问题不再重复出现,红线清单本身成了可复用的资产。',
    },
    assets: {
      id: 'assets',
      title: '资产化 · 一台可复用的 0→1 机器',
      lead: '做完一个产品,经验只留在脑子里,就是一次性买卖。把「怎么做+哪里有坑」沉淀为 10 个 playbook、3 个项目 skill、运营 SOP 与记忆库——产出不只是一个内容号,而是一台可复用的 0→1 机器。',
    },
    contact: {
      id: 'contact',
      title: '联系 · 选择你的身份,拿走对应的东西',
      lead: '客户看产能与成本,雇主看工程质量与判断力,开发者看方法论与坑位,球迷只想看球。四条入口各走各的路,你不需要读完全站,只需要选择自己的身份,拿走对应的那份东西。',
    },
  },
  stats: [
    { label: '开发周期', value: '约 40 天(06-10 → 07-20)', asOf: '2026-07-09', verified: true },
    { label: '代码提交', value: '432 commits', asOf: '2026-07-09', verified: true },
    { label: '团队规模', value: '1 人 + 一支 AI 员工团队', asOf: '2026-07-09', verified: true },
    { label: '内容覆盖端', value: '6 端:小程序 / 服务号 H5 / web / 抖音 / 小红书 / 视频号', asOf: '2026-07-09', verified: true },
    { label: '无人值守内容线', value: '5 条(双平台分发)', asOf: '2026-07-09', verified: true },
    { label: '单条成片成本', value: '约 4-8 元 → 几分钱(结构性移除,零画质损失)', asOf: '2026-07-09', verified: true },
    { label: '缓存命中耗时', value: '8.5s → 0.12s', asOf: '2026-07-09', verified: true },
    { label: '升版卡片预热', value: '792 张 / 约 10 分钟;冷渲 5-7s → 暖后约 200ms', asOf: '2026-07-09', verified: true },
    { label: '方法论沉淀', value: '10 playbook + 3 skill + 运营 SOP', asOf: '2026-07-09', verified: true },
    { label: '小红书曝光(3 周)', value: '3.9 万 → 7.7 万(创作中心口径)', asOf: '2026-07-09', verified: false },
  ],
  proofFeatures: [
    {
      title: '订阅提醒',
      userSees: '开赛前一条提醒,战报就绪再推一条。',
      systemDoes: '双模板双触发,遵循「一次订阅一次推送」,推送后落库标记防重复。',
      transferableTo: '售后跟进、开课提醒、活动开场触达。',
    },
    {
      title: '射手榜与助攻榜',
      userSees: '双榜左右滑切换,球员名全中文。',
      systemDoes: '服务端译名与渲染,榜单随赛果事件驱动刷新,不做无意义轮询。',
      transferableTo: '销售排行、门店排行、创作者榜单。',
    },
    {
      title: '球员评分',
      userSees: '每场一张结构化评分卡,两队关键球员一目了然。',
      systemDoes: '评分口径以系统评分卡为单一标准,数字可回溯到第三方赛事数据源。',
      transferableTo: '质检评分、投研点评、内容质量分。',
    },
    {
      title: '淘汰赛对阵图',
      userSees: '32 强到决赛的晋级树,实时比分与晋级上浮,可长按存图。',
      systemDoes: '维护赛程树状态与缺省兜底,服务端渲染成可分享卡片。',
      transferableTo: '赛制类活动、审批流、里程碑看板。',
    },
    {
      title: '小组积分榜',
      userSees: '12 个小组一屏导航,积分与晋级关系完整呈现。',
      systemDoes: '积分计算、净胜球口径与淘汰赛衔接自动维护。',
      transferableTo: '分组考核、联赛体系、运营看板。',
    },
    {
      title: '分享卡',
      userSees: '战报与数据卡一键生成可转发的视觉摘要。',
      systemDoes: '服务端渲染+缓存;站外分发由管线正则强制移除码类元素,只留搜索词。',
      transferableTo: '数据月报、活动海报、招聘卡片。',
    },
  ],
  org: {
    layers: [
      { title: '主控编排者', members: ['规划 / 拆解 / 综合', '交叉核对后才采纳子任务产出'] },
      { title: '深度推理角色', members: ['架构与方案权衡', '复杂 bug 根因排查'] },
      { title: '快速执行角色', members: ['样板代码与批量修改', '写测试与格式化'] },
      { title: '双盲交叉验证(两个模型家族)', members: ['同题并行、互不见对方答案', '独立同判才定论,分歧逐条裁决'] },
    ],
    roster: [
      '约 190 个专职 subagent 花名册(截至 2026-07-09,待实盘复核)',
      '审查 / 合规 / 运营 / 财税等角色命中即调',
      '冷启动先喂上下文,再派活',
      'trust-but-verify:多 agent 分头核查,主控逐条反证',
    ],
  },
  factory: {
    lanes: [
      { title: '单场战报 + 成片', steps: ['完赛', '调度 hub', '战报 + 成片', '双平台', '人工发布'] },
      { title: '赛果预测连载 · 图文', steps: ['每期', '调度 hub', '预测笔记', '双平台', '人工发布'] },
      { title: '赛果预测连载 · 视频', steps: ['每期', '调度 hub', '口播视频', '双平台', '人工发布'] },
      { title: '每日评分锚定', steps: ['每日锚定', '调度 hub', '评分片 + 笔记', '双平台', '人工发布'] },
      { title: '金靴赛道', steps: ['榜单变动', '调度 hub', '金靴片 + 榜卡', '双平台', '人工发布'] },
    ],
  },
  cost: {
    pairs: [
      {
        title: '成片成本',
        before: '每场需多段对口型视频生成,约 4-8 元/条。',
        after: '版式重设计后该路径整段从代码移除,几分钱/条,零画质损失。',
      },
      {
        title: '缓存命中耗时',
        before: '容器内访问公网 CDN 不可达,每次回退冷渲染约 8.5 秒。',
        after: '命中缓存直接读对象存储字节,0.12 秒。',
      },
      {
        title: '升版卡片预热',
        before: '升缓存版本后历史卡片全部冷渲,单卡 5-7 秒。',
        after: '一次性预渲 792 张约 10 分钟,单卡暖后约 200 毫秒。',
      },
    ],
  },
  governance: {
    badges: [
      { label: 'ICP 备案', status: '已完成' },
      { label: 'AIGC 备案(深度合成类目)', status: '已完成' },
      { label: '小程序审核', status: '已过审(2026-07-01)' },
    ],
    wall: [
      { title: '事实核查纪律', summary: '点名运动员必查现役状态;评分以系统评分卡为准;素材不足换素材,从不反过来改事实。' },
      { title: 'AIGC 标识纪律', summary: '生成内容带显式与隐式标识,公开示例不裁水印——既是平台要求,也是对读者的基本诚实。' },
      { title: '肖像边界', summary: '肖像类玩法在合规护栏内谨慎小范围开放,评估后不让它成为公开卖点。' },
      { title: '站外分发规范', summary: '站外形态零微信码,只用搜索词;管线级正则强制,不靠人记。' },
      { title: '隐私指引', summary: '声明项=代码实际接口,不多声明、不漏声明;审核与用户看到同一份事实。' },
      { title: '预测内容框定', summary: '赛果预测连载:无金钱、无奖励、纯观赛乐趣,并有用语红线防止滑向不当暗示。' },
    ],
  },
  timeline: [
    { date: '06 月下旬', title: '「默认自动同意协议」三次驳回', fix: '根因=逐页挂同意门总会漏一页;根治为应用级单一卡口,07-01 过审。' },
    { date: '06-28', title: '人像一致性问题', fix: '身份绑定提示词 + 分辨率升级,生产 A/B 连跑 3/3 消除。' },
    { date: '07 月初', title: '险些点名已退役球员', fix: '立红线:点名必查现役状态,素材永远不改事实。' },
    { date: '07-09', title: 'shell 变量写法一天踩 4 次', fix: '当天沉淀为脚本红线写进工程规范,从个人记性变成纪律。' },
    { date: '07-09', title: '评分口径偏差(9.0 误作 9.5)', fix: '确立「评分以系统评分卡为准」,评分内容因此更可信。' },
  ],
  assets: {
    playbooks: [
      { title: '01 立项与 AI 技术选型', summary: '定可分享的原子单元;按「能力×境内合规」选 AI 栈;备案立项即并行。' },
      { title: '02 小程序开发与发布', summary: '工程结构、上传管线、域名校验与真机验收的完整链路。' },
      { title: '03 合规资质与审核闯关', summary: '备案材料、审核驳回根因分析与根治方案。' },
      { title: '04 服务号运营', summary: '菜单、自动回复、草稿自动化与小程序联动。' },
      { title: '05 商业化与支付', summary: '收费点标准建法:链路先行、总开关、默认关。' },
      { title: '06 基础设施与部署陷阱', summary: '部署铁律、容器网络回环、调度与缓存预热。' },
      { title: '07 AI 能力集成', summary: 'LLM / 文生图 / TTS / 图生视频接入与十八个实战坑。' },
      { title: '08 营销冷启动', summary: '平台定位、内容配比与站外分发规范。' },
      { title: '09 工程方法论与 AI 协作', summary: '测试红线、Dev↔QA loop、对抗式审查与派单规范。' },
      { title: '10 内容自动化流水线', summary: '调度 hub、三触发范式、事实门与红线内拦。' },
    ],
    skills: [
      { title: '赛后成片一键生成', summary: '任意场次一句话产出口播成片,横竖双封面。' },
      { title: '社媒笔记全套生成', summary: '封面、内页卡、成稿、首评一次出齐,含发布检查。' },
      { title: '公开仓快照同步', summary: '带发布前检查门的脱敏快照同步,防敏感信息外流。' },
    ],
  },
  contact: {
    miniProgramEntry: '微信搜「超帧球后说」',
    ctas: [
      { role: 'client', title: '潜在客户', body: '预约 30 分钟诊断:看这套产能与成本工程,如何迁移到你的行业场景。' },
      { role: 'employer', title: '雇主 / 合作方', body: '下载作品手册:端到端能力地图、证据链与失败复盘全记录。' },
      { role: 'developer', title: '同行开发者', body: '读脱敏 playbook 样章:编排方法论、缓存回环与结构性去成本的完整思路。' },
      { role: 'other', title: '其他来意', body: '留下背景与需求,创始人本人回复。' },
    ],
    form: {
      title: '留下线索',
      lead: '表单只发送通知给创始人,不写入数据库、不存个人信息。',
      roleLabel: '你的身份',
      industryLabel: '行业(选填)',
      needLabel: '想解决的问题(选填)',
      contactLabel: '联系方式',
      contactPlaceholder: '5-80 字,写明可联系渠道(邮箱 / 社媒账号)',
      submit: '发送',
      sending: '发送中…',
      success: '已发送,创始人会尽快回复。',
      error: '发送失败,请稍后再试。',
      roleOptions: [
        { value: 'client', label: '潜在客户' },
        { value: 'employer', label: '雇主 / 合作方' },
        { value: 'developer', label: '开发者' },
        { value: 'other', label: '其他' },
      ],
    },
  },
  labels: {
    verified: '已核验',
    unverified: '待复核',
    userSees: '用户看到什么',
    systemDoes: '系统背后做什么',
    transferableTo: '可迁移到',
    before: '改造前',
    after: '改造后',
  },
};
