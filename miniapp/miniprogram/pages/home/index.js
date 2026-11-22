const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');

Page({
  data: {
    todayLabel: '',
    today: { n: 0, done: 0, total: 0, volume: 0, cardioMin: 0 },
    week: [],
    streak: 0,
    names: [],
    hasToday: false,
    weight: '',
    goal: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const train = engine.ensureTrain(store.getTrain());
    const todayKey = engine.dayKey();
    const t = engine.dayStat(train, todayKey);
    const week = engine.lastNDays(train, 7).reverse();
    const maxV = week.reduce((a, d) => Math.max(a, d.volume), 1);
    const profile = store.getProfile() || {};

    this.setData({
      todayLabel: engine.dateLabel(todayKey),
      today: { n: t.n, done: t.done, total: t.total, volume: t.volume, cardioMin: t.cardioMin },
      week: week.map(d => ({
        label: engine.shortDate(d.date),
        volume: d.volume,
        done: d.done,
        h: Math.max(6, Math.round((d.volume / maxV) * 100)),
        today: d.date === todayKey
      })),
      streak: engine.streakDays(train),
      names: t.items.map(i => i.name),
      hasToday: t.n > 0 || t.cardioMin > 0,
      weight: profile.weight || '',
      goal: profile.goal || ''
    });
  },

  goTrain() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  goRecord() {
    wx.switchTab({ url: '/pages/log/index' });
  },

  goAgent() {
    wx.switchTab({ url: '/pages/agent/index' });
  }
});
