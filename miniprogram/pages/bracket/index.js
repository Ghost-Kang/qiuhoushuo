// 淘汰赛对阵图 端内页:展示服务端渲染的整张对阵图(新华社双向树),可存图分享。
// 图由 /api/card/bracket 渲染:固定 bracket 骨架 + matches 表实时比分 + 晋级方上浮;数据随赛程自动更新。
function app() { return getApp(); }

// 北京小时戳(YYYYMMDDHH)。显示图 buster 用它:同一小时内 URL 稳定 → wx <image> 缓存命中秒开
// (服务端也按小时戳 key 预热落 COS);跨小时自动换 URL 拿最新对阵/比分。
function beijingHourStamp() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

Page({
  data: { imgUrl: '', loading: true },

  onLoad() {
    app().track('E002', 'nav_view', { page: 'bracket' });
    this._refresh(false);
  },
  // 下拉刷新:强制拿最新对阵/比分(Date.now 破客户端缓存,绕过同小时缓存)
  onPullDownRefresh() { this._refresh(true); wx.stopPullDownRefresh(); },

  // force=false(进页):北京小时戳 buster,同小时内命中 wx 缓存秒显(修"每次进页 Date.now → 每次重下整张竖长图")。
  // force=true(下拉):Date.now 强制最新。
  _refresh(force) {
    const buster = force ? Date.now() : beijingHourStamp();
    this.setData({ loading: true, imgUrl: `${app().globalData.apiBase}/card/bracket?inline=1&_t=${buster}` });
  },
  onImgLoad() { this.setData({ loading: false }); },
  onImgError() { this.setData({ loading: false }); wx.showToast({ title: '对阵图加载失败,请稍后再试', icon: 'none' }); },

  saveImg() {
    app().track('E012', 'share_platform_select', { platform: 'bracket_xhs' });
    wx.showLoading({ title: '生成中…', mask: true });
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/bracket?inline=1&_t=${Date.now()}`, // 存图取最新
      timeout: 30000,
      success: ({ statusCode, tempFilePath }) => {
        wx.hideLoading();
        if (statusCode !== 200 || !tempFilePath) { wx.showToast({ title: '生成失败,请稍后再试', icon: 'none' }); return; }
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => { app().track('E014', 'share_complete', { platform: 'bracket_xhs' }); wx.showToast({ title: '已保存到相册', icon: 'success' }); },
          fail: () => wx.showToast({ title: '保存失败,请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络异常,请稍后再试', icon: 'none' }); },
    });
  },
});
