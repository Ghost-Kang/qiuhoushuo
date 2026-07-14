// 射手榜/助攻榜 端内页:拉 /api/leaderboard(球员名服务端已译中文),队名 teamZh + 国旗 flagOf 客户端解析。
// 射手榜 ⇄ 助攻榜 左右滑动切换(swiper),顶部分段控件与之联动。
function app() { return getApp(); }
const { request } = require('../../utils/api');
const { teamZh, flagOf } = require('../../utils/teams');

function mapRow(r) {
  return { name: r.name, teamZh: teamZh(r.team), flag: flagOf(r.team), count: r.count, apps: r.apps };
}

Page({
  data: {
    current: 0, // 0=射手榜 1=助攻榜
    scorers: [],
    assists: [],
    asof: '',
    swiperH: 1200, // swiper 需显式高度,渲染后量算
    loading: true,
    loadError: false,
  },

  onLoad() {
    app().track('E007', 'leaderboard_view', {});
    this.load();
  },

  load() {
    this.setData({ loading: true, loadError: false });
    request({
      url: `${app().globalData.apiBase}/leaderboard`,
      success: (res) => {
        const d = (res && res.data) || {};
        this.setData({
          scorers: (d.scorers || []).map(mapRow),
          assists: (d.assists || []).map(mapRow),
          asof: d.asof || '',
          loading: false,
        }, () => this._measure());
      },
      fail: () => this.setData({ loading: false, loadError: true }),
    });
  },

  // swiper 不自适应内容高 → 量当前榜实高写回(进页 + 切榜)
  _measure() {
    const idx = this.data.current;
    wx.createSelectorQuery().in(this).select(`#li-${idx}`).boundingClientRect((rect) => {
      if (rect && rect.height) this.setData({ swiperH: Math.ceil(rect.height) + 8 });
    }).exec();
  },

  onTab(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx !== this.data.current) this.setData({ current: idx }, () => this._measure());
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current }, () => this._measure());
  },

  // 存图分享:射手榜+助攻榜合一张 scoreboard 卡(服务端 PNG)。
  saveCard() {
    app().track('E012', 'share_platform_select', { platform: 'scoreboard_xhs' });
    wx.showLoading({ title: '生成中…', mask: true });
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/scoreboard?inline=1&_t=${Date.now()}`,
      timeout: 20000,
      success: ({ statusCode, tempFilePath }) => {
        wx.hideLoading();
        if (statusCode !== 200 || !tempFilePath) {
          wx.showToast({ title: statusCode === 404 ? '榜单暂无数据' : '生成失败,请稍后再试', icon: 'none' });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => { app().track('E014', 'share_complete', { platform: 'scoreboard_xhs' }); wx.showToast({ title: '已保存到相册', icon: 'success' }); },
          fail: () => wx.showToast({ title: '保存失败,请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络异常,请稍后再试', icon: 'none' }); },
    });
  },
});
