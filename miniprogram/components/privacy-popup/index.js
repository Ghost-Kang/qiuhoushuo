/**
 * 隐私授权弹窗(微信「用户隐私保护指引」框架适配)。
 * 配合 app.json 的 "__usePrivacyCheck__": true 使用:用户首次触发隐私接口(chooseMedia/saveImageToPhotosAlbum 等)
 * 且未授权时,微信触发 onNeedPrivacyAuthorization → 本组件弹窗 → 用户「同意」后原接口继续。
 * 放在用到隐私接口的页面(球迷形象、战报详情)的 wxml 里:<privacy-popup />
 * - pageLifetimes.show 重注册:多页都挂时,保证当前可见页的组件实例是 active handler(导航返回也对)。
 * - 老基础库无 wx.onNeedPrivacyAuthorization → 不注册、不弹,旧逻辑照旧(向后兼容)。
 */
Component({
  data: { visible: false },
  lifetimes: {
    attached() { this._register(); },
  },
  pageLifetimes: {
    show() { this._register(); },
  },
  methods: {
    _register() {
      if (typeof wx.onNeedPrivacyAuthorization !== 'function') return;
      wx.onNeedPrivacyAuthorization((resolve) => {
        this._resolve = resolve;
        this.setData({ visible: true });
      });
    },
    // 由 <button open-type="agreePrivacyAuthorization" bindagreeprivacyauthorization> 触发——open-type 才是
    // 原生「记录同意」的机制(普通 bindtap+resolve 不会真正授权,接口仍被拦,即「点了同意还说要先同意」);
    // 这里再 resolve(带 agree-btn buttonId)通知框架恢复被挂起的隐私接口(chooseMedia)。
    onAgree() {
      this.setData({ visible: false });
      if (this._resolve) { this._resolve({ event: 'agree', buttonId: 'agree-btn' }); this._resolve = null; }
    },
    onDisagree() {
      this.setData({ visible: false });
      if (this._resolve) { this._resolve({ event: 'disagree' }); this._resolve = null; }
    },
    // 打开微信后台配置的《用户隐私保护指引》(与本次授权绑定的那份)
    openContract() {
      if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({});
    },
    // 兜底:也提供跳本站隐私政策页(内容更全)
    openPrivacyPage() {
      wx.navigateTo({ url: '/pages/legal/index?doc=privacy' });
    },
    noop() {},
  },
});
