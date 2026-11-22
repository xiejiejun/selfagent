const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const sync = require('../../libs/sync/index');

Page({
  data: {
    height: '',
    weight: '',
    goal: '',
    logsCount: 0,
    recordsCount: 0,
    cardioCount: 0,
    syncText: '未同步',
    cloudReady: false,
    busy: false
  },

  onShow() {
    this.refresh();
    const app = getApp();
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
  },

  refresh() {
    const p = store.getProfile() || {};
    const train = engine.ensureTrain(store.getTrain());
    const st = store.getSyncState() || {};
    const ts = ['logs', 'train', 'profile', 'settings'].reduce((a, k) => Math.max(a, Number(st[k]) || 0), 0);
    const last = ts ? engine.fmtTime(new Date(ts).toISOString()) + ' 同步过' : '未同步';
    this.setData({
      height: p.height || '',
      weight: p.weight || '',
      goal: p.goal || '',
      logsCount: (store.getLogs() || []).length,
      recordsCount: (train.records || []).length,
      cardioCount: (train.cardio || []).length,
      syncText: last
    });
  },

  onField(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  saveProfile() {
    const p = store.getProfile() || {};
    p.height = this.data.height;
    p.weight = this.data.weight;
    p.goal = this.data.goal;
    store.setProfile(p);
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  exportData() {
    const dump = {
      logs: store.getLogs(),
      train: store.getTrain(),
      profile: store.getProfile(),
      settings: store.getSettings(),
      tomb: store.getTomb()
    };
    wx.setClipboardData({
      data: JSON.stringify(dump),
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' })
    });
  },

  importData() {
    wx.getClipboardData({
      success: (r) => {
        let obj = null;
        try { obj = JSON.parse(r.data); } catch (e) { obj = null; }
        if (!obj || (!obj.logs && !obj.train)) {
          wx.showToast({ title: '剪贴板不是有效数据', icon: 'none' });
          return;
        }
        wx.showModal({
          title: '覆盖导入',
          content: '会用剪贴板数据覆盖本机的记录与训练数据，确定继续？',
          confirmText: '导入',
          success: (m) => {
            if (!m.confirm) return;
            if (obj.logs) store.setLogs(obj.logs);
            if (obj.train) store.setTrain(obj.train);
            if (obj.profile) store.setProfile(obj.profile);
            if (obj.settings) store.setSettings(obj.settings);
            if (obj.tomb) store.setTomb(obj.tomb);
            this.refresh();
            wx.showToast({ title: '已导入', icon: 'none' });
          }
        });
      }
    });
  },

  pushCloud() {
    if (!this.data.cloudReady) {
      wx.showModal({ title: '云开发未配置', content: '先在 app.js 填 CLOUD_ENV 并部署云函数。', showCancel: false });
      return;
    }
    this.setData({ busy: true });
    sync.push(['logs', 'train', 'profile', 'settings'])
      .then(r => {
        this.setData({ busy: false });
        wx.showToast({ title: r && r.ok ? '已上传' : '上传失败', icon: 'none' });
        this.refresh();
      })
      .catch(err => {
        this.setData({ busy: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
        console.warn('[sync] push', err);
      });
  },

  pullCloud() {
    if (!this.data.cloudReady) {
      wx.showModal({ title: '云开发未配置', content: '先在 app.js 填 CLOUD_ENV 并部署云函数。', showCancel: false });
      return;
    }
    this.setData({ busy: true });
    sync.pull(['logs', 'train', 'profile', 'settings'])
      .then(r => {
        this.setData({ busy: false });
        this.refresh();
        wx.showToast({ title: r && r.ok ? '已拉取合并' : '拉取失败', icon: 'none' });
      })
      .catch(err => {
        this.setData({ busy: false });
        wx.showToast({ title: '拉取失败', icon: 'none' });
        console.warn('[sync] pull', err);
      });
  },

  clearAll() {
    wx.showModal({
      title: '清空本机数据',
      content: '会删掉本机所有记录与训练数据（云端不动），确定？',
      confirmText: '清空',
      confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        store.setLogs([]);
        store.setTrain({});
        store.setTomb([]);
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  }
});
