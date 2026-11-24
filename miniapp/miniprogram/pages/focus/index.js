const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const store = require('../../libs/store/index');
const data = require('../../libs/data/index');
const settings = require('../../libs/settings');
const polish = require('../../libs/aipolish');
const decision = require('../../libs/decision');

const FOCUS_KEY = 'selfagent_focus_v1';

function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function secText(sec) {
  const s = Math.round(sec || 0);
  if (!s) return '';
  return s >= 60 ? Math.floor(s / 60) + '′' + String(s % 60).padStart(2, '0') + '″' : s + '″';
}

function loadItems(date) {
  const train = engine.ensureTrain(store.getTrain());
  return engine.dayItems(train, date).map(it => {
    if (it.type === 'cardio') {
      // 计组型有氧：直接进力量卡流程，只多一个「有氧」标记
      const gs = (it.groups || []).map((g, i) => ({
        no: g.no || i + 1,
        reps: g.reps || 0,
        weight: g.weight || 0,
        warmup: false,
        tag: '',
        done: !!g.done,
        sec: g.sec || 0
      }));
      if (it.mode === 'sets' && gs.length) {
        return { type: 'strength', isCardio: true, uid: it.uid, exId: it.exId, name: it.name, part: '有氧', groups: gs };
      }
      return { type: 'cardio', uid: it.uid, exId: it.exId, name: it.name, min: it.min || 30, done: !!it.done, sec: 0 };
    }
    return {
      type: 'strength', uid: it.uid, exId: it.exId, name: it.name, part: it.part,
      groups: (it.groups || []).map((g, i) => ({
        no: g.warmup ? 'W' : (g.no || i + 1),
        reps: g.reps || 0,
        weight: g.weight || 0,
        warmup: !!g.warmup,
        tag: g.tag || (g.warmup ? 'warm' : ''),
        done: !!g.done,
        sec: g.sec || 0
      }))
    };
  });
}

Page({
  data: {
    date: '',
    stage: 'ready',
    idx: 0,
    total: 0,
    pct: 0,
    curType: 'strength',
    curName: '',
    curPart: '',
    setNo: 0,
    setsDone: 0,
    setsTotal: 0,
    mmss: '0:00',
    setTimer: false,
    restPct: 0,
    restLeft: 0,
    restTotal: 60,
    reps: 0,
    weight: 0,
    rpe: 0,
    warmup: false,
    exSheetVisible: false,
    exSheetId: '',
    exSheetName: '',
    detailVisible: false,
    detail: null,
    rows: [],
    queue: [],
    doneSets: 0,
    doneVolume: 0,
    doneCardio: 0,
    sessionSec: 0,
    aiReview: '',
    cardioSec: 0,
    cardioPlanned: 30,
    setsDoneAll: 0,
    setsTotalAll: 0,
    setsPct: 0,
    listVisible: false,
    hint: '',
    restTip: '',
    restAi: '',
    restNextLabel: '跳过休息，下一组',
    advW: 0,
    advReps: 0,
    finNext: null,
    finTomorrow: null,
    finGoal: null
  },

  onLoad(q) {
    this.targetUid = q.uid || '';
    this.date = q.date || engine.dayKey();
    this.items = loadItems(this.date);
    this.idx = 0;
    if (this.targetUid) {
      const i = this.items.findIndex(it => it.uid === this.targetUid);
      if (i >= 0) this.idx = i;
    }
    if (!this.items.length) {
      wx.showToast({ title: '今天还没有动作，先去添加', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ date: this.date, setTimer: settings.trainCfg().groupTimer });
    this.restoreFocus();
    this.refreshQueue();
    this.prepare();
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.timer = setInterval(() => this.tick(), 500);
    this.draw();
  },

  // 现场恢复：同一日期重新进入时，接上次的进度
  restoreFocus() {
    let st = null;
    try { st = wx.getStorageSync(FOCUS_KEY); } catch (e) {}
    if (!st || st.date !== this.date || !Array.isArray(st.items) || st.items.length !== this.items.length) return;
    const same = this.items.every((it, i) => st.items[i] && st.items[i].uid === it.uid);
    if (!same) return;
    this.items = st.items;
    this.idx = Math.min(st.idx || 0, this.items.length - 1);
    wx.showToast({ title: '已恢复上次进度', icon: 'none' });
  },

  persistFocus() {
    try {
      wx.setStorageSync(FOCUS_KEY, { date: this.date, idx: this.idx, items: this.items });
    } catch (e) {}
  },

  clearFocus() {
    try { wx.removeStorageSync(FOCUS_KEY); } catch (e) {}
  },

  onUnload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (this.data.stage !== 'finish') this.saveCurrentIfNeeded();
  },

  onReady() {
    this.initCanvas();
  },

  // canvas 只在力量卡里渲染，页面初次 onReady 时可能还没挂载 → 惰性重试
  initCanvas() {
    if (this.cv || this._cvReq) return;
    this._cvReq = true;
    wx.createSelectorQuery().in(this).select('#rings').fields({ node: true, size: true }).exec(res => {
      this._cvReq = false;
      const r = res && res[0];
      if (!r || !r.node || !r.width) return;
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

  /* ---------- 队列 ---------- */
  refreshQueue() {
    const q = this.items.map((it, i) => ({
      i: i + 1,
      name: it.name,
      cd: it.type === 'cardio' || !!it.isCardio,
      done: it.type === 'cardio' ? !!it.done : it.groups.every(g => g.done),
      cur: i === this.idx
    }));
    const doneN = this.items.filter(it => it.type === 'cardio' ? it.done : it.groups.every(g => g.done)).length;
    let sDone = 0, sTotal = 0;
    this.items.forEach(it => {
      if (it.type === 'cardio') { sTotal += 1; sDone += it.done ? 1 : 0; return; }
      sTotal += it.groups.length;
      sDone += it.groups.filter(g => g.done).length;
    });
    this.setData({
      queue: q, total: this.items.length, doneTotal: doneN,
      pct: this.items.length ? Math.round(doneN / this.items.length * 100) : 0,
      setsDoneAll: sDone, setsTotalAll: sTotal,
      setsPct: sTotal ? Math.round(sDone / sTotal * 100) : 0
    });
  },

  openList() { this.setData({ listVisible: true }); },
  closeList() { this.setData({ listVisible: false }); },

  jumpTo(e) {
    const i = Number(e.currentTarget.dataset.i) - 1;
    if (!(i >= 0 && i < this.items.length)) return;
    if (this.data.listVisible) this.setData({ listVisible: false });
    if (i === this.idx) return;
    this._restEnd = 0;
    this.idx = i;
    this.prepare();
  },

  setsStat() {
    let done = 0, total = 0, vol = 0;
    this.items.forEach(it => {
      if (it.type === 'cardio') return;
      it.groups.forEach(g => { total++; if (g.done) { done++; vol += (g.reps || 0) * (g.weight || 0); } });
    });
    return { done, total, vol: Math.round(vol) };
  },

  // 进入当前动作
  prepare() {
    if (this.idx >= this.items.length) return this.showFinish();
    const it = this.items[this.idx];
    this._restEnd = 0;
    this._workStart = 0;
    if (it.type === 'cardio') {
      this._cardioStart = 0;
      this.setData({
        stage: 'ready', curType: 'cardio', curName: it.name, curPart: '有氧',
        cardioPlanned: it.min || 30, cardioSec: 0, mmss: '0:00',
        hint: '准备好后开始有氧计时'
      });
      this.refreshQueue();
      return;
    }
    const gi = it.groups.findIndex(g => !g.done);
    if (gi < 0) { this.idx++; return this.prepare(); }
    this._gi = gi;
    const g = it.groups[gi];
    this.setData({
      stage: 'ready', curType: 'strength', curName: it.name, curPart: it.part || '',
      curCardio: !!it.isCardio,
      setNo: gi + 1, setsDone: it.groups.filter(x => x.done).length, setsTotal: it.groups.length,
      reps: g.reps || 0, weight: g.weight || 0, mmss: '0:00',
      rpe: g.rpe || 0, warmup: !!g.warmup,
      detailVisible: false, detail: null,
      rows: this.rowsOf(it),
      hint: this.data.setTimer
        ? ('第 ' + (gi + 1) + ' 组，准备好点开始')
        : ('点「完成第 ' + (gi + 1) + ' 组」，或直接点组行打勾')
    });
    this.refreshQueue();
    this.draw();
  },

  rowsOf(it) {
    const next = it.groups.findIndex(g => !g.done);
    return it.groups.map((g, i) => ({
      no: g.no,
      txt: (g.weight > 0 ? g.weight + 'kg' : '自重') + ' × ' + (g.reps || 0),
      done: !!g.done,
      warm: !!g.warmup,
      cur: i === next,
      rpe: g.rpe || 0,
      tag: g.tag || (g.warmup ? 'warm' : ''),
      sec: secText(g.sec)
    }));
  },

  /* ---------- 计时 ---------- */
  tick() {
    const now = Date.now();
    const d = {};
    if (this.data.stage === 'work' && this._workStart) {
      d.mmss = mmss((now - this._workStart) / 1000);
    }
    if (this.data.stage === 'rest' && this._restEnd) {
      const left = Math.max(0, Math.round((this._restEnd - now) / 1000));
      const total = this.data.restTotal || 1;
      d.restLeft = left;
      d.restPct = Math.max(0, Math.min(100, Math.round(left / total * 100)));
      if (left <= 0) {
        this._restEnd = 0;
        this.skipRest(true);
        return;
      }
    }
    if (this.data.stage === 'cardio') {
      if (!this._cardioStart) this._cardioStart = now;
      const s = Math.round((now - this._cardioStart) / 1000);
      d.cardioSec = s;
      d.mmss = mmss(s);
    }
    if (Object.keys(d).length) this.setData(d);
    if (this.data.stage === 'work' || this.data.stage === 'rest') this.draw();
  },

  /* ---------- 力量 ---------- */
  // 组内计时关闭时（默认）：点一下 = 记一组，然后自动进组间休息
  start() {
    const it = this.items[this.idx];
    if (!it) return;
    if (it.type === 'cardio') {
      this._cardioStart = Date.now();
      this.setData({ stage: 'cardio', mmss: '0:00', hint: '有氧进行中，结束后点完成' });
      return;
    }
    if (!this.data.setTimer) { this.doneCurrent(); return; }
    this.beginSet(false);
  },

  beginSet(fromRest) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    this._workStart = Date.now();
    const gi = this._gi;
    const g = it.groups[gi];
    this.setData({
      stage: 'work',
      mmss: '0:00',
      setNo: gi + 1,
      reps: g.reps || 0,
      weight: g.weight || 0,
      hint: (fromRest ? '休息结束 · ' : '') + '第 ' + (gi + 1) + ' 组进行中，做完点完成'
    });
  },

  // 无计时模式：当前组一键完成
  doneCurrent() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    if (this.data.stage === 'rest') this._restEnd = 0;
    this.completeGroup(this._gi, 0);
  },

  // 点组行直接打勾（训练页同款交互）
  tapRow(e) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    if (this.data.stage === 'between') return;
    const gi = Number(e.currentTarget.dataset.i);
    const g = it.groups[gi];
    if (!g || g.done) return;
    if (this.data.stage === 'rest') this._restEnd = 0;
    this.completeGroup(gi, 0);
  },

  // 智能单按钮：ready=开始/直接记组，work=完成，rest=下一组，between=下一个动作
  primaryTap() {
    const s = this.data.stage;
    if (s === 'ready') {
      if (this.data.setTimer) this.beginSet(false);
      else this.doneCurrent();
      return;
    }
    if (s === 'work') { this.finishSet(); return; }
    if (s === 'rest') { this.applyAdvice(); return; }
    if (s === 'between') { this.nextItem(); return; }
    if (s === 'cardio') { this.finishCardio(); return; }
    wx.showToast({ title: '当前没有可执行的步骤', icon: 'none' });
  },

  // 任何状态下都不再静默返回：ready 直接记一组，其余给明确提示
  finishSet() {
    if (this.data.stage === 'ready') { this.doneCurrent(); return; }
    if (this.data.stage !== 'work') {
      wx.showToast({ title: this.data.stage === 'rest' ? '先跳过休息，再记本组' : '本组还没开始', icon: 'none' });
      return;
    }
    const sec = Math.max(1, Math.round((Date.now() - (this._workStart || Date.now())) / 1000));
    this.completeGroup(this._gi, sec);
  },

  // 记一组 → 保存 → 组间休息倒计时（最后一组则进入动作收尾）
  completeGroup(gi, sec) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[gi];
    if (!g || g.done) return;
    const dur = Math.max(0, sec || 0);
    g.sec = dur;
    g.done = true;
    g.rpe = this.data.rpe || 0;
    this._sessionSec = (this._sessionSec || 0) + dur;
    this._workStart = 0;
    this.saveStrength(it);
    this.persistFocus();
    wx.vibrateShort({ type: 'medium' });
    this.checkPR(it, g);

    const next = it.groups.findIndex(x => !x.done);
    const rows = this.rowsOf(it);
    const stat = this.setsStat();
    if (next < 0) {
      this.setData({
        rows, stage: 'between', restLeft: 0, restPct: 0,
        setsDone: it.groups.filter(x => x.done).length, doneSets: stat.done, doneVolume: stat.vol,
        hint: '这个动作做完了，继续下一个'
      });
      this.refreshQueue();
      this.draw();
      wx.vibrateShort({ type: 'heavy' });
      return;
    }
    this._gi = next;
    const restSec = settings.restFor(it.part, it.name) || 90;
    const nextG = it.groups[next] || {};
    const doneSecs = it.groups.filter(x => x.done && x.sec > 0).map(x => x.sec);
    const planSec = doneSecs.length ? Math.round(doneSecs.reduce((a, b) => a + b, 0) / doneSecs.length) : 0;
    const adv = decision.restAdvice({
      last: { weight: g.weight, reps: g.reps, rpe: g.rpe || this.data.rpe || 0, sec: g.sec || 0 },
      plan: { weight: nextG.weight || g.weight, reps: nextG.reps || g.reps },
      planSec
    });
    const nextLabel = adv.delta || adv.weight !== (nextG.weight || g.weight)
      ? '下一组 ' + (adv.weight > 0 ? adv.weight + 'kg × ' + (nextG.reps || g.reps) : '自重 × ' + adv.reps) + ' 开始'
      : '跳过休息，下一组';
    this._restEnd = Date.now() + restSec * 1000;
    this.setData({
      rows, stage: 'rest', restLeft: restSec, restTotal: restSec, restPct: 100, mmss: '0:00',
      setNo: next + 1,
      setsDone: it.groups.filter(x => x.done).length, doneSets: stat.done, doneVolume: stat.vol, rpe: 0,
      hint: '第 ' + (gi + 1) + ' 组完成 · 休息 ' + restSec + '″，结束做第 ' + (next + 1) + ' 组',
      restTip: adv.text, restAi: '', advW: adv.weight, advReps: nextG.reps || g.reps, restNextLabel: nextLabel
    });
    this.aiRest(it, g, adv, planSec);
    this.refreshQueue();
    this.draw();
  },

  // 组间建议的 AI 一句话（规则已算出重量，AI 只负责表达）
  aiRest(it, g, adv, planSec) {
    try {
      const hist = (engine.ensureTrain(store.getTrain()).records || []).filter(r => r.name === it.name);
      polish.polish('rest', { name: it.name, last: { w: g.weight, reps: g.reps, rpe: g.rpe }, adv: { w: adv.weight, d: adv.delta }, hist: hist.length, planSec },
        '一句话说明这组该加重、维持还是降一点，不要出现任何数字和重量，20 字内')
        .then(r => {
          // 数字一律以规则为准：AI 话里带阿拉伯数字或中文数字就丢弃，保留规则文案
          if (!r.ok || !r.text) return;
          const t = r.text;
          // 数字一律以规则为准；方向与规则相反的话（规则建议加重却说“维持”）直接丢弃
          if (/[0-9]|[一二三四五六七八九十两]|公斤|千克/.test(t)) return;
          if (adv.delta > 0 && /维持|别加|别急|降|减|巩固/.test(t)) return;
          if (adv.delta < 0 && /加重|加重量|上重量/.test(t)) return;
          this.setData({ restAi: t });
        })
        .catch(() => {});
    } catch (e) {}
  },

  // 采纳建议：把建议重量写进下一组，再开始
  applyAdvice() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') { this.skipRest(); return; }
    const g = it.groups[this._gi];
    if (g && this.data.advW >= 0) {
      g.weight = this.data.advW;
      if (this.data.advReps) g.reps = this.data.advReps;
      this.saveStrength(it);
      this.setData({ weight: g.weight, reps: g.reps, rows: this.rowsOf(it) });
    }
    this.skipRest();
  },

  // PR：这组超过同动作历史最佳（重量×估算次数）
  checkPR(it, g) {
    const train = engine.ensureTrain(store.getTrain());
    const best = { v: 0 };
    (train.records || []).forEach(r => {
      if (!r || r.name !== it.name) return;
      if (r.uid && it.uid && r.uid === it.uid) return; // 本次这场不算进历史
      engine.ensureGroups(r).forEach(x => {
        if (!x.done || x.warmup) return;
        const v = (x.weight || 0) * (1 + (x.reps || 1) / 30);
        if (v > best.v) best.v = v;
      });
    });
    const cur = (g.weight || 0) * (1 + (g.reps || 1) / 30);
    if (g.weight > 0 && cur > best.v + 0.01) {
      wx.showToast({ title: 'PR · ' + g.weight + 'kg × ' + g.reps, icon: 'none' });
    }
  },

  // 点击完成 = 直接完成（2026-11-24：去掉确认弹窗，单按钮一步到位）
  askFinish() {
    this.primaryTap();
  },

  holdFinish() {
    if (this.data.stage === 'work') this.finishSet();
    else this.primaryTap();
  },

  // 当前组的 RPE
  pickRpe(e) {
    const v = Number(e.currentTarget.dataset.v) || 0;
    this.setData({ rpe: this.data.rpe === v ? 0 : v });
  },

  toggleWarmup() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    g.warmup = !g.warmup;
    g.tag = g.warmup ? 'warm' : '';
    this.setData({ warmup: g.warmup, rows: this.rowsOf(it) });
    this.saveStrength(it);
  },

  // 动作详情：页内浮层（动图 + 部位/器械/要领），不打断计时
  showDetail() {
    const it = this.items[this.idx];
    if (!it) return;
    if (it.type === 'cardio') {
      wx.showModal({ title: it.name, content: '有氧动作 · 计划 ' + (it.min || 30) + ' 分钟\n保持中等强度，能说话但不能唱歌。', showCancel: false });
      return;
    }
    const train = engine.ensureTrain(store.getTrain());
    const ex = data.byId(it.exId) || data.matchByName(it.name) || (train.custom || []).find(x => x && x.id === it.exId);
    if (!ex) {
      wx.showModal({ title: it.name, content: '这个动作没有动作库条目', showCancel: false, confirmText: '知道了' });
      return;
    }
    // 带动图/要领的浮层，不打断计时
    this.setData({ exSheetId: String(it.exId), exSheetName: it.name || '', exSheetVisible: true });
  },

  closeExSheet() { this.setData({ exSheetVisible: false }); },

  // 中途添加动作（队列末尾追加）
  addMore() {
    wx.navigateTo({
      url: '/pages/library/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          const rec = actions.saveStrength({
            date: this.date, exId: ex.id, name: ex.n, part: ex.p,
            sets: 3, reps: 10, weight: 0,
            groups: [{ reps: 10, weight: 0, done: false }, { reps: 10, weight: 0, done: false }, { reps: 10, weight: 0, done: false }]
          }) || {};
          this.items.push({
            type: 'strength', uid: rec.uid, exId: ex.id, name: ex.n, part: ex.p,
            groups: [{ no: 1, reps: 10, weight: 0, warmup: false, tag: '', done: false, sec: 0 },
              { no: 2, reps: 10, weight: 0, warmup: false, tag: '', done: false, sec: 0 },
              { no: 3, reps: 10, weight: 0, warmup: false, tag: '', done: false, sec: 0 }]
          });
          this.refreshQueue();
          this.persistFocus();
          wx.showToast({ title: '已加入队列', icon: 'none' });
        }
      }
    });
  },

  skipRest(auto) {
    auto = auto === true;
    this._restEnd = 0;
    if (this.data.setTimer) { this.beginSet(true); return; }
    this.setData({
      stage: 'ready', restLeft: 0, restPct: 0, mmss: '0:00',
      hint: (auto ? '休息结束 · ' : '') + '点「完成第 ' + (this._gi + 1) + ' 组」，或直接点组行打勾'
    });
    this.draw();
    if (auto) wx.vibrateShort({ type: 'heavy' });
  },

  nextItem() {
    this.idx++;
    this.prepare();
  },

  skipItem() {
    wx.showModal({
      title: '跳过这个动作？',
      content: '已完成的组会保留，剩下没做的跳过。',
      confirmText: '跳过',
      success: (r) => {
        if (!r.confirm) return;
        this.idx++;
        this.prepare();
      }
    });
  },

  saveStrength(it) {
    if (!it) return;
    const groups = it.groups.map((g, i) => ({
      no: g.warmup ? 'W' : (i + 1), reps: g.reps || 0, weight: g.weight || 0,
      done: !!g.done, warmup: !!g.warmup, rpe: 0, sec: g.sec || 0, tag: g.tag || (g.warmup ? 'warm' : '')
    }));
    const g0 = groups.find(g => g.done) || groups[0] || {};
    if (it.isCardio) {
      // 计组型有氧：落 cardio[]，不落力量记录
      const rec2 = actions.saveCardio({
        uid: it.uid || engine.uid('c'),
        date: this.date,
        exId: it.exId || '',
        name: it.name,
        modal: it.name,
        part: '有氧',
        mode: 'sets',
        min: it.min || 0,
        dist: it.dist || 0,
        groups,
        done: groups.length > 0 && groups.every(g => g.done)
      });
      if (rec2 && rec2.uid) it.uid = rec2.uid;
      return;
    }
    const rec = actions.saveStrength({
      uid: it.uid || engine.uid('t'),
      date: this.date,
      exId: it.exId || '',
      name: it.name,
      part: it.part || '',
      sets: groups.length,
      reps: g0.reps || 10,
      weight: g0.weight || 0,
      groups
    });
    if (rec && rec.uid) it.uid = rec.uid;
  },

  saveCurrentIfNeeded() {
    const it = this.items && this.items[this.idx];
    if (it && it.type === 'strength' && it.groups.some(g => g.sec || g.done)) this.saveStrength(it);
  },

  /* ---------- 编辑当前组 ---------- */
  addRep() { this.bumpRep(1); },
  subRep() { this.bumpRep(-1); },
  bumpRep(d) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    g.reps = Math.max(1, (g.reps || 0) + d);
    this.setData({ reps: g.reps, rows: this.rowsOf(it) });
    this.refreshEdit();
  },

  addWeight() { this.bumpWeight(2.5); },
  subWeight() { this.bumpWeight(-2.5); },
  onWeightInput(e) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    const v = parseFloat(e.detail.value);
    g.weight = isNaN(v) ? 0 : Math.max(0, Math.round(v * 10) / 10);
    this.setData({ weight: g.weight, rows: this.rowsOf(it) });
    this.refreshEdit();
  },
  bumpWeight(d) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    g.weight = Math.max(0, Math.round(((g.weight || 0) + d) * 10) / 10);
    this.setData({ weight: g.weight, rows: this.rowsOf(it) });
    this.refreshEdit();
  },

  refreshEdit() {
    const it = this.items[this.idx];
    if (!it) return;
    const rows = this.rowsOf(it);
    this.setData({ rows });
    this.saveStrength(it);
  },

  /* ---------- 有氧 ---------- */
  cardioMinAdd() {
    const v = Math.max(1, (this.data.cardioPlanned || 0) + 5);
    this.setData({ cardioPlanned: v });
  },
  cardioMinSub() {
    const v = Math.max(1, (this.data.cardioPlanned || 0) - 5);
    this.setData({ cardioPlanned: v });
  },

  finishCardio() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'cardio') return;
    const sec = this.data.cardioSec || 0;
    const min = Math.max(1, Math.round(sec / 60));
    actions.saveCardio({
      uid: it.uid || engine.uid('c'),
      date: this.date,
      name: it.name,
      modal: it.name,
      min,
      sec,
      dist: it.dist || 0,
      done: true
    });
    it.done = true;
    it.min = min;
    this._sessionSec = (this._sessionSec || 0) + sec;
    const cardioDone = this.items.filter(x => x.type === 'cardio' && x.done).reduce((a, x) => a + (x.min || 0), 0);
    this.setData({ doneCardio: cardioDone, sessionSec: this._sessionSec || 0 });
    wx.vibrateShort({ type: 'heavy' });
    wx.showToast({ title: '有氧 ' + min + '′ 已记录', icon: 'none' });
    this.nextItem();
  },

  /* ---------- 收尾 ---------- */
  showFinish() {
    const stat = this.setsStat();
    const cardio = this.items.filter(x => x.type === 'cardio' && x.done).reduce((a, x) => a + (x.min || 0), 0);
    const sessionSec = this._sessionSec || 0;
    this.setData({
      stage: 'finish', doneSets: stat.done, doneVolume: stat.vol, doneCardio: cardio,
      sessionSec,
      finishText: stat.done + ' 组 · ' + stat.vol + ' kg' + (cardio ? ' · 有氧 ' + cardio + '′' : ''),
      finishTime: sessionSec >= 60 ? Math.round(sessionSec / 60) + ' 分钟' : sessionSec + ' 秒',
      pct: 100,
      aiReview: '',
      finNext: null,
      finTomorrow: null,
      finGoal: null
    });
    this.refreshQueue();
    this.draw();
    this.postDecisions(stat, cardio);
    this.aiReview(stat, cardio, sessionSec);
  },

  // 练完的两个决策输出：下次重量 / 明天排什么 + 周目标进度
  postDecisions(stat, cardio) {
    try {
      const p = decision.postSession(this.items, stat, cardio);
      this.setData({ finNext: p.next, finTomorrow: p.tomorrow, finGoal: p.goal });
    } catch (e) {}
  },

  // 按建议排明天：带着部位去计划页，那一页会直接给出该部位的计划
  planTomorrow() {
    const part = (this.data.finTomorrow && this.data.finTomorrow.part) || '';
    wx.navigateTo({ url: '/pages/plan/index' + (part ? '?part=' + encodeURIComponent(part) : '') });
  },

  // 训练小结 AI 复盘：规则数字（组/容量/时长/部位）→ 两句点评
  aiReview(stat, cardio, sessionSec) {
    try {
      const parts = {};
      (this.items || []).forEach(it => {
        if (it.type === 'cardio') return;
        const done = (it.groups || []).filter(g => g.done && !g.warmup).length;
        if (done) parts[it.part || it.name] = (parts[it.part || it.name] || 0) + done;
      });
      const facts = {
        sets: stat.done, volume: stat.vol, cardioMin: cardio,
        minutes: Math.round(sessionSec / 60), parts: Object.keys(parts).join('/') || '—',
        exercises: (this.items || []).filter(x => x.done || (x.groups || []).some(g => g.done)).length
      };
      const fallback = '这次 ' + stat.done + ' 组共 ' + stat.vol + ' kg，' +
        (stat.done >= 12 ? '容量给得足，' : '组数偏少，') +
        (stat.done ? '下次把薄弱部位的组数补 1 组，重量别追太快。' : '下次先把主力动作做满 3 组。');
      polish.polish('session', facts, '两句以内复盘这次训练：质量亮点 + 下次一个具体建议',
        { max: 70, tokens: 220 })
        .then(r => { this.setData({ aiReview: r.ok ? r.text : fallback }); })
        .catch(() => this.setData({ aiReview: fallback }));
    } catch (e) {
      this.setData({ aiReview: '' });
    }
  },

  finish() {
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clearFocus();
    wx.showToast({ title: '已记入训练', icon: 'none' });
    setTimeout(() => wx.navigateBack(), 400);
  },

  quit() {
    if (this.data.stage === 'finish') return this.finish();
    wx.showModal({
      title: '结束这次专注？',
      content: '已完成的组都保存了，随时可以在训练页继续。',
      confirmText: '结束',
      success: (r) => {
        if (!r.confirm) return;
        this.finish();
      }
    });
  },

  /* ---------- 圆环：只在组间休息时画倒计时环 ---------- */
  draw() {
    if (!this.cv) { this.initCanvas(); return; }
    const cv = this.cv;
    const ctx = cv.ctx;
    const s = cv.size;
    const cx = s / 2, cy = s / 2;
    ctx.clearRect(0, 0, s, s);
    if (this.data.stage !== 'rest') return;
    const p = Math.max(0, Math.min(1, (this.data.restLeft || 0) / (this.data.restTotal || 1)));
    const r = s / 2 - 26;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 7;
    ctx.stroke();
    if (p > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.strokeStyle = '#3DDCBF';
      ctx.lineWidth = 7;
      ctx.stroke();
    }
  },

  noop() {}
});
