/**
 * 首次启动协议同意关卡(修微信审核「默认自动同意《用户服务协议》及《隐私政策》」失败原因1)。
 * 合规要点:用户首次进入须自主阅读《用户协议》《隐私政策》后**主动**点「同意」才进;不默认勾选、不强制。
 * 挂在 4 个 tab 页 + 战报详情(深链落地)的 wxml:<agreement-gate />。同意后存标志,不再弹。
 *
 * 「无法绕过的硬门」(v0.1.86 被同一条「默认自动同意」二次驳回后加固):
 *  ① 不透明遮罩盖住页面主体——确保用户主动同意前不存在"可用页面",杜绝默认同意;
 *  ② **收起原生 tabBar**——页面内 fixed 遮罩盖不住微信原生 tab 栏,可点 tab 切页绕过,
 *     故未同意时 wx.hideTabBar 收起,主动同意后 wx.showTabBar 恢复;
 *  ③ pageLifetimes.show 每次宿主页显示都复核——防任何时序下漏弹/绕过。
 * 与微信隐私授权弹窗(privacy-popup,__usePrivacyCheck__)并存——后者管相册/相机等隐私接口的单独授权。
 */
const STORAGE_KEY = 'protocolAgreed_v1';

// 安全调用原生 tabBar API(非 tab 页 / 测试环境下可能无此方法或调用失败,静默兜底)
function hideTabBar() {
  if (typeof wx !== 'undefined' && typeof wx.hideTabBar === 'function') {
    wx.hideTabBar({ animation: false, fail() {} });
  }
}
function showTabBar() {
  if (typeof wx !== 'undefined' && typeof wx.showTabBar === 'function') {
    wx.showTabBar({ animation: false, fail() {} });
  }
}

Component({
  data: { visible: false },
  lifetimes: {
    attached() { this.enforce(); },
  },
  pageLifetimes: {
    // 宿主页每次 show 都复核:未同意→强制弹窗 + 收起原生 tabBar(堵「点 tab 切页绕过」)
    show() { this.enforce(); },
  },
  methods: {
    // 未同意 → 弹关卡 + 收起原生 tabBar;已同意 → 不弹、不动 tabBar(不打扰老用户)
    enforce() {
      if (wx.getStorageSync(STORAGE_KEY)) return;
      this.setData({ visible: true });
      hideTabBar();
    },
    openDoc(e) {
      const doc = (e.currentTarget.dataset && e.currentTarget.dataset.doc) || 'agreement';
      wx.navigateTo({ url: `/pages/legal/index?doc=${doc}` });
    },
    // 用户**主动**点「同意并开始」:通知 app 置同意标志 + 此刻起才采集(登录/埋点),关弹 + 恢复 tabBar。
    onAgree() {
      const app = getApp();
      if (app && typeof app.onPrivacyAgreed === 'function') app.onPrivacyAgreed(); // 设标志 + 触发登录/补发埋点
      else wx.setStorageSync(STORAGE_KEY, true); // 兜底(测试/极端环境无 app 时)
      this.setData({ visible: false });
      showTabBar();
      this.triggerEvent('agree');
    },
    // 不同意=用户的选择(非默认强制)。告知需同意才能用,可选退出小程序;关卡保持、tabBar 仍收起,不放行。
    onDisagree() {
      wx.showModal({
        title: '需同意后才能使用',
        content: '需阅读并同意《用户协议》和《隐私政策》才能使用本小程序。',
        confirmText: '再看看',
        cancelText: '退出',
        success: (res) => {
          if (res.cancel && typeof wx.exitMiniProgram === 'function') wx.exitMiniProgram();
        },
      });
    },
    noop() {},
  },
});
