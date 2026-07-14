// 顶层 const app = getApp() 在模块求值早于 App() 就绪时会缓存 undefined → onShow 抛。改惰性 app()。
function app() { return getApp(); }

Page({
  data: { aiNotice: '' },
  onShow() {
    this.setData({ aiNotice: app().globalData.aiNotice });
    app().track('E001', 'app_open', { page: 'chat-room' });
  },
});
