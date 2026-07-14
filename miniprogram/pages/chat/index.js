// pages/chat/index.js — Tab3 群聊（腾讯云 IM 接入）
// W3 才上线，此处占位
// 顶层 const app = getApp() 在模块求值早于 App() 就绪时会缓存 undefined → onShow 抛。改惰性 app()。
function app() { return getApp(); }
const { request } = require('../../utils/api');

Page({
  data: { rooms: [], aiNotice: '' },
  onShow() {
    this.setData({ aiNotice: app().globalData.aiNotice });
    app().track('E001', 'app_open', { tab: 'chat' });
    request({
      url: `${app().globalData.apiBase}/chat/rooms`,
      success: (res) => this.setData({ rooms: res.data || [] }),
    });
  },
  enterRoom(e) {
    const roomId = e.currentTarget.dataset.id;
    app().track('E015', 'chat_enter', { match_id: roomId });
    wx.navigateTo({ url: `/pages/chat-room/index?id=${roomId}` });
  },
});
