/**
 * 首启隐私同意页(全屏·单一必经卡口)。修微信审核「默认自动同意《用户服务协议》及《隐私政策》」二次驳回。
 *
 * 为什么改成独立页 + app 级 reLaunch(而非只靠逐页遮罩组件 agreement-gate):
 *  微信自动化审核会**直接深链加载每个声明页**(pages 里任一页都可能被当落地页拉起)。逐页挂遮罩总会漏
 *  (leaderboard/standings/bracket/chat/customer-service 此前就漏),漏一页 = 审核器进到可用页面且从未被要求同意
 *  → 判「默认自动同意」。故在 app.js onLaunch + onShow 未同意即 reLaunch 到本页,任何冷启/深链都必经此卡口。
 *
 * 合规要点:用户须自主阅读《用户协议》《隐私政策》后**主动**点「同意并开始」才进;不默认勾选、不强制;可选「不同意」退出。
 * 与官方隐私授权弹窗(privacy-popup / __usePrivacyCheck__,管相册/相机等单独授权)并存,各司其职。
 */
const STORAGE_KEY = 'protocolAgreed_v1';

Page({
  data: {},

  // 阅读协议原文(navigateTo 压栈到 legal;返回回到本同意页)
  openDoc(e) {
    const doc = (e.currentTarget.dataset && e.currentTarget.dataset.doc) || 'agreement';
    wx.navigateTo({ url: `/pages/legal/index?doc=${doc}` });
  },

  // 主动同意:通知 app 置标志 + 此刻起才采集(登录/埋点),再 reLaunch 进首页(本页无返回入口)
  onAgree() {
    const app = getApp();
    if (app && typeof app.onPrivacyAgreed === 'function') app.onPrivacyAgreed();
    else wx.setStorageSync(STORAGE_KEY, true); // 兜底(极端无 app 时)
    wx.reLaunch({ url: '/pages/home/index', fail() {} });
  },

  // 不同意=用户的选择(非默认强制):告知需同意才能用,可退出小程序;不放行、留在本页。
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
});
