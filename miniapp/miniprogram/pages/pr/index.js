const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');
const stats = require('../../libs/stats');

Page({
  data: {
    list: [],
    parts: ['全部'],
    part: '全部',
    openName: '',
    openBars: [],
    total: 0
  },

  onLoad() { this.refresh(); },

  refresh() {
    const all = stats.prList(store.getTrain());
    const parts = ['全部'];
    all.forEach(p => { if (p.part && parts.indexOf(p.part) < 0) parts.push(p.part); });
    this.all = all;
    this.setData({ parts, total: all.length });
    this.apply();
    if (!this.data.openName && all.length) this.open({ currentTarget: { dataset: { name: all[0].name } } });
  },

  apply() {
    const part = this.data.part;
    const list = (this.all || []).filter(p => part === '全部' || p.part === part).slice(0, 60).map(p => ({
      name: p.name, part: p.part, bestW: p.bestW, reps: p.reps, e1rm: p.e1rm, date: p.date, sets: p.sets
    }));
    this.setData({ list });
  },

  onPart(e) {
    this.setData({ part: e.currentTarget.dataset.p, openName: '', openBars: [] });
    this.apply();
  },

  open(e) {
    const name = e.currentTarget.dataset.name;
    const p = (this.all || []).find(x => x.name === name);
    if (!p) return;
    const hist = p.history || [];
    const maxW = Math.max(1, ...hist.map(h => h.weight || 0));
    const bars = hist.map(h => ({
      date: h.date.slice(5),
      weight: h.weight,
      reps: h.reps,
      txt: h.weight > 0 ? engine.wText(h.weight, engine.isUniName(name)) + '×' + h.reps : '自重×' + h.reps,      h: h.weight ? Math.max(8, Math.round((h.weight / maxW) * 100)) : 0
    }));
    this.setData({ openName: name, openBars: bars, openInfo: p });
  },

  pick(e) {
    const name = e.currentTarget.dataset.name;
    const ex = { id: '', n: name, p: (this.all.find(x => x.name === name) || {}).part || '' };
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) { ch.emit('pick', ex); wx.navigateBack(); }
    else wx.showToast({ title: '从训练页添加时可直接带入', icon: 'none' });
  }
});
