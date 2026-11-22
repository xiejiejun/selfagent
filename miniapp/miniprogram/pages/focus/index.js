const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const store = require('../../libs/store/index');

Page({
  data: {
    name: '',
    part: '',
    date: '',
    exId: '',
    uid: '',
    sets: 3,
    reps: 10,
    weight: 0,
    rest: 60,
    stage: 'ready',
    left: 0,
    elapsed: 0,
    done: 0,
    total: 0,
    volume: 0,
    hint: '准备好后点开始',
    rows: []
  },

  onLoad(q) {
    const sets = Math.max(1, Number(q.sets) || 3);
    const reps = Number(q.reps) || 10;
    const weight = Number(q.weight) || 0;
    this.setData({
      name: decodeURIComponent(q.name || ''),
      part: decodeURIComponent(q.part || ''),
      date: q.date || engine.dayKey(),
      exId: q.exId || '',
      uid: q.uid || engine.uid('t'),
      sets,
      reps,
      weight,
      total: sets,
      rows: Array.from({ length: sets }, (_, i) => ({ no: i + 1, reps, weight, done: false }))
    });
  },

  onReady() {
    wx.createSelectorQuery().in(this).select('#rings').fields({ node: true, size: true }).exec(res => {
      const r = res && res[0];
      if (!r || !r.node) return;
      const c = r.node;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      this.cv = { node: c, ctx, size: r.width };
      this.draw();
    });
  },

  draw() {
    const cv = this.cv;
    if (!cv) return;
    const ctx = cv.ctx;
    const s = cv.size;
    const cx = s / 2, cy = s / 2;
    ctx.clearRect(0, 0, s, s);
    const rings = [
      { r: s / 2 - 14, p: this.data.total ? this.data.done / this.data.total : 0, c: '#12A594', w: 14 },
      { r: s / 2 - 38, p: Math.min(1, this.data.elapsed / 1800), c: '#3DDCBF', w: 10 },
      { r: s / 2 - 58, p: Math.min(1, this.data.volume / Math.max(1, this.data.sets * this.data.reps * Math.max(1, this.data.weight))), c: '#D8A23E', w: 8 }
    ];
    rings.forEach(rg => {
      ctx.beginPath();
      ctx.arc(cx, cy, rg.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = rg.w;
      ctx.stroke();
      if (rg.p > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, rg.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rg.p);
        ctx.strokeStyle = rg.c;
        ctx.lineWidth = rg.w;
        ctx.stroke();
      }
    });
  },

  tick() {
    const now = Date.now();
    const d = {};
    if (this.t0) d.elapsed = Math.round((now - this.t0) / 1000);
    if (this.restEnd) {
      const left = Math.max(0, Math.round((this.restEnd - now) / 1000));
      d.left = left;
      if (left <= 0) {
        this.restEnd = null;
        d.stage = 'work';
        d.hint = '休息结束，做第 ' + (this.data.done + 1) + ' 组';
      }
    }
    this.setData(d);
    this.draw();
  },

  start() {
    this.t0 = this.t0 || Date.now();
    this.setData({ stage: 'work', hint: '做第 1 组：' + this.data.reps + ' 次' + (this.data.weight > 0 ? ' · ' + this.data.weight + 'kg' : ' · 自重') });
    wx.setKeepScreenOn({ keepScreenOn: true });
    if (!this.timer) this.timer = setInterval(() => this.tick(), 500);
  },

  setDone() {
    const rows = this.data.rows.slice();
    const i = this.data.done;
    if (!rows[i]) return;
    rows[i].done = true;
    const done = this.data.done + 1;
    const volume = Math.round(this.data.volume + (rows[i].reps || 0) * (rows[i].weight || 0));
    wx.vibrateShort({ type: 'medium' });
    this.save(rows);
    if (done >= this.data.total) {
      this.setData({ rows, done, volume, stage: 'finish', hint: '全部完成，收工' });
      this.draw();
      wx.vibrateShort({ type: 'heavy' });
      return;
    }
    this.restEnd = Date.now() + this.data.rest * 1000;
    this.setData({
      rows, done, volume, stage: 'rest', left: this.data.rest,
      hint: '休息 ' + this.data.rest + 's，然后第 ' + (done + 1) + ' 组'
    });
    this.draw();
  },

  addRep() {
    const rows = this.data.rows.slice();
    const i = this.data.done;
    if (rows[i]) rows[i].reps = Math.max(1, (rows[i].reps || 0) + 1);
    this.setData({ rows });
  },

  subRep() {
    const rows = this.data.rows.slice();
    const i = this.data.done;
    if (rows[i]) rows[i].reps = Math.max(1, (rows[i].reps || 0) - 1);
    this.setData({ rows });
  },

  skipRest() {
    this.restEnd = null;
    this.setData({ stage: 'work', left: 0, hint: '做第 ' + (this.data.done + 1) + ' 组' });
  },

  save(rows) {
    actions.saveStrength({
      uid: this.data.uid,
      date: this.data.date,
      exId: this.data.exId,
      name: this.data.name,
      part: this.data.part,
      sets: this.data.sets,
      reps: this.data.reps,
      weight: this.data.weight,
      groups: (rows || this.data.rows).map((r, i) => ({
        no: i + 1, reps: r.reps, weight: r.weight, done: !!r.done, warmup: false, rpe: 0, sec: 0
      }))
    });
  },

  finish() {
    this.save();
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    wx.vibrateShort({ type: 'heavy' });
    wx.showToast({ title: '已记入训练', icon: 'none' });
    setTimeout(() => wx.navigateBack(), 500);
  },

  onUnload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    wx.setKeepScreenOn({ keepScreenOn: false });
  }
});
