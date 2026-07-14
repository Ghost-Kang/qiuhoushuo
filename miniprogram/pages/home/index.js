// pages/home/index.js — Tab1 赛事日程
// 注意：入口页模块在 App() 就绪前即被求值，顶层 `const app = getApp()` 会缓存 undefined
// → onShow/loadMatches 抛 → 首页永卡"加载中"(实测冷启动复现)。改为惰性 app()。
function app() { return getApp(); }
const { request, requestSubscribeMessage } = require('../../utils/api');
const { TMPL_MATCH_REMINDER, TMPL_REPORT_READY } = require('../../config');
const { teamZh, flagOf } = require('../../utils/teams');

// 直播比分轮询:仅当今日有 live 场次时才起,15s 一拍(足球进球低频,够实时又省 2~3 倍请求)。
const POLL_INTERVAL_MS = 15000;
// 比分变化高亮:一次性 class,动画 600ms,略留余量后清除(非持续动画,不计性能预算)。
const SCORE_BUMP_MS = 650;

// 今日内排序:live 置顶 → 未开赛 → 已完赛;live/未开按开球升序,完赛按时间降序。
// (仅用于挑「焦点卡」:已完赛日焦点 = 最近一场 / live 优先 / 否则下一场未开赛。)
function statusRank(s) { return s === 'live' ? 0 : s === 'finished' ? 2 : 1; }
function sortToday(list) {
  return list.slice().sort((a, b) => {
    const ra = statusRank(a.status), rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    const ka = a.kickoff || '', kb = b.kickoff || '';
    return ra === 2 ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
}

// 焦点卡之外的「其余比赛」按开球时间正序(live 仍置顶)——不像 sortToday 把完赛倒序,
// 列表读起来顺时间(00:00 → 06:00),避免"倒着排"的困惑。
function sortRest(list) {
  return list.slice().sort((a, b) => {
    const la = a.status === 'live' ? 0 : 1, lb = b.status === 'live' ? 0 : 1;
    if (la !== lb) return la - lb;
    return (a.kickoff || '').localeCompare(b.kickoff || '');
  });
}

// 赛事名清理:去年份 + 英文阶段→中文(后端 sanitizeCompetition 残留 "Group Stage - 1" 等英文,
// 在窄卡里溢出截断、还盖掉开球时间)。统一成 "国际大赛 · 小组赛" 这类短中文,只在焦点卡展示一次。
function cleanComp(c) {
  if (!c) return '';
  return String(c)
    .replace(/\s*20\d\d\s*/g, ' ')
    .replace(/\s*-\s*Group Stage.*$/i, ' · 小组赛')
    .replace(/\s*-\s*Round of 16.*$/i, ' · 16强')
    .replace(/\s*-\s*Quarter[-\s]?finals?.*$/i, ' · 8强')
    .replace(/\s*-\s*Semi[-\s]?finals?.*$/i, ' · 4强')
    .replace(/\s*-\s*(3rd Place|Third Place).*$/i, ' · 季军赛')
    .replace(/\s*-\s*Final\b.*$/i, ' · 决赛')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 队名英→纯中文 + 拆出结构化国旗(home_flag/away_flag 渲染国旗图,Android 不再退化成字母码);
// live/finished 把比分 null 兜成 0(直播至少 0:0,避免"null:null")。
// teamZh/flagOf 已兼容服务端中文名(反查),并优先用服务端可能下发的 home_flag/away_flag。
function mapMatch(m) {
  const out = {
    ...m,
    home_team: teamZh(m.home_team),
    away_team: teamZh(m.away_team),
    home_flag: m.home_flag || flagOf(m.home_team),
    away_flag: m.away_flag || flagOf(m.away_team),
    comp: cleanComp(m.competition),
  };
  if (m.status === 'live' || m.status === 'finished') {
    out.home_score = m.home_score == null ? 0 : m.home_score;
    out.away_score = m.away_score == null ? 0 : m.away_score;
  }
  return out;
}

// 仅取 live 场次的比分快照,用于轮询 diff(只关心正在踢的场次比分变化)。
function liveScoreMap(list) {
  const map = {};
  list.forEach((x) => { if (x.status === 'live') map[x.id] = `${x.home_score}-${x.away_score}`; });
  return map;
}

Page({
  data: {
    today: [],
    heroMatch: null, // 今日焦点卡:today 排序后首张(live 优先),单独大卡呈现
    restToday: [],   // 今日其余比赛(焦点卡之外)
    upcoming: [],
    finished: [],
    loading: true,
    loadError: false,
    aiNotice: '',
  },
  _pollTimer: null,
  _bumpTimer: null,
  _prevLiveScores: {},

  onShow() {
    this.setData({ aiNotice: app().globalData.aiNotice });
    app().track('E001', 'app_open', { tab: 'home' });
    this.loadMatches({ initial: true });
  },

  onHide() { this._stopPolling(); },
  onUnload() { this._stopPolling(); this._clearBumpTimer(); },

  // 赛事榜单:点进端内详情页(页内可看具体内容 + 存图分享)
  goLeaderboard() {
    app().track('E002', 'nav_tap', { to: 'leaderboard' });
    wx.navigateTo({ url: '/pages/leaderboard/index' });
  },

  goStandings() {
    app().track('E002', 'nav_tap', { to: 'standings' });
    wx.navigateTo({ url: '/pages/standings/index' });
  },

  goBracket() {
    app().track('E002', 'nav_tap', { to: 'bracket' });
    wx.navigateTo({ url: '/pages/bracket/index' });
  },

  loadMatches(opts = {}) {
    request({
      url: `${app().globalData.apiBase}/matches/today`,
      success: (res) => {
        const data = (res && res.data) || {};
        const today = sortToday((data.today || []).map(mapMatch));
        const upcoming = (data.upcoming || []).map(mapMatch);
        const finished = (data.finished || []).map(mapMatch);
        // 轮询拿到的新帧:diff 直播比分,变化的场次打一次性高亮(不弹窗/不声/不震)
        if (opts.poll) this._markScoreBumps(today);
        // 焦点卡 = 排序后首张(sortToday 已 live 置顶,否则最近一场);其余进列表
        this.setData({
          today,
          heroMatch: today[0] || null,
          restToday: sortRest(today.slice(1)),
          upcoming, finished, loading: false, loadError: false,
        });
        this._prevLiveScores = liveScoreMap(today);
        this._syncPolling(today);
      },
      // 轮询单次失败:静默保留上一帧 + 下一拍继续重试,不打成错误态(SPEC §2.6.4);
      // 仅首屏/重试失败才给可重试错误态。
      fail: () => {
        if (opts.poll) { this._syncPolling(this.data.today); return; }
        this._stopPolling();
        this.setData({ loading: false, loadError: true });
      },
    });
  },

  // 比对上一帧的 live 比分,变化的场次标 scoreBump(WXML 上一次性高亮 class)。
  _markScoreBumps(today) {
    const prev = this._prevLiveScores || {};
    let any = false;
    today.forEach((m) => {
      if (m.status !== 'live') return;
      const cur = `${m.home_score}-${m.away_score}`;
      if (prev[m.id] !== undefined && prev[m.id] !== cur) { m.scoreBump = true; any = true; }
    });
    if (!any) return;
    this._clearBumpTimer();
    this._bumpTimer = setTimeout(() => {
      this._bumpTimer = null;
      const cleared = (this.data.today || []).map((m) => (m.scoreBump ? { ...m, scoreBump: false } : m));
      this.setData({ today: cleared, heroMatch: cleared[0] || null, restToday: cleared.slice(1) });
    }, SCORE_BUMP_MS);
  },

  // 有 live 才轮询;无 live 立即停(切后台/无直播都不空跑)。
  _syncPolling(today) {
    if ((today || []).some((m) => m.status === 'live')) this._startPolling();
    else this._stopPolling();
  },
  _startPolling() {
    if (this._pollTimer) return; // 递归 setTimeout,单计时器防堆积
    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      this.loadMatches({ poll: true });
    }, POLL_INTERVAL_MS);
  },
  _stopPolling() {
    if (!this._pollTimer) return;
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },
  _clearBumpTimer() {
    if (!this._bumpTimer) return;
    clearTimeout(this._bumpTimer);
    this._bumpTimer = null;
  },

  onRetry() {
    this.setData({ loading: true, loadError: false });
    this.loadMatches({ initial: true });
  },

  goMatch(e) {
    const matchId = e.currentTarget.dataset.id;
    app().track('E005', 'match_view', { match_id: matchId });
    wx.navigateTo({ url: `/pages/report-detail/index?id=${matchId}` });
  },

  // 空态里"往期战报"可点:滚动定位到第三分区,不做死胡同(SPEC §2.5)。
  goFinished() {
    wx.pageScrollTo({ selector: '#sec-finished', duration: 300 });
  },

  toggleReminder(e) {
    // 注意:微信事件对象没有 stopPropagation()(那是 Web DOM API),调它会抛错致整个处理器中断=「点了没反应」。
    // 冒泡已由 WXML 的 catchtap 阻断,无需也不能在 JS 里手动 stop。
    const matchId = e.currentTarget.dataset.id;
    const tmplIds = [TMPL_MATCH_REMINDER, TMPL_REPORT_READY];
    // 模板未配置兜底(理论上已配真实 ID):避免无效模板静默失败致"点了没反应"
    if (tmplIds.some((t) => !t || t.indexOf('__PENDING') === 0)) {
      wx.showToast({ title: '提醒即将开放', icon: 'none' });
      return;
    }
    const currentApp = app();
    // 一次订阅开赛提醒 + 战报就绪两条(微信「一次订阅一次推送」)。必须在点击手势里同步调起,不能 await 后再调。
    requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const kinds = [];
        if (res && res[TMPL_MATCH_REMINDER] === 'accept') kinds.push('match_start');
        if (res && res[TMPL_REPORT_READY] === 'accept') kinds.push('report_ready');
        app().track('E006', 'reminder_set', { match_id: matchId, kinds: kinds.join(',') });
        if (!kinds.length) { wx.showToast({ title: '未开启提醒', icon: 'none' }); return; }
        // 记到服务端(request 已会等 openid 就绪);开赛前 + 出战报后由 cron 推送。
        request({
          url: `${currentApp.globalData.apiBase}/subscribe`,
          method: 'POST',
          data: { match_id: matchId, kinds },
          success: () => wx.showToast({ title: '已开启提醒', icon: 'success' }),
          fail: () => wx.showToast({ title: '提醒开启失败，请重试', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '设置提醒失败，请重试', icon: 'none' }),
    });
  },
});
