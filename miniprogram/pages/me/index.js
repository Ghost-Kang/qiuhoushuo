// 顶层 const app = getApp() 在模块求值早于 App() 就绪时会缓存 undefined → onShow 抛。改惰性 app()。
function app() { return getApp(); }
const { request } = require('../../utils/api');
const { minorRestrictionNotice } = require('../../utils/minor-guard');

Page({
  data: { user: null, quotes: [], payments: [], aiNotice: '', minorNotice: '', savedQuotes: [], showQuotes: false, showPayments: false },
  onShow() {
    // 收藏金句存本地(report-detail saveQuote 写),每次进页读取,展示可查看/删除。
    let savedQuotes = [];
    try { savedQuotes = wx.getStorageSync('saved_quotes') || []; } catch (e) { savedQuotes = []; }
    this.setData({ aiNotice: app().globalData.aiNotice, savedQuotes });
    app().track('E001', 'app_open', { tab: 'me' });
    request({
      url: `${app().globalData.apiBase}/me`,
      success: (res) => {
        app().globalData.user = res.data.user;
        this.setData({
          user: res.data.user,
          quotes: res.data.quotes || [],
          payments: res.data.payments || [],
          minorNotice: minorRestrictionNotice(res.data.user),
        });
      },
    });
  },
  // 点「收藏金句」行 → 展开/收起金句列表
  toggleQuotes() {
    this.setData({ showQuotes: !this.data.showQuotes });
  },
  // 点「付费记录」行 → 展开/收起付费明细
  togglePayments() {
    this.setData({ showPayments: !this.data.showPayments });
  },
  // 点某条金句 → 回到对应战报
  goQuoteReport(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/report-detail/index?id=${id}&style=duanzi&from=me_quotes` });
  },
  // 删除一条收藏(catchtap 不冒泡到整行的 goQuoteReport)
  removeQuote(e) {
    const idx = e.currentTarget.dataset.idx;
    const list = (this.data.savedQuotes || []).slice();
    list.splice(idx, 1);
    try { wx.setStorageSync('saved_quotes', list); } catch (er) { /* 忽略 */ }
    this.setData({ savedQuotes: list });
    wx.showToast({ title: '已移除', icon: 'none' });
  },
  goCustomerService() {
    wx.navigateTo({ url: '/pages/customer-service/index' });
  },
  openLegal(e) {
    const doc = e.currentTarget.dataset.doc || 'agreement';
    wx.navigateTo({ url: `/pages/legal/index?doc=${doc}` });
  },
});
