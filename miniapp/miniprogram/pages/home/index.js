const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');

Page({
  data: {
    todayLabel: '',
    today: { n: 0, done: 0, total: 0, volume: 0, cardioMin: 0 },
    week: [],
    streak: 0,
    names: [],
    hasToday: false,
    canStart: false,
    kpis: [],
    editorVisible: false,
    payload: null
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
    const streak = engine.streakDays(train);
    const hasToday = t.n > 0 || t.cardioMin > 0;

    this.setData({
      todayLabel: engine.dateLabel(todayKey),
      today: { n: t.n, done: t.done, total: t.total, volume: t.volume, cardioMin: t.cardioMin },
      week: week.map(d => ({
        label: engine.shortDate(d.date),
        volume: d.volume,
        done: d.done,
        h: d.volume > 0 ? Math.max(10, Math.round((d.volume / maxV) * 100)) : 0,
        today: d.date === todayKey
      })),
      streak,
      names: t.items.map(i => i.name),
      hasToday,
      canStart: t.n > 0,
      kpis: [
        { v: t.volume, l: '总容量 kg' },
        { v: t.done + '/' + t.total, l: '组数' },
        { v: t.cardioMin + '′', l: '有氧' },
        { v: streak, l: '连续天' }
      ]
    });
  },

  // 有动作就直接开练，没动作就先挑 —— 主 CTA 不再是死路
  mainCta() {
    if (this.data.canStart) {
      wx.switchTab({ url: '/pages/train/index' });
      return;
    }
    this.openLibrary();
  },

  openLibrary() {
    wx.navigateTo({
      url: '/pages/library/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          this.setData({
            editorVisible: true,
            payload: {
              mode: 'strength',
              isNew: true,
              name: ex.n,
              part: ex.p,
              exId: ex.id,
              date: engine.dayKey(),
              groups: [{ no: 1, reps: 10, weight: 0, done: false }]
            }
          });
        }
      }
    });
  },

  onEditorClose() {
    this.setData({ editorVisible: false, payload: null });
  },

  onEditorConfirm(e) {
    const d = e.detail;
    const rec = Object.assign({}, d.record, { date: engine.dayKey() });
    if (d.mode === 'cardio') actions.saveCardio(rec);
    else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已添加', icon: 'none' });
  },

  onEditorDelete() {
    this.setData({ editorVisible: false, payload: null });
  },

  // 悬浮球在首页的「专注」= 去训练页
  orbFocus() {
    wx.switchTab({ url: '/pages/train/index' });
  }
});
