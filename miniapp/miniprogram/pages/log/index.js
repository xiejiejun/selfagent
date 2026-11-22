const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');

let openMap = {};

function buildTimeline() {
  const logs = (store.getLogs() || []).slice();
  logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')));

  const groups = [];
  logs.forEach(l => {
    const dk = l.date || engine.dayKey(l.time);
    let g = groups[groups.length - 1];
    if (!g || g.date !== dk) {
      g = { date: dk, label: engine.dateLabel(dk), logs: [] };
      groups.push(g);
    }

    if (l.kind === 'train') {
      const items = (l.meta && l.meta.items) || [];
      const rows = items.map(it => {
        if (it.type === 'cardio') {
          return { uid: it.uid || '', isCardio: true, name: it.name, line: (it.min || 0) + ' 分钟', done: !!it.done, groups: [] };
        }
        const gs = it.groups || [];
        return {
          uid: it.uid || '',
          isCardio: false,
          name: it.name,
          line: engine.groupLine(gs),
          doneN: gs.filter(x => x.done).length,
          totalN: gs.length || it.sets || 0,
          open: !!openMap[l.id + ':' + (it.uid || it.name)],
          key: l.id + ':' + (it.uid || it.name),
          groups: gs.map(g => ({ no: g.warmup ? 'W' : g.no, txt: (g.weight > 0 ? g.weight + 'kg' : '自重') + ' × ' + g.reps, done: !!g.done }))
        };
      });
      g.logs.push({
        id: l.id,
        kind: 'train',
        isTrain: true,
        timeText: engine.fmtTime(l.time),
        summary: engine.summaryText(items),
        rows
      });
      return;
    }

    g.logs.push({
      id: l.id,
      kind: l.kind || 'note',
      isTrain: false,
      timeText: engine.fmtTime(l.time),
      text: l.content || '',
      tags: l.tags || ''
    });
  });

  return groups;
}

Page({
  data: {
    groups: [],
    quickText: '',
    editorVisible: false,
    payload: null,
    todayCount: 0
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const groups = buildTimeline();
    const today = engine.dayKey();
    const t = groups.find(g => g.date === today);
    this.setData({ groups, todayCount: t ? t.logs.length : 0 });
  },

  onQuickInput(e) {
    this.setData({ quickText: e.detail.value });
  },

  saveQuick() {
    const txt = (this.data.quickText || '').trim();
    if (!txt) return;
    actions.addNote(txt);
    this.setData({ quickText: '' });
    this.refresh();
    wx.showToast({ title: '已记录', icon: 'none' });
  },

  toggleRow(e) {
    const id = e.currentTarget.dataset.id;
    const key = e.currentTarget.dataset.key;
    openMap[key] = !openMap[key];
    this.refresh();
  },

  editRow(e) {
    const uid = e.currentTarget.dataset.uid;
    const cardio = e.currentTarget.dataset.cardio;
    const date = e.currentTarget.dataset.date;
    const train = engine.ensureTrain(store.getTrain());
    if (cardio) {
      const c = (train.cardio || []).find(x => x && x.uid === uid);
      if (!c) return;
      this.setData({
        editorVisible: true,
        payload: { mode: 'cardio', uid: c.uid, name: c.modal || c.name, min: c.min || 30, done: !!c.done, date }
      });
      return;
    }
    const r = (train.records || []).find(x => x && x.uid === uid);
    if (!r) return;
    this.setData({
      editorVisible: true,
      payload: { mode: 'strength', uid: r.uid, name: r.name, part: r.part, exId: r.exId, date, groups: engine.ensureGroups(r) }
    });
  },

  addToDay(e) {
    const date = e.currentTarget.dataset.date;
    wx.navigateTo({
      url: '/pages/picker/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          this.setData({
            editorVisible: true,
            payload: { mode: 'strength', isNew: true, name: ex.n, part: ex.p, exId: ex.id, date, groups: [{ no: 1, reps: 10, weight: 0, done: false }] }
          });
        }
      }
    });
  },

  delLog(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录',
      content: '只删这条日志；训练数据仍在训练页，可去「训练」删动作。',
      confirmText: '删除',
      confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        actions.removeLog(id);
        this.refresh();
      }
    });
  },

  onEditorClose() {
    this.setData({ editorVisible: false, payload: null });
  },

  onEditorConfirm(e) {
    const d = e.detail;
    const cur = this.data.payload || {};
    const date = cur.date || (d.record && d.record.date) || engine.dayKey();
    const rec = Object.assign({}, d.record, { date });
    if (d.mode === 'cardio') actions.saveCardio(rec);
    else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: d.isNew ? '已添加' : '已保存', icon: 'none' });
  },

  onEditorDelete(e) {
    const d = e.detail;
    const date = (this.data.payload && this.data.payload.date) || engine.dayKey();
    if (d.mode === 'cardio') actions.deleteCardio(d.uid, date);
    else actions.deleteStrength(d.uid, date);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  }
});
