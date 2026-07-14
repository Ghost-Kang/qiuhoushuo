// 小组积分榜 端内页(产品 UX 重设计):顶部 12 组导航 + swiper 左右滑切组,
// 每组「积分表 + 晋级后对阵(淘汰赛)」,涉及队伍全带国旗(flagOf),队名中文(teamZh)。
function app() { return getApp(); }
const { request } = require('../../utils/api');
const { teamZh, flagOf } = require('../../utils/teams');

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ROUND_ZH = { 'Round of 32': '32强赛', 'Round of 16': '16强赛', 'Quarter-finals': '1/4决赛', 'Semi-finals': '半决赛', Final: '决赛' };

/** ISO → 北京 "6/28 周日 20:00"。 */
function friendlyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000); // UTC+8,下面用 getUTC* 取北京墙钟
  const hh = String(bj.getUTCHours()).padStart(2, '0');
  const mm = String(bj.getUTCMinutes()).padStart(2, '0');
  return `${bj.getUTCMonth() + 1}/${bj.getUTCDate()} ${WEEKDAY[bj.getUTCDay()]} ${hh}:${mm}`;
}

function rankClass(rank) {
  if (rank <= 2) return 'q'; // 出线区
  if (rank === 3) return 't'; // 第三名待定
  return 'o'; // 淘汰
}

Page({
  data: {
    groups: [], // [{ id:'A', table:[...], nextMatches:[...] }]
    current: 0,
    asof: '',
    swiperH: 720, // swiper 需显式高度,先给保底值,渲染后量算
    loading: true,
    loadError: false,
  },

  onLoad() {
    app().track('E007', 'standings_view', {});
    this.load();
  },

  load() {
    this.setData({ loading: true, loadError: false });
    request({
      url: `${app().globalData.apiBase}/standings`,
      success: (res) => {
        const d = (res && res.data) || {};
        this.setData({ groups: this._build(d.groups || [], d.knockout || []), asof: d.asof || '', loading: false }, () => this._measure());
      },
      fail: () => this.setData({ loading: false, loadError: true }),
    });
  },

  // 组数据 + 每组「晋级后对阵」(全局淘汰赛对阵按队名反查归组)
  _build(groups, knockout) {
    const koByTeam = {};
    (knockout || []).forEach((m) => { koByTeam[m.home] = m; koByTeam[m.away] = m; });
    return (groups || []).map((g) => {
      const table = (g.rows || []).map((r) => ({
        rank: r.rank,
        teamZh: teamZh(r.team),
        flag: flagOf(r.team),
        played: r.played, win: r.win, draw: r.draw, lose: r.lose,
        gdLabel: r.goalsDiff > 0 ? `+${r.goalsDiff}` : String(r.goalsDiff),
        points: r.points,
        qualified: r.qualified,
        cls: rankClass(r.rank),
      }));
      // 「晋级后对阵」展示本组**每支已出线队**的去向:对手已抽出→对阵卡;未抽出→对手待定。
      // (R32 共 16 场,数据源只在两队都确定后才建对阵;故榜首常因对手是"最佳第三名待定"而暂无对阵。)
      const groupTeams = new Set((g.rows || []).map((r) => r.team));
      const seen = new Set();
      const nextMatches = [];
      (g.rows || []).forEach((r) => {
        if (!r.qualified) return; // 只展示已出线队的去向
        const m = koByTeam[r.team];
        if (m) {
          // ⚠️ 一场淘汰赛对阵两队来自不同组,会同时出现在两队各自所在组——不锚定就看着像"重复显示2次"
          //    (如 巴西vs日本 同时进 C 组和 F 组)。修法:锚定「本组出线队」为主位,卡片读作"本组队 → 对手",
          //    各组只讲自家队的去向,不再像同一张对阵卡被复制。key 用排序后无序对,只挡"同组两队互相对阵"的真重复。
          const key = [m.home, m.away].slice().sort().join('|');
          if (seen.has(key)) return; // 同组两队互相对阵(罕见)只显一次
          seen.add(key);
          const opp = m.home === r.team ? m.away : m.home; // 对手 = 对阵里非本组队的一方
          nextMatches.push({
            id: `${r.team}-next`, kind: 'match',
            homeZh: teamZh(r.team), homeFlag: flagOf(r.team), homeIsThisGroup: true, // 本组队恒主位
            awayZh: teamZh(opp), awayFlag: flagOf(opp), awayIsThisGroup: groupTeams.has(opp),
            dateLabel: friendlyDate(m.kickoffAt),
            roundZh: ROUND_ZH[m.round] || m.round,
          });
        } else {
          nextMatches.push({ id: `tbd-${r.team}`, kind: 'tbd', teamZh: teamZh(r.team), flag: flagOf(r.team) });
        }
      });
      return { id: g.group, table, nextMatches };
    });
  },

  // swiper 不自适应内容高 → 量当前组内容实高写回(进页 + 切组)
  _measure() {
    const idx = this.data.current;
    wx.createSelectorQuery().in(this).select(`#gi-${idx}`).boundingClientRect((rect) => {
      if (rect && rect.height) this.setData({ swiperH: Math.ceil(rect.height) + 8 });
    }).exec();
  },

  onTabTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (idx >= 0 && idx !== this.data.current) this.setData({ current: idx }, () => this._measure());
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current }, () => this._measure());
  },

  saveCurrentGroup() {
    const grp = this.data.groups[this.data.current];
    if (!grp) return;
    app().track('E012', 'share_platform_select', { platform: 'standings_xhs', group: grp.id });
    wx.showLoading({ title: '生成中…', mask: true });
    wx.downloadFile({
      url: `${app().globalData.apiBase}/card/standings?group=${grp.id}&inline=1&_t=${Date.now()}`,
      timeout: 20000,
      success: ({ statusCode, tempFilePath }) => {
        wx.hideLoading();
        if (statusCode !== 200 || !tempFilePath) {
          wx.showToast({ title: statusCode === 404 ? '该组暂无数据' : '生成失败,请稍后再试', icon: 'none' });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => { app().track('E014', 'share_complete', { platform: 'standings_xhs', group: grp.id }); wx.showToast({ title: '已保存到相册', icon: 'success' }); },
          fail: () => wx.showToast({ title: '保存失败,请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络异常,请稍后再试', icon: 'none' }); },
    });
  },
});
