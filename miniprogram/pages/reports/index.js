// 顶层 const app = getApp() 在模块求值早于 App() 就绪时会缓存 undefined → onShow 抛。改惰性 app()。
function app() { return getApp(); }
const { request } = require('../../utils/api');
const { flagOf } = require('../../utils/teams');

// 复用赛事 tab 的 flagOf:列表项已是中文队名,按中文反查国旗注入 home_flag/away_flag。
function withFlags(item) {
  return item ? { ...item, home_flag: flagOf(item.home_team), away_flag: flagOf(item.away_team) } : item;
}
function enrichGroups(groups) {
  return (groups || []).map((g) => ({
    ...g,
    featured: withFlags(g.featured),
    items: (g.items || []).map(withFlags),
    subgroups: (g.subgroups || []).map((s) => ({ ...s, items: (s.items || []).map(withFlags) })),
  }));
}

Page({
  data: { groups: [], loading: true, loadError: false, aiNotice: '' },
  onShow() {
    this.setData({ aiNotice: app().globalData.aiNotice });
    app().track('E001', 'app_open', { tab: 'reports' });
    this.loadReports();
  },
  loadReports() {
    request({
      // 后端按 short_code 去重(一场一卡)+ 按今天/昨天/更早分组 + 中文队名 + 看点标签 + 焦点战。
      url: `${app().globalData.apiBase}/reports/recent`,
      success: (res) => this.setData({ groups: enrichGroups(res.data && res.data.groups), loading: false, loadError: false }),
      fail: () => this.setData({ loading: false, loadError: true }),
    });
  },
  onRetry() {
    this.setData({ loading: true, loadError: false });
    this.loadReports();
  },
  goReport(e) {
    // 列表金句取 duanzi,详情默认也进 duanzi(所见即所得);from 便于来源埋点。
    const code = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/report-detail/index?id=${code}&style=duanzi&from=reports_list` });
  },
});
