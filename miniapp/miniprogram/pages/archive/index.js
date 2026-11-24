const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');
const journal = require('../../libs/journal');

function monthShift(ym, delta) {
  const d = new Date(ym + '-01T00:00:00');
  d.setMonth(d.getMonth() + delta);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1);
}

function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

Page({
  data: {
    ym: '',
    title: '',
    days: [],
    totals: { trained: 0, sets: 0, volume: 0, cardioMin: 0, notes: 0 },
    detail: null,
    canNext: false
  },

  onLoad() {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    this.load(now.getFullYear() + '-' + p(now.getMonth() + 1));
  },

  load(ym) {
    const train = engine.ensureTrain(store.getTrain());
    const cks = journal.allCheckins();
    const n = monthDays(ym);
    const rows = [];
    const totals = { trained: 0, sets: 0, volume: 0, cardioMin: 0, notes: 0 };
    for (let i = 1; i <= n; i++) {
      const dk = ym + '-' + String(i).padStart(2, '0');
      if (dk > engine.dayKey()) continue;
      const s = engine.dayStat(train, dk);
      const ck = cks[dk];
      if (!s.done && !s.cardioMin && !ck) continue;
      const items = engine.dayItems(train, dk);
      totals.trained += (s.done || s.cardioMin) ? 1 : 0;
      totals.sets += s.done;
      totals.volume += s.volume;
      totals.cardioMin += s.cardioMin;
      if (ck) totals.notes++;
      rows.push({
        date: dk,
        label: dk.slice(5),
        weekday: '周' + '日一二三四五六'[new Date(dk + 'T00:00:00').getDay()],
        line: items.map(it => it.name + (it.type === 'cardio' ? ' ' + it.min + '′' : '')).join('、') || '只记了状态',
        sets: s.done + '/' + s.total,
        volume: s.volume,
        cardioMin: s.cardioMin,
        mood: ck && ck.mood ? ck.mood : 0,
        energy: ck && ck.energy ? ck.energy : 0,
        items,
        note: ck && ck.note ? ck.note : '',
        sleepH: ck && ck.sleepH ? ck.sleepH : null
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const title = ym.slice(0, 4) + ' 年 ' + Number(ym.slice(5, 7)) + ' 月';
    this.setData({
      ym, title, days: rows, totals,
      canNext: ym < engine.dayKey().slice(0, 7),
      detail: null
    });
  },

  prevMonth() { this.load(monthShift(this.data.ym, -1)); },
  nextMonth() { if (this.data.canNext) this.load(monthShift(this.data.ym, 1)); },

  noop() {},

  openDay(e) {
    const dk = e.currentTarget.dataset.date;
    const row = this.data.days.find(d => d.date === dk);
    if (row) this.setData({ detail: row });
  },
  closeDay() { this.setData({ detail: null }); },

  openReview(e) {
    const dk = e.currentTarget.dataset.date;
    wx.navigateTo({ url: '/pages/review/index?date=' + dk });
  }
});
