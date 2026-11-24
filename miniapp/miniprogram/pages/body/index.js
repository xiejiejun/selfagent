const engine = require('../../libs/engine/index');
const journal = require('../../libs/journal');

const FIELDS = [
  { k: 'weight', l: '体重', u: 'kg', ph: '65' },
  { k: 'waist', l: '腰围', u: 'cm', ph: '78' },
  { k: 'chest', l: '胸围', u: 'cm', ph: '100' },
  { k: 'arm', l: '臂围', u: 'cm', ph: '36' },
  { k: 'hip', l: '臀围', u: 'cm', ph: '96' }
];

Page({
  data: {
    date: '',
    fields: FIELDS,
    form: { weight: '', waist: '', chest: '', arm: '', hip: '' },
    list: [],
    bars: [],
    deltaText: '',
    latestText: ''
  },

  onLoad() {
    const dk = engine.dayKey();
    const exists = journal.bodyList().find(x => x.date === dk);
    this.setData({ date: dk, form: Object.assign({}, this.data.form, exists || {}) });
    this.refresh();
  },

  refresh() {
    const all = journal.bodyList().slice(-12);
    const maxW = Math.max(1, ...all.map(x => x.weight || 0));
    const minW = Math.min(...all.map(x => x.weight || 0).filter(w => w));
    const bars = all.map(x => ({
      date: x.date.slice(5),
      weight: x.weight || 0,
      h: x.weight ? Math.max(8, Math.round((x.weight / maxW) * 100)) : 0
    }));
    const withW = all.filter(x => x.weight);
    const deltaText = withW.length >= 2
      ? (withW[withW.length - 1].weight - withW[0].weight >= 0 ? '+' : '') + Math.round((withW[withW.length - 1].weight - withW[0].weight) * 10) / 10 + ' kg（近 ' + withW.length + ' 次）'
      : '记录 2 次以上就能看到变化';
    const latest = all[all.length - 1];
    const latestText = latest ? latest.date + ' · ' + (latest.weight ? latest.weight + ' kg' : '') + (latest.waist ? ' · 腰 ' + latest.waist : '') : '还没有记录';
    this.setData({ list: all.slice().reverse(), bars, deltaText, latestText, minW });
  },

  onField(e) {
    const k = e.currentTarget.dataset.k;
    const form = Object.assign({}, this.data.form);
    form[k] = e.detail.value;
    this.setData({ form });
  },

  save() {
    const f = this.data.form;
    const rec = { date: this.data.date };
    let has = false;
    ['weight', 'waist', 'chest', 'arm', 'hip'].forEach(k => {
      const v = parseFloat(f[k]);
      if (v > 0) { rec[k] = v; has = true; }
    });
    if (!has) { wx.showToast({ title: '至少填一项', icon: 'none' }); return; }
    journal.saveBody(rec);
    wx.showToast({ title: '已记录', icon: 'none' });
    this.refresh();
  },

  del(e) {
    const dk = e.currentTarget.dataset.date;
    wx.showModal({
      title: '删除这条身体记录？',
      content: dk + ' 的体重/围度会一起删掉，训练数据不受影响。',
      confirmText: '删除',
      confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        journal.delBody(dk);
        this.refresh();
      }
    });
  },

  noop() {}
});
