// pages/report-detail/index.js
// 战报详情页 — 产品的核心黄金窗口
// 对应 IA F2 流程：进页 → 切风格 → 一键分享图

// 顶层 `const app = getApp()` 在模块求值早于 App() 就绪时会缓存 undefined
// → onLoad/onPaywallTap 抛(实测付费点击 globalData of undefined)。改惰性 app()。
function app() { return getApp(); }
const { request } = require('../../utils/api');
const { createReportPayment } = require('../../utils/payment');
const { flagOf } = require('../../utils/teams');

const STYLE_INDEX = { hardcore: 0, duanzi: 1, emotion: 2 };

// 显示类卡(一图看懂/球员评分/战术)走 wx.downloadFile 显示;**buster 用稳定卡版本号而非 Date.now()**
// ——原 _t=Date.now() 每次都是新 URL、绕过 wx 本地缓存,每次进页都重下整张 PNG(381KB)→ 每次"加载一会"。
// 改成卡版本号后:同版本内 URL 稳定 → wx 缓存命中秒显;服务端升 CARD_RENDER_CACHE_VERSION 时同步 bump 这里破缓存。
// (正常流程镜头图先于战报生成,预热的 brief 卡本就完整,无版本内变化。)下载/分享动作仍用 Date.now() 取最新。
// ⚠️ 与 web/lib/api/card-storage.ts 的 CARD_RENDER_CACHE_VERSION 保持一致,服务端 bump 时这里也 bump。
const CARD_CACHE_VER = 'v34';
const STYLES = ['hardcore', 'duanzi', 'emotion'];
const SWIPE_MIN_DISTANCE = 56;
const SWIPE_MAX_VERTICAL_DRIFT = 72;

// iOS 合规(策略 C):微信小程序禁止 iOS 虚拟支付。故 iOS 不在站内卖深度战报
// (不显示价格、不调起支付),改引导关注服务号查看完整内容;安卓仍走 jsapi_mini 站内付。
// ⚠️ 上线前与微信后台「服务号」实际显示名核对(用户在「搜一搜」按此名搜索关注)。
const SERVICE_ACCOUNT_NAME = '球后说';

// 由 match stats 算数据可视化条；stats 缺失返回 []（详情页数据块整块不渲染，降级，见 §8.3）
function computeStatBars(stats) {
  if (!stats) return [];
  const pct = (h, a) => { const t = (Number(h) || 0) + (Number(a) || 0); return t ? Math.round((Number(h) || 0) / t * 100) : 50; };
  const bars = [];
  const p = stats.possession, s = stats.shots, x = stats.xg;
  if (p && p.home != null) bars.push({ label: '控球率', home: `${p.home}%`, away: `${p.away}%`, pct: pct(p.home, p.away) });
  if (s && s.home != null) bars.push({ label: '射门', home: `${s.home}`, away: `${s.away}`, pct: pct(s.home, s.away) });
  if (x && x.home != null) bars.push({ label: 'xG', home: `${x.home}`, away: `${x.away}`, pct: pct(x.home, x.away) });
  return bars;
}

Page({
  data: {
    reportId: '',
    style: 'duanzi', // 默认段子手派（受众最大）
    styleIndex: 1,   // segmented 滑块位置 hardcore=0/duanzi=1/emotion=2
    report: null,
    statBars: [],
    loading: true,
    showShareSheet: false,
    aiNotice: '',
    tacticsImageSrc: '',
    showTactics: false,
    ratingsImageSrc: '',
    showRatings: false, // 球员评分卡(stats.players 有才出;无→路由 404,binderror/非200 隐藏)
    briefImageSrc: '',
    briefLoading: false, // 一图看懂图加载中→占位骨架(预留空间,避免图到时跳版);正文不等它
    noReport: false, // 完赛但战报还没生成(cron 空窗 / 404)→ 友好"生成中"态,不白屏
    isIOS: false, // iOS 隐藏站内付费、改服务号引导(策略 C);非 iOS(安卓/devtools)走站内付
    serviceAccountName: SERVICE_ACCOUNT_NAME, // 供 WXML 展示的服务号名(单一来源)
  },
  _readCompleteTimer: null,
  _readCompleteFired: false,
  // 加载策略(6/14 改):正文(DB 读,快)就绪即解除整页 loading 立刻显示;一图看懂(服务端 PNG,
  // 冷渲染可能 ~5~7s)异步加载、不阻塞整页——加载中显骨架占位,图到了原位替换(不跳版)。
  // 旧设计"正文+图都 settle 才显"会被慢图拖住整页(用户报修:点进去加载非常久)。
  _reportSettled: false,
  _briefSettled: false, // 仅作 brief 加载的一次性 settle 守卫(成功/失败/超时只生效一次),不再门控整页 loading
  _briefTimer: null,
  _touchStartX: 0,
  _touchStartY: 0,

  onLoad(options) {
    const reportId = options.id || options.shortCode;
    const style = options.style || 'duanzi';
    this._clearReadCompleteTimer();
    this._readCompleteFired = false;
    this._reportSettled = false;
    this._briefSettled = false;
    this.setData({ reportId, style, styleIndex: STYLE_INDEX[style] || 0, aiNotice: app().globalData.aiNotice, isIOS: this._isIOSPlatform() });
    this.loadTacticsImage(reportId);
    this.loadRatingsImage(reportId);
    this.loadBriefImage(reportId);
    app().track('E007', 'report_view', { report_id: reportId, style, source: options.from });
    this.loadReport(reportId);
  },

  // 机型判定:iOS 走服务号引导,其余(安卓 / devtools / 取不到)走站内付。
  // getDeviceInfo 是新接口,旧基础库回退 getSystemInfoSync;异常一律按非 iOS,不误伤安卓付费。
  _isIOSPlatform() {
    try {
      const info = (typeof wx.getDeviceInfo === 'function') ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      return !!info && info.platform === 'ios';
    } catch (e) {
      return false;
    }
  },

  onShow() {
    this._clearReadCompleteTimer();
    if (this._readCompleteFired) return;
    this._readCompleteTimer = setTimeout(() => {
      this._readCompleteTimer = null;
      if (this._readCompleteFired) return;
      this._readCompleteFired = true;
      const { report, reportId, style } = this.data;
      app().track('E054', 'report_read_completed', {
        report_id: reportId,
        style,
        sku: report?.is_premium ? 'deep_report' : 'free',
        reading_seconds: 60,
      });
    }, 60_000);
  },

  onHide() {
    this._clearReadCompleteTimer();
  },

  onUnload() {
    this._clearReadCompleteTimer();
    this._clearBriefTimer();
  },

  _clearReadCompleteTimer() {
    if (!this._readCompleteTimer) return;
    clearTimeout(this._readCompleteTimer);
    this._readCompleteTimer = null;
  },

  async loadReport(reportId) {
    request({
      url: `${app().globalData.apiBase}/report/${reportId}`,
      success: (res) => {
        // 完赛后到 cron 生成战报有最多 5min 空窗,期间 /api/report 返 404 NOT_FOUND。
        // 此时不白屏,显示"生成中"友好态(noReport)。
        const report = res.statusCode === 200 ? res.data : null;
        // 复用赛事 tab 的 flagOf:服务端下发中文队名,按中文反查国旗(头部渲染国旗 VS)
        if (report) {
          report.home_flag = flagOf(report.home_team);
          report.away_flag = flagOf(report.away_team);
        }
        const cur = report && report[this.data.style];
        this._reportSettled = true;
        // loading 不在此直接翻 false:由 _finishLoadingIfReady 统一控制,
        // 等"一图看懂"也就绪后整篇一起出现(避免文字先到、图后插入顶部跳动)。
        if (!cur) {
          this.setData({ report: null, noReport: true, statBars: [] });
        } else {
          this.setData({ report, noReport: false, statBars: computeStatBars(cur.stats) });
        }
        this._finishLoadingIfReady();
      },
      fail: () => {
        // 网络失败同样给"生成中/可刷新"态而非白屏
        this._reportSettled = true;
        this.setData({ report: null, noReport: true });
        this._finishLoadingIfReady();
      },
    });
  },
  retryReport() {
    // 重拉正文(空窗期可能刚生成好);图由 loadBriefImage 自管骨架/替换,正文不等它。
    this._reportSettled = false;
    this._clearBriefTimer();
    this.setData({ loading: true, noReport: false });
    this.loadReport(this.data.reportId);
    this.loadBriefImage(this.data.reportId);
  },

  switchStyle(e) {
    const newStyle = e.currentTarget.dataset.style;
    this.applyStyleChange(newStyle);
  },

  applyStyleChange(newStyle) {
    if (newStyle === this.data.style) return;
    app().track('E008', 'style_switch', {
      from_style: this.data.style,
      to_style: newStyle,
      report_id: this.data.reportId,
    });
    const cur = this.data.report && this.data.report[newStyle];
    this.setData({ style: newStyle, styleIndex: STYLE_INDEX[newStyle] || 0, statBars: computeStatBars(cur && cur.stats) });
  },

  onHorizontalTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this._touchStartX = touch.clientX;
    this._touchStartY = touch.clientY;
  },

  onHorizontalTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this._touchStartX;
    const deltaY = touch.clientY - this._touchStartY;
    this._touchStartX = 0;
    this._touchStartY = 0;
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE) return;
    if (Math.abs(deltaY) > SWIPE_MAX_VERTICAL_DRIFT) return;

    const currentIndex = STYLE_INDEX[this.data.style] || 0;
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= STYLES.length) return;
    this.applyStyleChange(STYLES[nextIndex]);
  },

  // 收藏金句:持久化到本地存储(键 saved_quotes),「我的」页可查看/删除。
  // 此前只 toast 不存任何东西、也无处可看(用户报修)。本地存储够用:个人书签、跨设备不强需求。
  saveQuote() {
    const { report, style, reportId } = this.data;
    if (!report) return;
    const cur = report[style] || {};
    const text = cur.share_quote || '';
    if (!text) { wx.showToast({ title: '暂无金句', icon: 'none' }); return; }
    let list = [];
    try { list = wx.getStorageSync('saved_quotes') || []; } catch (e) { list = []; }
    if (list.some((q) => q.text === text)) {
      wx.showToast({ title: '已收藏过，在「我的」查看', icon: 'none' });
      return;
    }
    list.unshift({ text, title: cur.title || '', reportId, ts: Date.now() });
    if (list.length > 50) list = list.slice(0, 50); // 上限 50 条,防本地存储无限涨
    try { wx.setStorageSync('saved_quotes', list); } catch (e) { /* 存储满/异常:不阻断 */ }
    app().track('E010', 'quote_save', { report_id: reportId, quote: text });
    wx.showToast({ title: '已收藏，在「我的」查看', icon: 'none' });
  },

  openShareSheet() {
    app().track('E011', 'share_open', { report_id: this.data.reportId });
    this.setData({ showShareSheet: true });
  },
  closeShareSheet() {
    this.setData({ showShareSheet: false });
  },
  // 非空 noop:空 catchtap="" 在部分基础库不阻冒泡 → 弹层内点击误冒泡到遮罩关闭。
  noop() {},

  onMomentImageTap(e) {
    const current = e.currentTarget.dataset.url;
    if (!current) return;
    const urls = (this.data.report?.highlight_moments || [])
      .map((moment) => moment.image_url)
      .filter(Boolean);
    wx.previewImage({
      current,
      urls: urls.length ? urls : [current],
    });
  },

  // 分享到微信好友 / 群（系统 API）
  onShareAppMessage() {
    const { report, style, reportId } = this.data;
    app().track('E012', 'share_platform_select', { platform: 'wechat_chat', report_id: reportId });
    return {
      title: report?.[style]?.share_quote || '超帧球后说 · AI 战报',
      path: `/pages/report-detail/index?id=${reportId}&style=${style}&from=wechat`,
      imageUrl: `${app().globalData.apiBase}/card/${reportId}?style=${style}&platform=wechat&_t=${Date.now()}`,
    };
  },

  // 分享到朋友圈（小程序限制：必须配置可分享）
  onShareTimeline() {
    const { report, style, reportId } = this.data;
    app().track('E012', 'share_platform_select', { platform: 'wechat_moments', report_id: reportId });
    return {
      title: report?.[style]?.share_quote || '超帧球后说',
      query: `id=${reportId}&style=${style}&from=moments`,
    };
  },

  // 保存图片到相册（朋友圈/小红书/X 都需要）
  saveCardImage(e) {
    const platform = e.currentTarget.dataset.platform;
    app().track('E012', 'share_platform_select', { platform, report_id: this.data.reportId });
    // &_t= 缓存破除:wx.downloadFile 会按 URL 缓存旧图,卡片版本升级(服务端 CARD_RENDER_CACHE_VERSION)
    // 后固定 URL 仍命中旧缓存。加时间戳令微信每次重下;服务端忽略 _t,仍 302 到当前版本 CDN 图。
    const url = `${app().globalData.apiBase}/card/${this.data.reportId}?style=${this.data.style}&platform=${platform}&inline=1&_t=${Date.now()}`;
    wx.downloadFile({
      url,
      success: ({ tempFilePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            app().track('E014', 'share_complete', { platform, report_id: this.data.reportId });
            // 存完不关弹层:留着让用户接着存其他版本(朋友圈/小红书/X)。关闭由「取消」或点遮罩触发。
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          // 缺 fail 兜底→存图失败(无相册权限等)静默无提示,用户以为没反应再点易误触转发,故补齐(与 brief/战术存图一致)
          fail: () => {
            wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
      },
    });
  },

  // 战术图解卡走 wx.downloadFile 而非 <image src=api>：
  // 后端存储命中时返 302 → CDN，<image> 组件不跟随重定向（6/11 模拟器实测加载失败），
  // downloadFile 会跟随；同时"下载成功才显示整卡"，避免黑色占位框。
  loadTacticsImage(reportId) {
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/tactics/${reportId}?inline=1&_t=${CARD_CACHE_VER}`,
      success: ({ statusCode, tempFilePath }) => {
        // 非 200（灰度关 403 / 阵容未出 404）→ 不显示，保持阅读主线干净
        if (statusCode === 200 && tempFilePath) {
          this.setData({ tacticsImageSrc: tempFilePath, showTactics: true });
        }
      },
      fail: () => {}, // 网络失败同"不显示"，无需打扰
    });
  },

  // 球员评分卡:与战术卡同策略——downloadFile 服务端 PNG,200 才显;无 players → 路由 404,静默不显(不打扰阅读)。
  loadRatingsImage(reportId) {
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/${reportId}?style=duanzi&platform=xhs&variant=ratings&inline=1&_t=${CARD_CACHE_VER}`,
      success: ({ statusCode, tempFilePath }) => {
        if (statusCode === 200 && tempFilePath) {
          this.setData({ ratingsImageSrc: tempFilePath, showRatings: true });
        }
      },
      fail: () => {},
    });
  },

  // 一图看懂走 wx.downloadFile 显示服务端 PNG（与下载/分享同一张图,杜绝页面内 WXML 重搭一套老布局的分叉）：
  // 后端命中存储返 302 → CDN，<image> 不跟随重定向(同战术卡),故 downloadFile 拿临时文件再 <image> 显示。
  loadBriefImage(reportId) {
    // 一图看懂异步加载,不阻塞整页(正文已先显)。加载中显骨架占位(预留空间),图到了原位替换不跳版;
    // 失败/超时则收起骨架(不显本块,不打扰阅读)。downloadFile 取服务端 PNG(命中缓存秒回/冷渲染 ~5~7s)。
    this._briefSettled = false;
    this.setData({ briefLoading: true, briefImageSrc: '' });
    const settle = (patch) => {
      if (this._briefSettled) return;
      this._briefSettled = true;
      this._clearBriefTimer();
      this.setData(Object.assign({ briefLoading: false }, patch || {}));
    };
    // 22s 兜底:极端/旧基础库下 downloadFile 既不回 success 也不回 fail 时,也收起骨架。
    this._briefTimer = setTimeout(() => settle(), 22000);
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/${reportId}?style=duanzi&platform=xhs&variant=brief&inline=1&_t=${CARD_CACHE_VER}`,
      timeout: 20000,
      success: ({ statusCode, tempFilePath }) => {
        settle(statusCode === 200 && tempFilePath ? { briefImageSrc: tempFilePath } : {});
      },
      fail: () => settle(),
    });
  },

  _clearBriefTimer() {
    if (!this._briefTimer) return;
    clearTimeout(this._briefTimer);
    this._briefTimer = null;
  },

  // 正文(report,DB 读得快)就绪即解除整页 loading 立刻显示,不等一图看懂(异步加载、骨架占位)。
  _finishLoadingIfReady() {
    if (!this._reportSettled) return;
    if (this.data.loading) this.setData({ loading: false });
  },

  onBriefError() {
    this.setData({ briefImageSrc: '' });
  },

  onTacticsError() {
    // 临时文件意外失效等极端情况：整块隐藏兜底
    this.setData({ showTactics: false });
  },

  onRatingsError() {
    this.setData({ showRatings: false });
  },

  saveRatingsCardImage() {
    const { reportId, ratingsImageSrc } = this.data;
    if (!ratingsImageSrc) return;
    app().track('E012', 'share_platform_select', { platform: 'ratings_xhs', report_id: reportId });
    wx.saveImageToPhotosAlbum({
      filePath: ratingsImageSrc,
      success: () => {
        app().track('E014', 'share_complete', { platform: 'ratings_xhs', report_id: reportId });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
      },
    });
  },

  saveTacticsCardImage() {
    const { reportId, tacticsImageSrc } = this.data;
    if (!tacticsImageSrc) return;
    app().track('E012', 'share_platform_select', { platform: 'tactics_xhs', report_id: reportId });
    // 图已在本地临时文件，直接存相册，不再二次下载
    wx.saveImageToPhotosAlbum({
      filePath: tacticsImageSrc,
      success: () => {
        app().track('E014', 'share_complete', { platform: 'tactics_xhs', report_id: reportId });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
      },
    });
  },

  saveBriefCardImage() {
    const { reportId } = this.data;
    app().track('E012', 'share_platform_select', { platform: 'brief_xhs', report_id: reportId });
    const url = `${app().globalData.apiBase}/card/${reportId}?style=duanzi&platform=xhs&variant=brief&inline=1&_t=${Date.now()}`;
    wx.downloadFile({
      url,
      success: ({ tempFilePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            app().track('E014', 'share_complete', { platform: 'brief_xhs', report_id: reportId });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: () => {
            wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
      },
    });
  },

  // 存"微信版·带码":一图看懂右下角叠小程序码,扫码进小程序(引流)。仅供发微信/朋友圈;
  // 站外(小红书/微博)请用上面无码版,微信码发站外会被限流。带 qr=1 让服务端叠码。
  saveBriefCardImageQr() {
    const { reportId } = this.data;
    app().track('E012', 'share_platform_select', { platform: 'brief_wechat_qr', report_id: reportId });
    const url = `${app().globalData.apiBase}/card/${reportId}?style=duanzi&platform=xhs&variant=brief&qr=1&inline=1&_t=${Date.now()}`;
    wx.downloadFile({
      url,
      success: ({ tempFilePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            app().track('E014', 'share_complete', { platform: 'brief_wechat_qr', report_id: reportId });
            wx.showToast({ title: '已保存(微信版·带码)', icon: 'success' });
          },
          fail: () => {
            wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
      },
    });
  },

  onPaywallTap(e) {
    // iOS 不站内付(防御:即便按钮误显示也转服务号引导,绝不在 iOS 调起虚拟支付)
    if (this.data.isIOS) { this.onIosFollowTap(); return; }
    const sku = e.currentTarget.dataset.sku;
    app().track('E021', 'paywall_click', { sku, report_id: this.data.reportId });
    createReportPayment({
      app: app(),
      request,
      sku,
      reportId: this.data.reportId,
      scene: 'jsapi_mini',
      // 支付成功 + 查单结算后重载报告,付费墙消失、全文展开(不依赖 notify 时序)
      onPaid: () => this.loadReport(this.data.reportId),
    });
  },

  // iOS 引导关注服务号(策略 C):站内不付费,复制服务号名 + 弹窗指引去微信搜一搜关注。
  // 注意:不出现"支付/付费/价格"等字样,降低 iOS 虚拟支付合规风险(文案最终由产品确认)。
  onIosFollowTap() {
    app().track('E021', 'paywall_click', {
      sku: 'deep_report',
      report_id: this.data.reportId,
      platform: 'ios',
      action: 'follow_service',
    });
    wx.setClipboardData({
      data: SERVICE_ACCOUNT_NAME,
      success: () => {
        wx.showModal({
          title: '查看完整深度战报',
          content: `已复制服务号名「${SERVICE_ACCOUNT_NAME}」。请到微信「搜一搜」关注服务号,在服务号内查看完整深度战报。`,
          showCancel: false,
          confirmText: '我知道了',
        });
      },
    });
  },
});
