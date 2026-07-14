export type Style = 'hardcore' | 'duanzi' | 'emotion' | 'brief' | 'tactics' | 'ratings' | 'scoreboard' | 'standings' | 'bracket' | 'ft';
export type Platform = 'wechat' | 'xhs' | 'x';

export interface CardPayload {
  competition: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homePoss?: number;
  awayPoss?: number;
  homeShots?: number;
  awayShots?: number;
  homeShotsOn?: number;
  awayShotsOn?: number;
  homeXG?: string;
  awayXG?: string;
  homePassAcc?: number;
  awayPassAcc?: number;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  /** 国旗图 URL(渲染时 fetch→base64;一图看懂头部用,与赛事/战报小程序同一套国旗) */
  homeFlagUrl?: string;
  awayFlagUrl?: string;
  title: string;
  subtitle?: string;
  shareQuote: string;
  bodyExcerpt?: string;
  brand: string;
  shortUrl: string;
  highlightMoment?: {
    title: string;
    description?: string;
    minute?: string;
    image_url?: string;
    image_alt?: string;
  };
  briefCard?: {
    title: string;
    match_line: string;
    one_sentence_summary: string;
    focus_tags: string[];
    key_reasons: { title: string; evidence: string }[];
    timeline: { minute: string; text: string }[];
    data_points: { label: string; value: string; note: string }[];
    highlight_lens?: { title: string; image_url?: string; caption: string };
    /** 战术阵型(整合战术图解,F67g):官方首发阵型串,如 "4-3-3"。缺阵容数据时不传,模板降级隐藏球场。 */
    formation?: { home: string; away: string };
    share_line: string;
    integrity_note: string;
  };
  tactics?: {
    /** "4-3-3" 形式的阵型串，来自官方首发数据 */
    homeFormation: string;
    awayFormation: string;
    /** 底部诚信说明覆写 */
    note?: string;
  };
  /** 球员评分卡(stats.players 数据源):全场最佳 + 主客各 Top5。 */
  ratingsCard?: {
    match_line: string;
    motm?: { name: string; team: string; rating: number; position: string };
    home: { team: string; players: { name: string; rating: number | null; position: string; goals: number; assists: number }[] };
    away: { team: string; players: { name: string; rating: number | null; position: string; goals: number; assists: number }[] };
    note?: string;
  };
  /** 射手榜/助攻榜卡(赛事级 /players/topscorers+topassists):金靴领跑 + 射手榜/助攻榜各 Top8。 */
  scoreboardCard?: {
    title_line: string;
    asof?: string;
    scorers: { name: string; team: string; count: number; apps: number; flag?: string }[];
    assists: { name: string; team: string; count: number; apps: number; flag?: string }[];
    note?: string;
  };
  /** 小组积分榜卡(赛事级 /standings 单组):4 队完整积分表 + 出线区配色。 */
  standingsCard?: {
    title_line: string;
    asof?: string;
    rows: { rank: number; team: string; played: number; win: number; draw: number; lose: number; goalsDiff: number; points: number; qualified: boolean; flag?: string }[];
    note?: string;
  };
  /**
   * 官方战报风卡(ft·国际官方赛后模版结构 × 球后皮肤,XHS 专用):
   * 比分进程行(半场/90'/加时/点球)+ 双栏进球者名单(乌龙/点球标注)+ POTM 金条
   * + 横向数据对比条 + 关键时间线 + 金句。地名保留英文(founder 口径 2026-07-04)。
   */
  ftCard?: {
    /** 赛事 · 轮次 · 球场(球场名保留英文),如 "国际大赛 2026 · 32强赛 · Hard Rock Stadium" */
    meta_line: string;
    /** 北京日期行,如 "2026.07.04 · 北京" */
    date_line: string;
    /** 比分进程,如 "半场 1:0 · 90分钟 1:1 · 加时 3:2";数据不足时省略 */
    progression?: string;
    /** 进球者名单(主/客),如 "29' 梅西"、"111' 博尔赫斯(乌龙)"、"68' C罗(点球)" */
    home_scorers: string[];
    away_scorers: string[];
    /** 全场最佳行,如 "全场最佳 梅西 · 9.5（阿根廷）";无评分数据省略 */
    potm?: string;
    /** 数据对比条:home_ratio 为主队占比 0-100(条形宽度) */
    bars: { label: string; home: string; away: string; home_ratio: number }[];
    timeline: { minute: string; text: string }[];
    /** 金句(球后人设,一句);无则省略 */
    quote?: string;
    integrity_note: string;
  };
  /**
   * 淘汰赛对阵图卡(赛事级):新华社双向树(绝对定位 + 桥接线 + 中央大力神杯)。
   * 结构固定 = 32 队淘汰赛:上半区(32强8场→16强4→8强2→半决赛1)→ 中央决赛+季军赛 → 下半区镜像。
   * 32强数组按 row-major:idx 0-3 = 上排(col0-3),4-7 = 下排(col0-3)。国旗 URL 由 web 层 fetch→base64 注入。
   */
  bracketCard?: {
    title?: string;
    subtitle?: string;
    note?: string;
    topR32: BracketMatch[]; // 8
    top16: BracketMatch[];  // 4
    top8: BracketMatch[];   // 2
    topSF: BracketMatch[];  // 1
    final: BracketMatch[];  // 1
    third: BracketMatch[];  // 1
    botSF: BracketMatch[];  // 1
    bot8: BracketMatch[];   // 2
    bot16: BracketMatch[];  // 4
    botR32: BracketMatch[]; // 8
  };
}

/** 对阵图单场:队名已中文化,国旗为 base64 data URL,点球分另给。status: finished|scheduled|tbd|half */
export interface BracketMatch {
  date: string;
  tag?: string; // 如 "1/16决赛"
  homeName?: string;
  awayName?: string;
  homeFlag?: string;
  awayFlag?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  penHome?: number | null;
  penAway?: number | null;
  status: string;
}

export interface RenderOptions {
  format?: 'png';
  /** 微信内分享卡右下角叠加小程序码引流。仅用于微信生态(朋友圈/群);
   *  站外(小红书/微博)严禁带微信码会被限流封号,故由调用方按下载目标显式开启。 */
  withQr?: boolean;
}
