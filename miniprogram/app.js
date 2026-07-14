// app.js
const PRIVACY_KEY = 'protocolAgreed_v1'; // 与 agreement-gate 同源:用户主动同意《用户协议》《隐私政策》后才置

App({
  globalData: {
    // 正式 HTTPS 域名(6/13 起,ICP 备案 以线上公示为准 + Let's Encrypt 证书已就绪)。
    // ⚠️ 上传前提:微信后台「服务器域名」已配 request=https://qiuhoushuo.com、
    //    downloadFile=https://qiuhoushuo.com + https://img.qiuhoushuo.cn;配好后用户无需再开「不校验合法域名」。
    apiBase: 'https://qiuhoushuo.com/api',
    userInfo: null,
    user: null,
    openid: null,
    followedTeams: [],
    minorNoticeShownKey: '',
    // 隐私协议是否已同意:未同意前**绝不采集任何用户信息**(不 wx.login 取 openid、不发埋点)。
    // 修微信审核「默认自动同意《用户服务协议》及《隐私政策》」——此前 onLaunch 直接 wx.login + flush 埋点,
    // 等于"默认采集",故被驳。现改为:同意后(onPrivacyAgreed)才采集。
    privacyAgreed: false,
    // AIGC 合规：所有页面统一加 "AI 生成" 标识（去"已审核"背书，避免过度声明，对齐 web addAIGCWatermark）
    aiNotice: '【AI 生成内容】',
  },
  loginPromise: null,
  _consentWaiters: null, // 同意前调用 ensureOpenid 的挂起方,同意登录成功后统一解决

  onLaunch() {
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) this.globalData.openid = cachedOpenid;
    this.globalData.followedTeams = wx.getStorageSync('followedTeams') || [];
    // 已同意过的老用户:启动即可采集(登录 + 补发缓存埋点)。未同意:强制跳专用同意页。
    this.globalData.privacyAgreed = !!wx.getStorageSync(PRIVACY_KEY);
    if (this.globalData.privacyAgreed) this._afterConsent();
    else this._redirectToConsent(); // 单一必经卡口:任何冷启/深链落地页,未同意先进同意页(堵审核器直接加载无门页绕过)
  },

  // 未同意 → reLaunch 到专用同意页(清栈,本页无返回,须主动同意/退出)。测试/老基础库无 reLaunch 时静默兜底。
  _redirectToConsent() {
    if (typeof wx !== 'undefined' && typeof wx.reLaunch === 'function') {
      wx.reLaunch({ url: '/pages/consent/index', fail() {} });
    }
  },

  // onShow 复核用:未同意且当前不在同意页/协议阅读页 → 需跳同意页(兜 onLaunch reLaunch 万一未生效 + 覆盖热启)。
  _needConsentRedirect() {
    if (this.globalData.privacyAgreed) return false;
    const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
    const cur = pages.length ? pages[pages.length - 1].route : '';
    // 同意页本身 + 协议阅读页(从同意页点开看原文)不拦,否则死循环/看不了协议
    if (cur === 'pages/consent/index' || cur === 'pages/legal/index') return false;
    return true;
  },

  // 用户在协议关卡(agreement-gate)**主动**点「同意并开始」后调用:此刻起才允许采集。
  onPrivacyAgreed() {
    if (this.globalData.privacyAgreed) return;
    this.globalData.privacyAgreed = true;
    wx.setStorageSync(PRIVACY_KEY, true);
    this._afterConsent();
  },

  // 同意后:发起微信登录(取 openid)+ 补发同意前排队的埋点。
  _afterConsent() {
    this.ensureOpenid();
    const trackQueue = require('./utils/track-queue');
    const api = require('./utils/api');
    trackQueue.flush((evt, onSuccess, onFail) => {
      api.request({
        url: `${this.globalData.apiBase}/track`,
        method: 'POST',
        data: evt,
        _skipEnsure: true,
        success: onSuccess,
        fail: onFail,
      });
    });
  },

  ensureOpenid(options = {}) {
    if (this.globalData.openid && !options.force) return Promise.resolve(this.globalData.openid);
    // 隐私协议未同意前**绝不 wx.login**(不采集 openid)。挂起调用方,同意登录成功后统一解决。
    if (!this.globalData.privacyAgreed) {
      this._consentWaiters = this._consentWaiters || [];
      return new Promise((resolve, reject) => { this._consentWaiters.push({ resolve, reject }); });
    }
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = new Promise((resolve, reject) => {
      this._loginResolve = resolve;
      this._loginReject = reject;
    });
    wx.login({
      success: ({ code }) => {
        require('./utils/api').request({
          url: `${this.globalData.apiBase}/wx/login`,
          method: 'POST',
          data: { code },
          _skipEnsure: true, // 登录请求自身不能再等 ensureOpenid(loginPromise 在飞→会死锁)
          success: (res) => {
            if (res.data.openid) {
              this.globalData.openid = res.data.openid;
              wx.setStorageSync('openid', res.data.openid);
            }
            this.loginPromise = null;
            this._loginResolve && this._loginResolve(this.globalData.openid);
            this._drainConsentWaiters(null, this.globalData.openid);
          },
          fail: (err) => {
            this.loginPromise = null;
            this._loginReject && this._loginReject(err);
            this._drainConsentWaiters(err);
          },
        });
      },
      fail: (err) => {
        this.loginPromise = null;
        this._loginReject && this._loginReject(err);
        this._drainConsentWaiters(err);
      },
    });
    return this.loginPromise;
  },

  _drainConsentWaiters(err, openid) {
    const waiters = this._consentWaiters || [];
    this._consentWaiters = null;
    waiters.forEach((w) => (err ? w.reject(err) : w.resolve(openid)));
  },

  onShow() {
    // 未同意先拦到同意页(热启/onLaunch reLaunch 未生效时兜底);同意前不跑未成年提示(不采集)。
    if (this._needConsentRedirect()) { this._redirectToConsent(); return; }
    require('./utils/minor-guard').maybeShowMinorUsageNotice({ wxApi: wx, app: this });
  },

  // 统一埋点入口（对应 STAGE_02 §四 的 25 事件）
  track(eventId, eventName, properties = {}) {
    const trackQueue = require('./utils/track-queue');
    const evt = {
      event_id: eventId,
      event_name: eventName,
      properties,
      openid: this.globalData.openid,
      ts: Date.now(),
    };
    // 同意前不发埋点(合规:未同意不采集),先排队,同意后 _afterConsent 补发。
    if (!this.globalData.privacyAgreed) {
      trackQueue.enqueue(evt);
      return;
    }
    require('./utils/api').request({
      url: `${this.globalData.apiBase}/track`,
      method: 'POST',
      data: evt,
      // 静默失败：埋点不能阻塞用户
      fail: () => {
        trackQueue.enqueue(evt);
      },
    });
  },
});
