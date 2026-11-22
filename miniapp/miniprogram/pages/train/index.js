const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');

let openMap = {};

function buildView(date) {
  const train = engine.ensureTrain(store.getTrain());
  const items = engine.dayItems(train, date);
  const list = items.map(it => {
    if (it.type === 'cardio') {
      return {
        uid: it.uid,
        isCardio: true,
        name: it.name,
        line: (it.min || 0) + ' 分钟',
        done: !!it.done,
        doneN: it.done ? 1 : 0,
        totalN: 1,
        groups: [],
        open: false
      };
    }
    const gs = it.groups || [];
    return {
      uid: it.uid,
      isCardio: false,
      exId: it.exId,
      name: it.name,
      part: it.part,
      line: engine.groupLine(gs),
      doneN: gs.filter(g => g.done).length,
      totalN: gs.length || it.sets || 0,
      volume: it.volume || 0,
      open: !!openMap[it.uid],
      groups: gs.map(g => ({
        no: g.warmup ? 'W' : g.no,
        txt: (g.weight > 0 ? g.weight + 'kg' : '自重') + ' × ' + g.reps,
        done: !!g.done,
        warmup: !!g.warmup
      }))
    };
  });
  return { list, summary: engine.summaryText(items), empty: !list.length };
}

Page({
  data: {
    date: '',
    dateLabel: '',
    isToday: true,
    list: [],
    summary: '—',
    empty: true,
    editorVisible: false,
    payload: null,
    streak: 0,
    weekDone: 0,
    kpis: []
  },

  onLoad() {
    this.setData({ date: engine.dayKey() });
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const date = this.data.date || engine.dayKey();
    const v = buildView(date);
    const week = engine.lastNDays(store.getTrain(), 7);
    const weekDone = week.reduce((a, d) => a + d.done, 0);
    const streak = engine.streakDays(store.getTrain());
    this.setData({
      dateLabel: engine.dateLabel(date),
      isToday: date === engine.dayKey(),
      list: v.list,
      summary: v.summary,
      empty: v.empty,
      streak,
      weekDone,
      kpis: [
        { v: weekDone, l: '本周组数' },
        { v: streak, l: '连续天数' },
        { v: v.list.length, l: '当天动作' }
      ]
    });
  },

  prevDay() {
    const d = new Date(this.data.date + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    openMap = {};
    this.setData({ date: engine.dayKey(d) });
    this.refresh();
  },

  nextDay() {
    const d = new Date(this.data.date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const dk = engine.dayKey(d);
    if (dk > engine.dayKey()) return;
    openMap = {};
    this.setData({ date: dk });
    this.refresh();
  },

  backToday() {
    openMap = {};
    this.setData({ date: engine.dayKey() });
    this.refresh();
  },

  toggleRow(e) {
    const uidVal = e.currentTarget.dataset.uid;
    openMap[uidVal] = !openMap[uidVal];
    this.refresh();
  },

  // 点某一组：直接打卡 / 取消
  tapGroup(e) {
    const uid = e.currentTarget.dataset.uid;
    const i = Number(e.currentTarget.dataset.i);
    const rec = actions.toggleGroup(this.data.date, uid, i);
    if (rec) {
      wx.vibrateShort({ type: 'light' });
      this.refresh();
    }
  },

  openEdit(e) {
    const uid = e.currentTarget.dataset.uid;
    const cardio = e.currentTarget.dataset.cardio;
    const train = engine.ensureTrain(store.getTrain());
    if (cardio) {
      const c = (train.cardio || []).find(x => x && x.uid === uid);
      if (!c) return;
      this.setData({
        editorVisible: true,
        payload: { mode: 'cardio', uid: c.uid, name: c.modal || c.name, min: c.min || 30, done: !!c.done, date: this.data.date }
      });
      return;
    }
    const r = (train.records || []).find(x => x && x.uid === uid);
    if (!r) return;
    this.setData({
      editorVisible: true,
      payload: {
        mode: 'strength', uid: r.uid, name: r.name, part: r.part, exId: r.exId,
        date: this.data.date, groups: engine.ensureGroups(r)
      }
    });
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
              mode: 'strength', isNew: true, name: ex.n, part: ex.p, exId: ex.id, date: this.data.date,
              groups: [{ no: 1, reps: 10, weight: 0, done: false }]
            }
          });
        }
      }
    });
  },

  focus(e) {
    this.openFocusByUid(e.currentTarget.dataset.uid);
  },

  openFocusByUid(uid) {
    const train = engine.ensureTrain(store.getTrain());
    const r = (train.records || []).find(x => x && x.uid === uid);
    if (!r) return;
    const gs = engine.ensureGroups(r);
    const reps = gs[0] ? gs[0].reps : (r.reps || 10);
    const weight = gs[0] ? gs[0].weight : (r.weight || 0);
    wx.navigateTo({
      url: '/pages/focus/index?name=' + encodeURIComponent(r.name || '') +
        '&part=' + encodeURIComponent(r.part || '') + '&exId=' + (r.exId || '') +
        '&sets=' + (gs.length || 3) + '&reps=' + (reps || 10) + '&weight=' + (weight || 0) +
        '&date=' + (r.date || this.data.date) + '&uid=' + uid
    });
  },

  // 悬浮球「专注」：优先开当天第一个没练完的动作
  orbFocus() {
    const items = engine.dayItems(engine.ensureTrain(store.getTrain()), this.data.date);
    const st = items.filter(it => it.type !== 'cardio');
    const undone = st.filter(it => (it.groups || []).some(g => !g.done));
    const target = undone[0] || st[0];
    if (!target) {
      wx.showToast({ title: '先添加一个动作再开专注', icon: 'none' });
      return;
    }
    this.openFocusByUid(target.uid);
  },

  afterNote() {
    this.refresh();
  },

  // 底部唯一的动作入口：动作库 / 有氧 / 拍照识别
  openAddSheet() {
    wx.showActionSheet({
      itemList: ['从动作库添加', '添加有氧', '拍照识别'],
      success: (r) => {
        if (r.tapIndex === 0) this.openLibrary();
        else if (r.tapIndex === 1) this.addCardio();
        else if (r.tapIndex === 2) {
          wx.showToast({ title: '拍照识别还在接入，先用动作库', icon: 'none' });
        }
      }
    });
  },

  goPlan() {
    wx.navigateTo({ url: '/pages/plan/index' });
  },

  addExercise() {
    wx.navigateTo({
      url: '/pages/picker/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          this.setData({
            editorVisible: true,
            payload: {
              mode: 'strength', isNew: true, name: ex.n, part: ex.p, exId: ex.id, date: this.data.date,
              groups: [{ no: 1, reps: 10, weight: 0, done: false }]
            }
          });
        }
      }
    });
  },

  addCardio() {
    this.setData({
      editorVisible: true,
      payload: { mode: 'cardio', isNew: true, name: '椭圆机', min: 30, done: true, date: this.data.date }
    });
  },

  onEditorClose() {
    this.setData({ editorVisible: false, payload: null });
  },

  onEditorConfirm(e) {
    const d = e.detail;
    const rec = Object.assign({}, d.record, { date: this.data.date });
    if (d.mode === 'cardio') actions.saveCardio(rec);
    else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: d.isNew ? '已添加' : '已保存', icon: 'none' });
  },

  onEditorDelete(e) {
    const d = e.detail;
    if (d.mode === 'cardio') actions.deleteCardio(d.uid, this.data.date);
    else actions.deleteStrength(d.uid, this.data.date);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  goLog() {
    wx.switchTab({ url: '/pages/log/index' });
  }
});
