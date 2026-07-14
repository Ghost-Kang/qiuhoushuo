// 顶层 const app = getApp() 在模块求值早于 App() 就绪时会缓存 undefined → onShow 抛。改惰性 app()。
function app() { return getApp(); }

Page({
  data: { aiNotice: '' },
  onShow() {
    this.setData({ aiNotice: app().globalData.aiNotice });
    app().track('E001', 'app_open', { page: 'customer-service' });
  },
  // 进入小程序自带客服会话(由 <button open-type="contact"> 触发);留言落小程序后台「客服消息」,
  // 运营在公众平台 / 手机「小程序客服」助手回复。记一次点击埋点。
  onContact() {
    app().track('E057', 'customer_service_open', {});
  },
});
