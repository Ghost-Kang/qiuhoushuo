// pages/fan-avatar/index.js
// 球迷形象生成（图生图）· 漏斗式重设计(entry→team→photo→确认半屏→generating→result)。
// 合规要点（与后端 /api/avatar 五道闸对应）：
// - consent 必须由用户显式勾选,不默认勾选、不代填（人脸属 PIPL 敏感个人信息）
// - 自拍只读入内存→base64 直传,不写本地缓存、不存任何服务器输入副本（后端红线 1）
// - 灰度关闭时后端返 403 FEATURE_DISABLED → toast "暂未开放"

function app() { return getApp(); }
const { generateFanAvatar, request } = require('../../utils/api');
const { createReportPayment } = require('../../utils/payment');
const { shouldBlockPayment } = require('../../utils/minor-guard');

const MAX_SELFIE_BYTES = 4 * 1024 * 1024;

// ¥1 收费总开关(前端):false=免费生成(安卓/iOS 站内都直接免费出图),不显示价格、不走支付/服务号引导;
// true=安卓站内 jsapi_mini 收 ¥1 / iOS 走服务号 H5(创始人拍板红线方案)。
// 翻 true 前置:WXPAY_ENABLED + 后端 avatar_card SKU + 商户配置 + 服务端 AVATAR_PAYMENT_REQUIRED=1(见 runbook / memory redline)。
// 6/13-6/14 收费链路全实测通过(安卓 jsapi_mini 扣 ¥1 / iOS 服务号 H5 授权→下单→扣¥1→出图)。
// 6/14 起先关开关、免费让用户用起来(收费通路已验证,可随时翻 true 重传小程序恢复收费)。
const AVATAR_PAYMENT_LIVE = false;
const AVATAR_SKU = 'avatar_card';
// 服务号注册名(微信后台真实名,与 report-detail 一致;iOS 引导复制此名让用户去搜一搜关注)。
const SERVICE_ACCOUNT_NAME = '球后说';

// 国旗卡候选(替代手填 input);"其他"走兜底手填。
const TEAM_OPTIONS = [
  { flag: '🇦🇷', name: '阿根廷' }, { flag: '🇧🇷', name: '巴西' }, { flag: '🇫🇷', name: '法国' },
  { flag: '🇪🇸', name: '西班牙' }, { flag: '🇵🇹', name: '葡萄牙' }, { flag: '🇩🇪', name: '德国' },
  { flag: '🏴', name: '英格兰' }, { flag: '🇳🇱', name: '荷兰' }, { flag: '🇧🇪', name: '比利时' },
  { flag: '🇭🇷', name: '克罗地亚' }, { flag: '🇺🇸', name: '美国' }, { flag: '🇯🇵', name: '日本' },
];

// 生成中趣味文案轮播(管理预期 + 降焦虑;AI 出图数秒~十几秒)
const GEN_TIPS = ['正在勾勒轮廓…', '为你披上球队战袍…', '调试光影与色彩…', '快好了…'];
const GEN_TIP_MS = 3500;

// 形象风格(对应 Step0 三种示例);key 与后端 /api/avatar 锁定枚举一致,服务端按 key 选 prompt 描述子。
// ⚠️ 三者都是非写实插画(半写实=厚涂插画非照片),守住后端红线 3(禁照片级写实真人脸)。
const STYLE_OPTIONS = [
  { key: 'cartoon', label: '卡通插画' },
  { key: 'figure', label: '3D 潮玩' },
  { key: 'painterly', label: '半写实' },
];

// 「与球星合影」候选(costar 模式)。选中即带出对应球队(球衣);"其他"走兜底手填球星名+球队。
// ⚠️ 真实球星本人合影为 AI 合成、非真实合影,UI 须如实披露(见确认半屏 costar 文案)。
const STAR_OPTIONS = [
  { name: 'C罗', team: '葡萄牙', flag: '🇵🇹' },
  { name: '梅西', team: '阿根廷', flag: '🇦🇷' },
  { name: '内马尔', team: '巴西', flag: '🇧🇷' },
  { name: '姆巴佩', team: '法国', flag: '🇫🇷' },
  { name: '哈兰德', team: '挪威', flag: '🇳🇴' },
  { name: '贝林厄姆', team: '英格兰', flag: '🏴' },
];

// Step0 诱饵示例成品图(doubao Seedream 生成,存 web/public/avatar-samples,经 qiuhoushuo.com 提供,
// 该域名已在小程序 downloadFile 合法域名白名单)。9 张三风格混排:1-3 卡通 / 4-6 3D潮玩 / 7-9 半写实。
const SAMPLE_BASE = 'https://qiuhoushuo.com/avatar-samples';
const EXAMPLE_IMAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${SAMPLE_BASE}/${n}.jpg`);
// 无缝连续轮播(洗衣机转筒):同组图复制一份,CSS marquee translateX(-50%) 到中点即与起点重合无缝接回。
// 同 URL 出现两次 → 用唯一 id 做 wx:key,避免重复 key 告警。
const EXAMPLE_LOOP = [
  ...EXAMPLE_IMAGES.map((src, i) => ({ src, id: `a${i}` })),
  ...EXAMPLE_IMAGES.map((src, i) => ({ src, id: `b${i}` })),
];

Page({
  data: {
    step: 'entry', // entry | team | star | photo | generating | result
    mode: 'solo', // solo=插画球迷(默认) | costar=与球星合影
    // 「与球星合影」入口由服务端 flag feature.fan_avatar_costar_entry 控制(审核期关→入口隐藏,
    // 独立灰度/风控开关,可随运营策略单独启停)。默认隐藏,config 返回为真才显(fail-closed)。
    costarEntry: false,
    showConfirm: false, // Step3 确认半屏(覆盖在 photo 步之上)
    consentDetail: false, // 合规全文折叠
    isIOS: false,
    payLive: AVATAR_PAYMENT_LIVE,
    teamOptions: TEAM_OPTIONS,
    styleOptions: STYLE_OPTIONS,
    starOptions: STAR_OPTIONS,
    avatarStyle: 'cartoon', // 默认卡通插画
    avatarStyleLabel: '卡通插画',
    star: '', // costar 选中的球星名
    starLabel: '',
    exampleLoop: EXAMPLE_LOOP,
    selfiePath: '',
    selfieBase64: '',
    team: '',
    consent: false,
    generating: false,
    resultUrl: '',
    genTip: '',
    aiNotice: '',
  },
  _genTipTimer: null,

  onLoad() {
    const followed = app().globalData.followedTeams || [];
    this.setData({
      team: followed[0] || '',
      aiNotice: app().globalData.aiNotice,
      isIOS: this._isIOSPlatform(),
    });
    app().track('E001', 'app_open', { tab: 'fan_avatar' });
    // 拉「与球星合影」入口可见性(服务端 flag);默认隐藏,只有明确返回 true 才显——审核期/请求失败一律不露。
    // 包 try:config 拉取失败绝不拖垮球迷形象主页面(入口保持隐藏即可)。
    try {
      request({
        url: `${app().globalData.apiBase}/avatar/config`,
        method: 'GET',
        success: (res) => { if (res && res.data && res.data.costar_entry === true) this.setData({ costarEntry: true }); },
        fail: () => {},
      });
    } catch (e) { /* 入口保持隐藏 */ }
  },
  onUnload() { this._clearGenTip(); },

  // 机型判定(同 report-detail):iOS 收费走服务号 H5;异常按非 iOS。
  _isIOSPlatform() {
    try {
      const info = (typeof wx.getDeviceInfo === 'function') ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      return !!info && info.platform === 'ios';
    } catch (e) { return false; }
  },

  // —— 漏斗导航 ——
  // solo:把自己画成插画球迷(默认)。
  goTeam() { app().track('E056', 'avatar_funnel', { step: 'team', mode: 'solo' }); this.setData({ mode: 'solo', step: 'team' }); },
  goPhoto() {
    if (!this.data.team) { wx.showToast({ title: '先选支持的球队', icon: 'none' }); return; }
    app().track('E056', 'avatar_funnel', { step: 'photo', mode: 'solo' });
    this.setData({ step: 'photo' });
  },
  // costar:与喜欢的球星合影(写实合影,高风险路径)。entry → star → photo。
  goCostar() { app().track('E056', 'avatar_funnel', { step: 'star', mode: 'costar' }); this.setData({ mode: 'costar', step: 'star' }); },
  goPhotoFromStar() {
    if (!this.data.star) { wx.showToast({ title: '先选一位球星', icon: 'none' }); return; }
    app().track('E056', 'avatar_funnel', { step: 'photo', mode: 'costar' });
    this.setData({ step: 'photo' });
  },
  backStep(e) {
    const to = (e.currentTarget && e.currentTarget.dataset.to) || 'entry';
    this.setData({ step: to, showConfirm: false });
  },

  selectTeam(e) { this.setData({ team: e.currentTarget.dataset.name }); },
  onOtherTeamInput(e) { this.setData({ team: e.detail.value }); },

  // costar:选中球星即带出其球队(球衣);"其他"手填走 onOtherStarInput + 复用 onOtherTeamInput。
  selectStar(e) {
    const name = e.currentTarget.dataset.name;
    const opt = STAR_OPTIONS.find((o) => o.name === name);
    if (opt) this.setData({ star: opt.name, starLabel: opt.name, team: opt.team });
  },
  onOtherStarInput(e) { const v = e.detail.value; this.setData({ star: v, starLabel: v }); },

  selectStyle(e) {
    const key = e.currentTarget.dataset.key;
    const opt = STYLE_OPTIONS.find((o) => o.key === key);
    this.setData({ avatarStyle: key, avatarStyleLabel: opt ? opt.label : '卡通插画' });
  },

  // —— 选图(读入内存 base64,不落盘;逻辑沿用) ——
  chooseSelfie() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.prepareSelfie(file);
      },
      // 之前无 fail → 隐私授权被拦/出错都静默("点选照片没反应")。区分:用户取消不提示,隐私未授权引导,其它提示重试。
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return;
        if (/privacy|authorize/i.test(msg)) {
          wx.showToast({ title: '需先同意隐私保护指引才能选择照片', icon: 'none' });
          return;
        }
        wx.showToast({ title: '选择照片失败，请重试', icon: 'none' });
      },
    });
  },

  prepareSelfie(file) {
    const originalPath = file.tempFilePath;
    const readPrepared = (filePath, fallbackSize) => {
      this.getFileSize(filePath, fallbackSize, (size) => {
        if (size > MAX_SELFIE_BYTES) {
          wx.showToast({ title: '图片需小于 4MB', icon: 'none' });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: 'base64',
          success: ({ data }) => this.setData({ selfiePath: filePath, selfieBase64: data, resultUrl: '' }),
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
        });
      });
    };

    if (wx.compressImage) {
      wx.compressImage({
        src: originalPath,
        quality: 72,
        success: ({ tempFilePath }) => readPrepared(tempFilePath || originalPath, file.size),
        fail: () => readPrepared(originalPath, file.size),
      });
      return;
    }
    readPrepared(originalPath, file.size);
  },

  getFileSize(filePath, fallbackSize, done) {
    if (!wx.getFileInfo) { done(fallbackSize || 0); return; }
    wx.getFileInfo({
      filePath,
      success: ({ size }) => done(size || fallbackSize || 0),
      fail: () => done(fallbackSize || 0),
    });
  },

  // —— Step3 确认半屏(合规同意 + 付费 合并) ——
  openConfirm() {
    if (!this.data.selfieBase64) { wx.showToast({ title: '请先选择照片', icon: 'none' }); return; }
    this.setData({ showConfirm: true });
  },
  closeConfirm() { this.setData({ showConfirm: false }); },
  // 空 handler 的 catchtap="" 在部分基础库不被注册为 catch → 半屏内点 checkbox 等会冒泡到遮罩 closeConfirm
  // → 误关半屏跳回选照片页。用非空 noop 确保 catch 生效、阻止冒泡。
  noop() {},
  toggleConsentDetail() { this.setData({ consentDetail: !this.data.consentDetail }); },
  // 法务未背书前保留独立勾选(不合并成一键),合规强度不削弱。
  onConsentChange(e) { this.setData({ consent: e.detail.value.length > 0 }); },

  // 确认半屏主 CTA:同意守卫 + 未成年人拦截 + (付费) + 生成
  onConfirmCta() {
    const { selfieBase64, team, consent, isIOS, payLive } = this.data;
    if (!consent) { wx.showToast({ title: '请先阅读并勾选同意', icon: 'none' }); return; }
    if (!selfieBase64) { wx.showToast({ title: '请先选择照片', icon: 'none' }); return; }
    if (!team) { wx.showToast({ title: '先选支持的球队', icon: 'none' }); return; }
    // 付费/生成前先拦未成年人(合规;不进支付、不进生成)
    const user = app().globalData ? app().globalData.user : null;
    if (shouldBlockPayment(user)) {
      app().track('E023', 'payment_failed', { sku: AVATAR_SKU, error: 'minor_blocked' });
      wx.showToast({ title: '未成年人账号暂不可用', icon: 'none' });
      return;
    }
    // 安卓站内 ¥1(收费启用后)
    if (payLive && !isIOS) {
      app().track('E021', 'paywall_click', { sku: AVATAR_SKU, platform: 'android' });
      // 下单 /payment/create 需 x-openid;avatar 链路有已知 openid race。ensure 不 force——有 openid
      // 立即返回,避免每次强制重登致"付款页迟迟不出";仅缺时登录。
      // 不在此关确认半屏:微信支付 UI 盖在半屏上,取消支付仍留在半屏可重试;成功后由 _startGenerate 关闭。
      const currentApp = app();
      const pay = () => createReportPayment({
        app: currentApp, request, sku: AVATAR_SKU, reportId: null, scene: 'jsapi_mini',
        onPaid: () => this._startGenerate(),
      });
      if (typeof currentApp.ensureOpenid === 'function') {
        currentApp.ensureOpenid().then(pay).catch(() => {
          wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
        });
      } else {
        pay();
      }
      return;
    }
    // iOS 走服务号 H5 收 ¥1(红线方案,已上线):站内不付费、不出现"支付/价格"字样,
    // 复制服务号名 + 弹窗引导去微信关注服务号,在服务号底部菜单(qiuhoushuo.com/avatar H5)付费生成。
    // 文案与 report-detail iOS 引导一致(避 iOS 虚拟支付合规风险)。
    if (payLive && isIOS) {
      app().track('E021', 'paywall_click', { sku: AVATAR_SKU, platform: 'ios', action: 'follow_service' });
      this.setData({ showConfirm: false });
      wx.setClipboardData({
        data: SERVICE_ACCOUNT_NAME,
        success: () => {
          wx.showModal({
            title: '在服务号生成球迷形象',
            content: `已复制服务号名「${SERVICE_ACCOUNT_NAME}」。请到微信「搜一搜」关注服务号,点服务号底部菜单即可生成你的专属球迷形象。`,
            showCancel: false,
            confirmText: '我知道了',
          });
        },
      });
      return;
    }
    // 收费未启用:免费生成(沿用现有,内测可用)。_startGenerate 内关闭确认半屏。
    this._startGenerate();
  },

  _startGenerate() {
    if (this.data.generating) return;
    const currentApp = app();
    // 进生成态同时关确认半屏(支付成功/免费生成走到这里才关,避免点支付即"跳回上一页")
    this.setData({ step: 'generating', generating: true, resultUrl: '', showConfirm: false });
    this._startGenTip();
    const run = () => {
      if (!currentApp.globalData.openid) { this._failGenerate('登录中，请稍后重试'); return; }
      this.submitGenerate(this.data.team, this.data.selfieBase64);
    };
    if (typeof currentApp.ensureOpenid === 'function') {
      currentApp.ensureOpenid({ force: true }).then(run).catch(() => this._failGenerate('登录失败，请稍后重试'));
      return;
    }
    run();
  },

  submitGenerate(team, selfieBase64) {
    const { mode, star, avatarStyle } = this.data;
    app().track('E055', 'fan_avatar_generate_tap', { team, style: avatarStyle, mode, star: mode === 'costar' ? star : '' });
    generateFanAvatar({
      apiBase: app().globalData.apiBase,
      team,
      imageBase64: selfieBase64,
      style: avatarStyle,
      mode,
      star: mode === 'costar' ? star : undefined, // solo 不传 star
      consent: true, // 仅在 consent 勾选守卫通过后才会到达这里
      success: (res) => {
        const url = (res.data && res.data.url) || '';
        const urlQr = (res.data && res.data.url_qr) || ''; // 微信带码版(引流);缺失则不显"存微信版"按钮
        this._clearGenTip();
        if (url) this.setData({ generating: false, resultUrl: url, resultUrlQr: urlQr, step: 'result' });
        else this._failGenerate('生成失败,请稍后再试');
      },
      fail: (err) => this._failGenerate(this.errorMessageForGenerate(err)),
    });
  },

  // 失败回到选图步(保留已选,可重试),不打断主线
  _failGenerate(msg) {
    this._clearGenTip();
    this.setData({ generating: false, step: 'photo' });
    wx.showToast({ title: msg, icon: 'none' });
  },

  // 生成中趣味文案轮播(setData 文本,非持续 CSS 动画)
  _startGenTip() {
    let i = 0;
    this.setData({ genTip: GEN_TIPS[0] });
    const tick = () => {
      i = (i + 1) % GEN_TIPS.length;
      this.setData({ genTip: GEN_TIPS[i] });
      this._genTipTimer = setTimeout(tick, GEN_TIP_MS);
    };
    this._genTipTimer = setTimeout(tick, GEN_TIP_MS);
  },
  _clearGenTip() { if (this._genTipTimer) { clearTimeout(this._genTipTimer); this._genTipTimer = null; } },

  errorMessageForGenerate(err) {
    const error = err && err.data && err.data.error;
    const errMsg = err && err.errMsg ? String(err.errMsg) : '';
    const statusCode = err && err.statusCode;
    if (error === 'FEATURE_DISABLED' || errMsg.indexOf('FEATURE_DISABLED') >= 0) return '功能暂未开放,敬请期待';
    if (error === 'NO_AUTH' || statusCode === 401) return '登录中，请稍后重试';
    if (error === 'MINOR_BLOCKED') return '未成年人账号暂不可用';
    if (error === 'CONSENT_REQUIRED') return '请先阅读并勾选同意';
    if (error === 'PAYLOAD_TOO_LARGE' || statusCode === 413) return '图片太大，请换一张';
    if (error === 'BAD_REQUEST') return '图片格式不支持，请换 JPG/PNG';
    return '生成失败,请稍后再试';
  },

  saveResult() {
    const { resultUrl } = this.data;
    if (!resultUrl) return;
    wx.downloadFile({
      url: resultUrl,
      success: ({ tempFilePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            app().track('E014', 'share_complete', { platform: 'fan_avatar' });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' }),
    });
  },

  // 存"微信版·带码":左下角带小程序码的球迷形象,发微信/朋友圈扫码即进(引流)。
  // 站外(小红书/抖音)请用上面"保存到相册"无码版,微信码发站外会被限流。
  saveResultQr() {
    const { resultUrlQr } = this.data;
    if (!resultUrlQr) return wx.showToast({ title: '微信版生成中,稍后重试', icon: 'none' });
    wx.downloadFile({
      url: resultUrlQr,
      success: ({ tempFilePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            app().track('E014', 'share_complete', { platform: 'fan_avatar_wechat_qr' });
            wx.showToast({ title: '已保存(微信版·带码)', icon: 'success' });
          },
          fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' }),
    });
  },

  // 再做一张(复购入口):回到选图步;收费启用后会再走 onConfirmCta 付费
  remake() { this.setData({ step: 'photo', resultUrl: '' }); },

  onShareAppMessage() {
    app().track('E012', 'share_platform_select', { platform: 'fan_avatar' });
    return {
      title: '我在超帧球后说做了我的专属球迷形象,你也来试试',
      path: '/pages/fan-avatar/index',
      imageUrl: this.data.resultUrl || '',
    };
  },
});
