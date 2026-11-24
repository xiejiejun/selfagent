const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');
const journal = require('../../libs/journal');

Page({
  data: {
    date: '',
    label: '',
    stat: { sets: 0, total: 0, volume: 0, cardioMin: 0, n: 0 },
    names: [],
    energy: 0,
    mood: 0,
    sleepH: '',
    note: '',
    yesterday: '',
    savedText: '',
    energyOpts: [1, 2, 3, 4, 5],
    moodOpts: [1, 2, 3, 4, 5]
  },

  onLoad(q) {
    const dk = q.date || engine.dayKey();
    const train = engine.ensureTrain(store.getTrain());
    const s = engine.dayStat(train, dk);
    const items = engine.dayItems(train, dk);
    const ck = journal.getCheckin(dk) || {};
    const d = new Date(dk + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const yk = engine.dayKey(d);
    const ys = engine.dayStat(train, yk);
    this.setData({
      date: dk,
      label: engine.dateLabel(dk),
      stat: { sets: s.done, total: s.total, volume: s.volume, cardioMin: s.cardioMin, n: s.n },
      names: items.map(it => it.name + (it.type === 'cardio' ? ' ' + it.min + '′' : '')),
      energy: ck.energy || 0,
      mood: ck.mood || 0,
      sleepH: ck.sleepH || '',
      note: ck.note || '',
      savedText: ck.ts ? '已记录' : '',
      yesterday: (ys.done || ys.cardioMin) ? '昨天：' + ys.done + '/' + ys.total + ' 组 · ' + ys.volume + ' kg' + (ys.cardioMin ? ' · 有氧 ' + ys.cardioMin + '′' : '') : '昨天：休息'
    });
  },

  setEnergy(e) { this.setData({ energy: Number(e.currentTarget.dataset.v) }); },
  setMood(e) { this.setData({ mood: Number(e.currentTarget.dataset.v) }); },
  onSleep(e) { this.setData({ sleepH: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  save() {
    if (!this.data.energy || !this.data.mood) {
      wx.showToast({ title: '精力和情绪都打一下分', icon: 'none' });
      return;
    }
    journal.saveCheckin(this.data.date, {
      energy: this.data.energy,
      mood: this.data.mood,
      sleepH: this.data.sleepH === '' ? null : Number(this.data.sleepH),
      note: (this.data.note || '').trim(),
      sets: this.data.stat.sets,
      volume: this.data.stat.volume,
      cardioMin: this.data.stat.cardioMin
    });
    this.setData({ savedText: '已记录' });
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '复盘已保存', icon: 'none' });
  },

  goBody() { wx.navigateTo({ url: '/pages/body/index' }); },
  goReport() { wx.navigateTo({ url: '/pages/report/index' }); }
});
