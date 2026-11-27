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
        lw: g.lw,
        rw: g.rw,
        warmup: false,
        tag: g.tag || '',
        done: !!g.done,
        sec: g.sec || 0
      }));
      if (it.mode === 'sets' && gs.length) {
        return { type: 'strength', isCardio: true, uid: it.uid, exId: it.exId, name: it.name, part: '有氧', uni: !!it.uni, groups: gs };
      }
      return { type: 'cardio', uid: it.uid, exId: it.exId, name: it.name, min: it.min || 30, done: !!it.done, sec: 0 };
    }
    return {
      type: 'strength', uid: it.uid, exId: it.exId, name: it.name, part: it.part, uni: !!it.uni,
      groups: (it.groups || []).map((g, i) => ({
        no: g.warmup ? 'W' : (g.no || i + 1),
        reps: g.reps || 0,
        weight: g.weight || 0,
        lw: g.lw,
        rw: g.rw,
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
    cdLeft: 0,
    cdAnim: 0,
    setTimer: true,
    timerPaused: false,
    chargePct: 0,
    chargeColor: '#3DDCBF',
    chargeTip: '',
    ringCoach: false,
    restPct: 0,
    restLeft: 0,
    restTotal: 60,
    reps: 0,
    weight: 0,
    curUni: false,
    wLabel: '自重',
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
    editorVisible: false,
    editorPayload: null,
    hint: '',
    restTip: '',
    restAi: '',
    restPaused: false,
    restMeta: '',
    restCards: [],
    restIdx: 0,
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
    this.setData({ date: this.date, setTimer: true });
    let coach = 0;
    try { coach = wx.getStorageSync('selfagent_coach_ring_v1'); } catch (e) {}
    this.setData({ ringCoach: !coach });
    this._sessionStart = Date.now();
    this._fresh = this.items;        // 落库的最新状态（快照可能早于它）
    this.restoreFocus();
    this.refreshQueue();
    this.prepare();
    this.resumeStage();
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
    // 快照早于落库：把已完成的有氧/组从最新数据合并回来，避免恢复出「已完成却还停在 ready」的页
    const fresh = this._fresh || [];
    this.items.forEach((it, i) => {
      const f = fresh[i];
      if (!f || !f.uid || f.uid !== it.uid) return;
      if (it.type === 'cardio') {
        if (f.done) { it.done = true; if (f.min) it.min = f.min; }
        return;
      }
      (it.groups || []).forEach((g, j) => {
        const fg = (f.groups || [])[j];
        if (fg && fg.done && !g.done) { g.done = true; if (fg.sec) g.sec = fg.sec; }
      });
    });
    const restIdx = Math.min(st.idx || 0, this.items.length - 1);
    // 指定了 uid（从某个动作行点进来）就以它为准，不能被上次的 idx 抢走
    const tgt = this.targetUid ? this.items.findIndex(x => x.uid === this.targetUid) : -1;
    this.idx = tgt >= 0 ? tgt : restIdx;
    // 整场用时从第一次进入算起，重进接着算（超过 12 小时视为新的一场）
    const ss = Number(st.startAt || 0);
    if (ss > 0 && Date.now() - ss < 12 * 3600 * 1000) this._sessionStart = ss;
    // 记下当时的阶段与计时起点：重进要接着计，不再归零（prepare 会先铺 ready，随后 resumeStage 覆盖）
    // 只有「恢复的还是同一个动作」时才接着计时；按 uid 跳到别的动作则重新开始
    if (restIdx === this.idx) {
      this._resume = {
        stage: st.stage || '',
        workStart: Number(st.workStart || 0),
        pauseAcc: Number(st.pauseAcc || 0),
        pauseAt: Number(st.pauseAt || 0),
        timerPaused: !!st.timerPaused,
        cardioStart: Number(st.cardioStart || 0)
      };
    }
    wx.showToast({ title: '已恢复上次进度', icon: 'none' });
  },

  // 重进时把「进行中的那一组 / 有氧」恢复到原计时，而不是从 0:00 重来
  resumeStage() {
    const r = this._resume;
    this._resume = null;
    if (!r) return;
    const now = Date.now();
    const MAX = 12 * 3600 * 1000;
    // 这个动作已经做完（或组都做完）就别再恢复计时
    const cur = this.items[this.idx];
    if (cur && (cur.done || (cur.type === 'strength' && (cur.groups || []).length && cur.groups.every(g => g.done)))) return;
    // 有氧：接着累计
    if (r.stage === 'cardio' && this.data.stage === 'ready' && this.data.curType === 'cardio') {
      const cs = Number(r.cardioStart || 0);
      if (cs > 0 && now - cs > 0 && now - cs < MAX) {
        this._cardioStart = cs;
        const s = Math.round((now - cs) / 1000);
        this.setData({ stage: 'cardio', cardioSec: s, mmss: mmss(s), hint: '有氧进行中，结束后点完成' });
        this.tick();
      }
      return;
    }
    // 力量：恢复当前组的计时起点、暂停累计与暂停状态
    if (r.stage !== 'work' || this.data.stage !== 'ready') return;
    const ws = Number(r.workStart || 0);
    if (!ws || now - ws < 0 || now - ws > MAX) return;
    this._workStart = ws;
    this._pauseAcc = Number(r.pauseAcc || 0);
    this._pauseAt = r.timerPaused ? Number(r.pauseAt || now) : 0;
    this._lastMin = Math.floor(this.elapsedMs() / 60000);
    const gi = typeof this._gi === 'number' ? this._gi : 0;
    this.setData({
      stage: 'work',
      timerPaused: !!r.timerPaused,
      mmss: mmss(this.elapsedMs() / 1000),
      hint: '第 ' + (gi + 1) + ' 组进行中 · 已接着上次计时'
    });
    this.tick();
  },

  persistFocus() {
    try {
      wx.setStorageSync(FOCUS_KEY, {
        date: this.date, idx: this.idx, items: this.items,
        stage: this.data.stage,
        workStart: this._workStart || 0,
        cardioStart: this._cardioStart || 0,
        startAt: this._sessionStart || 0,
        pauseAcc: this._pauseAcc || 0,
        pauseAt: this._pauseAt || 0,
        timerPaused: !!this.data.timerPaused
      });
    } catch (e) {}
  },

  clearFocus() {
    try { wx.removeStorageSync(FOCUS_KEY); } catch (e) {}
  },

  onUnload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (this.data.stage !== 'finish') { this.persistFocus(); this.saveCurrentIfNeeded(); }
  },

  // 息屏/切后台照常计时：计时用系统时间差，回来立刻补一次 tick
  onHide() {
    this.persistFocus();
  },

  onShow() {
    this.tick();
  },

  onReady() {
    this.initCanvas();
  },

  // canvas 只在组间休息时画环；准备态是「lite」短卡，量到的不是正方形，先隐藏再量
  initCanvas(attempt) {
    if (this.cv) return;
    attempt = attempt || 0;
    if (this._cvReq && attempt === 0) return;
    this._cvReq = true;
    wx.createSelectorQuery().in(this).select('#rings').fields({ node: true, size: true }).exec(res => {
      this._cvReq = false;
      const r = res && res[0];
      // 布局还没落定（宽高为 0）就等下一帧再量，最多 6 次
      if (!r || !r.node || !r.width || !r.height) {
        if (attempt < 6) setTimeout(() => this.initCanvas(attempt + 1), 250);
        return;
      }
      const c = r.node;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      // 宽高都记下来：只按宽算半径，非正方形会画成椭圆
      this.cv = { node: c, ctx, w: r.width, h: r.height };
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

  itemAt(e) {
    const i = Number(e.currentTarget.dataset.i) - 1;
    if (!(i >= 0 && i < this.items.length)) return null;
    return this.items[i];
  },

  // 查：任意一项的动作详情（动图 + 部位/器械/要领）
  openItemDetail(e) {
    const it = this.itemAt(e);
    if (!it) return;
    if (it.type === 'cardio') {
      wx.showModal({ title: it.name, content: '有氧动作 · 计划 ' + (it.min || 30) + ' 分钟\n保持中等强度，能说话但不能唱歌。', showCancel: false });
      return;
    }
    let id = it.exId;
    if (!id) {
      const ex = data.matchByName(it.name);
      if (ex) id = ex.id;
    }
    if (!id) {
      wx.showModal({ title: it.name, content: '这个动作没有动作库条目', showCancel: false, confirmText: '知道了' });
      return;
    }
    this.setData({ listVisible: false, exSheetId: String(id), exSheetName: it.name || '', exSheetVisible: true });
  },

  // 改：复用编辑动作弹层（组数/次数/重量/组类型/改名）
  openItemEdit(e) {
    const i = Number(e.currentTarget.dataset.i) - 1;
    const it = this.itemAt(e);
    if (!it) return;
    this._editIdx = i;
    if (it.type === 'cardio') {
      this.setData({
        listVisible: false,
        editorVisible: true,
        editorPayload: { mode: 'cardio', uid: it.uid, name: it.name, min: it.min || 30, done: !!it.done, date: this.date }
      });
      return;
    }
    this.setData({
      listVisible: false,
      editorVisible: true,
      editorPayload: {
        mode: 'strength', uid: it.uid, name: it.name, part: it.part || '', exId: it.exId || '',
        date: this.date, uni: !!it.uni,
        groups: (it.groups || []).map(g => ({
          no: g.no, reps: g.reps || 0, weight: g.weight || 0, lw: g.lw, rw: g.rw, done: !!g.done,
          warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, tag: g.tag || ''
        }))
      }
    });
  },

  onEditorClose() { this.setData({ editorVisible: false, editorPayload: null }); },

  onEditorConfirm(e) {
    const d = e.detail || {};
    const i = (this._editIdx == null ? this.idx : this._editIdx);
    const it = this.items[i];
    if (!it) { this.onEditorClose(); return; }
    const rec = d.record || {};
    if (d.mode === 'cardio' || it.type === 'cardio') {
      it.name = rec.name || it.name;
      it.min = rec.min || it.min;
      it.done = rec.done !== false;
      if (it.uid) actions.saveCardio(Object.assign({}, rec, { uid: it.uid, date: this.date }));
    } else {
      it.name = rec.name || it.name;
      it.uni = !!rec.uni;
      it.groups = (rec.groups || []).map((g, k) => ({
        no: g.warmup ? 'W' : (k + 1), reps: g.reps || 0, weight: g.weight || 0, lw: g.lw, rw: g.rw,
        warmup: !!g.warmup, tag: g.tag || (g.warmup ? 'warm' : ''), done: !!g.done,
        rpe: g.rpe || 0, sec: g.sec || 0
      }));
      if (it.uid) {
        if (it.isCardio) {
          actions.saveCardio({
            uid: it.uid, date: this.date, exId: it.exId || '', name: it.name, modal: it.name,
            part: '有氧', mode: 'sets', min: it.min || 0, groups: rec.groups,
            done: (rec.groups || []).length > 0 && (rec.groups || []).every(g => g.done)
          });
        } else {
          actions.saveStrength(Object.assign({}, rec, { uid: it.uid, date: this.date, groups: rec.groups, uni: !!rec.uni }));
        }
      }
    }
    this.onEditorClose();
    this.refreshQueue();
    const stat = this.setsStat();
    this.setData({ doneSets: stat.done, doneVolume: stat.vol });
    if (this.data.stage === 'ready' || this.data.stage === 'between') this.prepare();
    else if (i === this.idx) this.setData({ rows: this.rowsOf(it), setsDone: (it.groups || []).filter(g => g.done).length, setsTotal: (it.groups || []).length });
    this.persistFocus();
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  // 删：动作整项移除（当天记录一并删除）
  openItemDelete(e) {
    const i = Number(e.currentTarget.dataset.i) - 1;
    const it = this.itemAt(e);
    if (!it) return;
    const isCur = i === this.idx;
    wx.showModal({
      title: '删除「' + it.name + '」',
      content: (isCur ? '当前这一项' : '这一项') + '会从本次训练移除，已记录的组也一起删掉。',
      confirmText: '删除',
      confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        this.removeItem(i);
      }
    });
  },

  onEditorDelete(e) {
    const i = this._editIdx;
    this.onEditorClose();
    if (i == null) return;
    this.removeItem(i);
  },

  removeItem(i) {
    const it = this.items[i];
    if (!it) return;
    try {
      if (it.type === 'cardio' || it.isCardio) actions.deleteCardio(it.uid, this.date);
      else actions.deleteStrength(it.uid, this.date);
    } catch (err) {}
    this.items.splice(i, 1);
    if (this.idx >= this.items.length) this.idx = Math.max(0, this.items.length - 1);
    else if (i < this.idx) this.idx--;
    this._restEnd = 0;
    this.persistFocus();
    this.refreshQueue();
    this.setData({ listVisible: false });
    if (!this.items.length) { this.showFinish(); return; }
    this.prepare();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  // 重做某一组：勾掉该组 → 回到这一组重新做（已记录的组数/容量同步扣回）
  redoRow(e) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const gi = Number(e.currentTarget.dataset.i);
    const g = it.groups[gi];
    if (!g || !g.done) return;
    const wasSec = g.sec || 0;
    g.done = false;
    g.sec = 0;
    g.rpe = 0;
    this._sessionSec = Math.max(0, (this._sessionSec || 0) - wasSec);
    this._restEnd = 0;
    this._workStart = 0;
    this.saveStrength(it);
    this.persistFocus();
    this.refreshQueue();
    const stat = this.setsStat();
    this.setData({ doneSets: stat.done, doneVolume: stat.vol });
    this.prepare();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '第 ' + (gi + 1) + ' 组已重置，重做吧', icon: 'none' });
  },

  jumpTo(e) {
    const i = Number(e.currentTarget.dataset.i) - 1;
    if (!(i >= 0 && i < this.items.length)) return;
    if (this.data.listVisible) this.setData({ listVisible: false });
    if (i === this.idx && this.data.stage !== 'finish') return;
    this._restEnd = 0;
    this.idx = i;
    this.prepare();
  },

  setsStat() {
    let done = 0, total = 0, vol = 0;
    this.items.forEach(it => {
      if (it.type === 'cardio') return;
      it.groups.forEach(g => { total++; if (g.done) { done++; vol += engine.setVolume(g, it.uni); } });
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
      // 已完成的有氧直接跳过，别停在一个「0:00 准备开始」的死页
      if (it.done) { this.idx++; return this.prepare(); }
      this._cardioStart = 0;
      this.setData({
        stage: 'ready', curType: 'cardio', curName: it.name, curPart: '有氧',
        cardioPlanned: it.min || 30, cardioSec: 0, mmss: '0:00',
        hint: '准备好后开始有氧计时'
      });
      this.refreshQueue();
      this.persistFocus();
      return;
    }
    const gi = it.groups.findIndex(g => !g.done);
    if (gi < 0) { this.idx++; return this.prepare(); }
    this._gi = gi;
    const g = it.groups[gi];
    // 每组进入 = ready：计时归零、等用户点环开始（Bug A：不再沿用上一组/上次会话的残余计时）
    this._workStart = 0;
    this._pauseAcc = 0;
    this._pauseAt = 0;
    this._lastMin = 0;
    this._flash = 0;
    this.setData({
      stage: 'ready', curType: 'strength', curName: it.name, curPart: it.part || '',
      curCardio: !!it.isCardio,
      setNo: gi + 1, setsDone: it.groups.filter(x => x.done).length, setsTotal: it.groups.length,
      reps: g.reps || 0, weight: g.weight || 0, curUni: !!it.uni, wLabel: engine.wText(g.weight, it.uni), mmss: '0:00',
      timerPaused: false,
      rpe: g.rpe || 0, warmup: !!g.warmup,
      detailVisible: false, detail: null,
      rows: this.rowsOf(it),
      hint: '第 ' + (gi + 1) + ' 组准备，点环开始计时'
    });
    this.refreshQueue();
    this.persistFocus();
    this.draw();
  },

  rowsOf(it) {
    const next = it.groups.findIndex(g => !g.done);
    return it.groups.map((g, i) => ({
      no: g.no,
      txt: (g.lw != null || g.rw != null)
        ? 'L' + (g.lw || 0) + ' R' + (g.rw || 0) + 'kg × ' + (g.reps || 0)
        : engine.wText(g.weight, it.uni) + ' × ' + (g.reps || 0),
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
    if (this.data.stage === 'countdown' && this._cdEnd) {
      const left = Math.ceil((this._cdEnd - now) / 1000);
      if (left <= 0) { this.startWork(); return; }
      if (left !== this.data.cdLeft) {
        d.cdLeft = left;
        d.cdAnim = this.data.cdAnim === 1 ? 2 : 1;
        wx.vibrateShort({ type: 'light' });
      }
    }
    if (this.data.stage === 'work' && this._workStart && !this.data.timerPaused) {
      d.mmss = mmss(this.elapsedMs() / 1000);
      // 满 1 分钟：白光脉冲，弧重新从 0 起
      const curMin = Math.floor(this.elapsedMs() / 60000);
      if (curMin > (this._lastMin || 0)) {
        this._lastMin = curMin;
        this._flash = now + 240;
        wx.vibrateShort({ type: 'light' });
      }
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
    if (this.data.stage === 'work' || this.data.stage === 'rest' || this.data.stage === 'ready' || this.data.stage === 'countdown') this.draw();
  },

  /* ---------- 力量 ---------- */
  // 当前组已运动毫秒：起始时刻起算，扣掉累计暂停与当前暂停时长
  elapsedMs() {
    if (!this._workStart) return 0;
    const now = Date.now();
    const pausing = this._pauseAt ? (now - this._pauseAt) : 0;
    return Math.max(0, now - this._workStart - (this._pauseAcc || 0) - pausing);
  },

  // 当前组已运动秒数：至少 1 秒
  elapsedSec() {
    if (!this._workStart) return 0;
    return Math.max(1, Math.round(this.elapsedMs() / 1000));
  },

  // 暂停 / 继续：只影响本组计时，不改变已累计的时长
  togglePause() {
    if (this.data.stage !== 'work') return;
    if (this.data.timerPaused) {
      // Bug B：继续时按冻结值把 _workStart 重算回「现在」，清掉暂停累计，并确保 interval 在跑
      const frozen = this.elapsedMs();
      this._workStart = Date.now() - frozen;
      this._pauseAcc = 0;
      this._pauseAt = 0;
      this.setData({ timerPaused: false, mmss: mmss(frozen / 1000) });
      if (!this.timer) this.timer = setInterval(() => this.tick(), 500);
      this.tick();
      this.persistFocus();
    } else {
      this._pauseAt = Date.now();
      this.setData({ timerPaused: true, mmss: mmss(this.elapsedMs() / 1000) });
      this.persistFocus();
    }
  },

  // 重置入口已取消：暂停后长按改为完成本组（resetTimer 保留但不再挂手势）
  resetTimer() {
    if (this.data.stage !== 'work') return;
    this._workStart = 0;
    this._pauseAcc = 0;
    this._pauseAt = 0;
    this._lastMin = 0;
    this._flash = 0;
    this.setData({ stage: 'ready', mmss: '0:00', timerPaused: false });
    this.persistFocus();
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({ title: '本组计时已重置', icon: 'none' });
    this.draw();
  },

  // 组内计时关闭时（默认）：点一下 = 记一组，然后自动进组间休息
  start() {
    const it = this.items[this.idx];
    if (!it) return;
    // 已经开始了就别重置：进行中重复点由暂停/跳过处理
    if (this.data.stage !== 'ready') return;
    if (it.type === 'cardio') {
      this._cardioStart = Date.now();
      this.setData({ stage: 'cardio', mmss: '0:00', hint: '有氧进行中，结束后点完成' });
      this.persistFocus();
      return;
    }
    if (!this.data.setTimer) { this.doneCurrent(); return; }
    this.beginSet(false);
  },

  // 点环开始：先 3 秒倒计时（3·2·1 动画），倒完才真正起表
  beginSet(fromRest) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    this._workStart = 0;
    this._pauseAcc = 0;
    this._pauseAt = 0;
    this._cdFrom = !!fromRest;
    this._cdEnd = Date.now() + 3000;
    const gi = this._gi;
    const g = it.groups[gi];
    this.setData({
      stage: 'countdown',
      mmss: '0:00',
      timerPaused: false,
      cdLeft: 3,
      cdAnim: this.data.cdAnim === 1 ? 2 : 1,
      setNo: gi + 1,
      reps: g.reps || 0,
      weight: g.weight || 0,
      curUni: !!it.uni,
      wLabel: engine.wText(g.weight, it.uni),
      hint: (fromRest ? '休息结束 · ' : '') + '第 ' + (gi + 1) + ' 组 3 秒后开始'
    });
    wx.vibrateShort({ type: 'light' });
    this.persistFocus();
    this.draw();
  },

  // 倒计时归零：这一刻才记 _workStart，前面 3 秒不计入组时长
  startWork() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    this._cdEnd = 0;
    this._workStart = Date.now();
    this._pauseAcc = 0;
    this._pauseAt = 0;
    const gi = this._gi;
    this.setData({
      stage: 'work',
      mmss: '0:00',
      cdLeft: 0,
      timerPaused: false,
      hint: (this._cdFrom ? '休息结束 · ' : '') + '第 ' + (gi + 1) + ' 组进行中，做完点完成'
    });
    this._cdFrom = false;
    wx.vibrateShort({ type: 'medium' });
    this.persistFocus();
    this.tick();
  },

  // 无计时模式：当前组一键完成
  doneCurrent() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    if (this.data.stage === 'rest') this._restEnd = 0;
    this.completeGroup(this._gi, this.elapsedSec());
  },

  // 点组行直接打勾（训练页同款交互）
  tapRow(e) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    if (this.data.stage === 'between') return;
    const gi = Number(e.currentTarget.dataset.i);
    const g = it.groups[gi];
    if (!g || g.done) return;
    // 休息中点到组行 = 结束休息、开始下一组的计时（没做过的一组不能没有时长就记完成）
    if (this.data.stage === 'rest') {
      this._restEnd = 0;
      this.beginSet(true);
      this.setData({ restLeft: 0, restPct: 0 });
      return;
    }
    this.completeGroup(gi, this.elapsedSec());
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
    this.completeGroup(this._gi, this.elapsedSec());
  },

  // 记一组 → 保存 → 组间休息倒计时（最后一组则进入动作收尾）
  completeGroup(gi, sec) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[gi];
    if (!g || g.done) return;
    const dur = Math.max(0, sec > 0 ? sec : this.elapsedSec());
    const isCur = gi === this._gi;
    g.sec = dur;
    g.done = true;
    g.rpe = isCur ? (this.data.rpe || 0) : (g.rpe || 0);
    this._sessionSec = (this._sessionSec || 0) + dur;
    if (isCur) {
      this._workStart = 0;
      this._pauseAcc = 0;
      this._pauseAt = 0;
    }
    this.saveStrength(it);
    this.persistFocus();
    wx.vibrateShort({ type: 'medium' });
    this.checkPR(it, g);
    // 点的是非当前组（手点前面的空组）：只记完成与该组时长，不打断当前组的计时与休息
    if (!isCur) {
      const stat0 = this.setsStat();
      this.setData({
        rows: this.rowsOf(it),
        setsDone: it.groups.filter(x => x.done).length,
        doneSets: stat0.done, doneVolume: stat0.vol
      });
      this.refreshQueue();
      return;
    }

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
      ? '下一组 ' + (adv.weight > 0 ? engine.wText(adv.weight, it.uni) + ' × ' + (nextG.reps || g.reps) : '自重 × ' + adv.reps) + ' 开始'
      : '跳过休息，下一组';
    this._restEnd = Date.now() + restSec * 1000;
    this._restPaused = false;
    this._restRemain = 0;
    const statAll = this.setsStat();
    this.setData({
      rows, stage: 'rest', restLeft: restSec, restTotal: restSec, restPct: 100, mmss: '0:00',
      restPaused: false,
      setNo: next + 1,
      setsDone: it.groups.filter(x => x.done).length, doneSets: stat.done, doneVolume: stat.vol, rpe: 0,
      hint: '第 ' + (gi + 1) + ' 组完成 · 休息 ' + restSec + '″，结束做第 ' + (next + 1) + ' 组',
      restTip: '', restAi: '',
      advW: adv.weight, advReps: nextG.reps || g.reps, restNextLabel: nextLabel,
      restMeta: '下组 ' + engine.wText(adv.weight, it.uni) + '×' + (nextG.reps || g.reps) + ' · ' + statAll.done + '/' + statAll.total,
      restCards: this.buildRestCards(it, g, nextG, adv, restSec, planSec, next),
      restIdx: 0
    });
    this.startCardTimer();
    wx.hideToast();
    this.aiRest(it, g, adv, planSec);
    this.refreshQueue();
    this.draw();
  },

  // 休息轮播：建议不拦路，要用才点
  buildRestCards(it, g, nextG, adv, restSec, planSec, next) {
    const reps = nextG.reps || g.reps;
    const wTxt = engine.wText(adv.weight, it.uni);
    const cards = [{
      k: 'use',
      t: '建议下一组 ' + wTxt + ' × ' + reps,
      sub: '',
      lb: engine.wText(adv.weight, it.uni),
      act: 'use'
    }, {
      k: 'add',
      t: '休息 ' + restSec + '″' + (planSec ? '，上次间隔 ' + planSec + '″' : ''),
      sub: '',
      lb: '休息 +15s',
      act: '+15'
    }];
    const restGroups = it.groups.length - next;
    const nextName = (this.items[this.idx + 1] || {}).name;
    cards.push({
      k: 'none',
      t: '本动作还剩 ' + restGroups + ' 组' + (nextName ? '，之后是 ' + nextName : '，之后收工'),
      sub: '', lb: '', act: ''
    });
    if ((g.rpe || 0) >= 9) {
      cards.push({ k: 'add', t: '上一组 RPE ' + g.rpe + '，可延长休息', sub: '', lb: '休息 +15s', act: '+15' });
    }
    return cards;
  },

  startCardTimer() {
    this.stopCardTimer();
    this._cardTimer = setInterval(() => {
      if (this.data.stage !== 'rest') { this.stopCardTimer(); return; }
      const n = (this.data.restCards || []).length;
      if (n < 2) return;
      this.setData({ restIdx: ((this.data.restIdx || 0) + 1) % n });
    }, 3500);
  },

  stopCardTimer() {
    if (this._cardTimer) { clearInterval(this._cardTimer); this._cardTimer = null; }
  },

  cardSwipeStart(e) {
    const t = (e.touches && e.touches[0]) || {};
    this._cardX = t.clientX || 0;
  },

  cardSwipeEnd(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || {};
    const dx = (t.clientX || 0) - (this._cardX || 0);
    const n = (this.data.restCards || []).length;
    if (!n || Math.abs(dx) < 30) return;
    const i = ((this.data.restIdx || 0) + (dx > 0 ? -1 : 1) + n) % n;
    this.setData({ restIdx: i });
    this.startCardTimer();
  },

  cardTap(e) {
    const act = e.currentTarget.dataset.act;
    if (!act) return;
    if (act === 'use') this.prefillNext();
    else if (act === '+15') this.extendRest(15);
  },

  // 行内「用 27.5kg」：只预填下一组，不打断休息
  prefillNext() {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const gi = this._gi;
    const g = it.groups[gi];
    if (!g) return;
    const w = this.data.advW;
    const reps = this.data.advReps;
    if (w !== undefined && w >= 0) g.weight = w;
    if (reps) g.reps = reps;
    this.saveStrength(it);
    const statAll = this.setsStat();
    this.setData({
      weight: g.weight, reps: g.reps, rows: this.rowsOf(it),
      restMeta: '下组 ' + engine.wText(g.weight, it.uni) + '×' + g.reps + ' · ' + statAll.done + '/' + statAll.total
    });
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '已设为 ' + engine.wText(g.weight, it.uni) + ' × ' + g.reps, icon: 'none' });
  },

  extendRest(sec) {
    if (this.data.stage !== 'rest') return;
    sec = Number(sec) || 15;
    const restTotal = (this.data.restTotal || 0) + sec;
    if (this.data.restPaused) {
      this._restRemain = (this._restRemain || 0) + sec * 1000;
      this.setData({ restTotal, restLeft: Math.round(this._restRemain / 1000) });
    } else {
      this._restEnd = (this._restEnd || Date.now()) + sec * 1000;
      this.setData({ restTotal });
    }
    wx.vibrateShort({ type: 'light' });
  },

  // 休息态单击 = 暂停/继续倒计时
  toggleRest() {
    if (this.data.stage !== 'rest') return;
    if (this.data.restPaused) {
      this._restEnd = Date.now() + (this._restRemain || 0);
      this._restRemain = 0;
      this._restPaused = false;
      this.setData({ restPaused: false });
      this.tick();
    } else {
      this._restRemain = Math.max(0, (this._restEnd || 0) - Date.now());
      this._restEnd = 0;
      this._restPaused = true;
      this.setData({ restPaused: true });
      this.draw();
    }
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
          const cards = (this.data.restCards || []).slice();
          if (cards[0]) { cards[0] = Object.assign({}, cards[0], { sub: t }); this.setData({ restCards: cards }); }
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
      this.setData({ weight: g.weight, wLabel: engine.wText(g.weight, it.uni), reps: g.reps, rows: this.rowsOf(it) });
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
      wx.showToast({ title: 'PR · ' + engine.wText(g.weight, it.uni) + ' × ' + g.reps, icon: 'none' });
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
    this.openPicker(ex => {
      if (!ex) return;
      this.appendItem(ex);
      wx.showToast({ title: '已加入队列', icon: 'none' });
    });
  },

  // 收工页加练：挑完直接切到新动作继续做
  addExtra() {
    this.openPicker(ex => {
      if (!ex) return;
      const i = this.appendItem(ex);
      this.idx = i;
      this.prepare();
      this.refreshQueue();
      this.persistFocus();
      wx.showToast({ title: '加练：' + ex.n, icon: 'none' });
    });
  },

  openPicker(cb) {
    wx.navigateTo({
      url: '/pages/library/index',
      events: { pick: cb }
    });
  },

  appendItem(ex) {
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
    return this.items.length - 1;
  },

  skipRest(auto) {
    auto = auto === true;
    this._restEnd = 0;
    this._restPaused = false;
    this._restRemain = 0;
    this.stopCardTimer();
    this.setData({
      stage: 'ready', restLeft: 0, restPct: 0, mmss: '0:00', restPaused: false,
      hint: (auto ? '休息结束 · ' : '') + '点环开始第 ' + (this._gi + 1) + ' 组，或先改重量'
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
      no: g.warmup ? 'W' : (i + 1), reps: g.reps || 0, weight: g.weight || 0, lw: g.lw, rw: g.rw,
      done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, tag: g.tag || (g.warmup ? 'warm' : '')
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
        uni: !!it.uni,
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
      uni: !!it.uni,
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
  // 长按 = 大步进（次数 ±3），点按仍是 ±1
  addRepBig() { this.bumpRep(3); wx.vibrateShort({ type: 'light' }); },
  subRepBig() { this.bumpRep(-3); wx.vibrateShort({ type: 'light' }); },
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
  // 长按 = 大步进（+5 / −2.5 的一次跳 5），点按仍是 +2.5 / −2.5
  addWeightBig() { this.bumpWeight(5); wx.vibrateShort({ type: 'light' }); },
  subWeightBig() { this.bumpWeight(-5); wx.vibrateShort({ type: 'light' }); },
  onWeightInput(e) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    const v = parseFloat(e.detail.value);
    g.weight = isNaN(v) ? 0 : Math.max(0, Math.round(v * 10) / 10);
    this.setData({ weight: g.weight, wLabel: engine.wText(g.weight, it.uni), rows: this.rowsOf(it) });
    this.refreshEdit();
  },
  bumpWeight(d) {
    const it = this.items[this.idx];
    if (!it || it.type !== 'strength') return;
    const g = it.groups[this._gi];
    g.weight = Math.max(0, Math.round(((g.weight || 0) + d) * 10) / 10);
    this.setData({ weight: g.weight, wLabel: engine.wText(g.weight, it.uni), rows: this.rowsOf(it) });
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
    // 整场用时按真实时钟算（含组间休息），不再只累加有氧时长
    const wall = this._sessionStart ? Math.round((Date.now() - this._sessionStart) / 1000) : 0;
    const sessionSec = Math.max(0, wall);
    this.setData({
      stage: 'finish', doneSets: stat.done, doneVolume: stat.vol, doneCardio: cardio,
      sessionSec,
      finishText: stat.done + ' 组 · ' + stat.vol + ' kg' + (cardio ? ' · 有氧 ' + cardio + '′' : ''),
      finishTime: sessionSec >= 60 ? Math.round(sessionSec / 60) + ' 分钟' : (sessionSec >= 1 ? sessionSec + ' 秒' : '不足 1 分钟'),
      pct: 100,
      aiReview: '',
      finNext: null,
      finTomorrow: null,
      finGoal: null
    });
    this.refreshQueue();
    this.persistFocus();
    // 悬浮球据此显示「结」挡：刚练完、小结还没看
    try { wx.setStorageSync('selfagent_finish_pending_v1', Date.now()); } catch (e) {}
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

  /* ---------- 圆环：work/ready = 计时器本体（一分钟一圈 + 5 分钟刻度）；rest = 倒计时 ---------- */
  draw() {
    if (!this.cv) { this.initCanvas(); return; }
    const cv = this.cv;
    const ctx = cv.ctx;
    const w = cv.w, h = cv.h;
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    const s = this.data.stage;
    if (s !== 'rest' && s !== 'work' && s !== 'ready' && s !== 'countdown') return;
    const r = Math.min(w, h) / 2 - 26;
    if (r <= 10) return;

    // 轨道
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = s === 'rest' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.09)';
    ctx.lineWidth = s === 'rest' ? 7 : 8;
    ctx.stroke();

    // 倒计时：环随秒数收拢 + 外圈一圈脉冲（3 → 2 → 1）
    if (s === 'countdown') {
      const left = Math.max(0, Math.min(3, this.data.cdLeft || 3));
      const p = 1 - left / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, p));
      ctx.strokeStyle = '#3DDCBF';
      ctx.lineWidth = 8;
      ctx.stroke();
      const ph = ((Date.now() % 1000) / 1000);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6 + ph * 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(61,220,191,' + (0.35 * (1 - ph)).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
      this.drawCharge(ctx, cx, cy, r);
      return;
    }

    if (s === 'rest') {
      const p = Math.max(0, Math.min(1, (this.data.restLeft || 0) / (this.data.restTotal || 1)));
      if (p > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.strokeStyle = this.data.restPaused ? 'rgba(61,220,191,0.45)' : '#3DDCBF';
        ctx.lineWidth = 7;
        ctx.stroke();
      }
      this.drawCharge(ctx, cx, cy, r);
      return;
    }

    const sec = s === 'ready' ? 0 : this.elapsedMs() / 1000;
    const minDone = Math.floor(sec / 300); // 每 5 分钟点亮 1 个刻度
    // 12 个刻度
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 12);
      const lit = i < minDone;
      const r1 = r - 15, r2 = r - 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.strokeStyle = lit ? 'rgba(61,220,191,0.95)' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = lit ? 3.5 : 2.5;
      ctx.stroke();
    }

    // 一分钟进度弧：每秒推进 1/60 圈，满圈回到 0，并有一次白光脉冲
    if (s === 'ready') {
      // 顶部呼吸光点，提示「点我」
      const t = (Date.now() % 1600) / 1600;
      const al = 0.35 + 0.5 * Math.abs(1 - 2 * t);
      ctx.beginPath();
      ctx.arc(cx, cy - r, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(61,220,191,' + al.toFixed(3) + ')';
      ctx.fill();
    } else {
      const p = (sec % 60) / 60;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.strokeStyle = s === 'work' && this.data.timerPaused ? 'rgba(61,220,191,0.55)' : '#3DDCBF';
      ctx.lineWidth = 8;
      ctx.stroke();
    }

    // 满 1 分钟的白光脉冲
    if (this._flash && Date.now() < this._flash) {
      const k = Math.max(0, (this._flash - Date.now()) / 240);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * k).toFixed(3) + ')';
      ctx.lineWidth = 12;
      ctx.stroke();
    }

    // 蓄能弧：完成=绿，重置=琥珀（颜色即语义）
    this.drawCharge(ctx, cx, cy, r);
  },

  drawCharge(ctx, cx, cy, r) {
    const charge = this.data.chargePct || 0;
    if (!charge) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, charge));
    ctx.strokeStyle = this.data.chargeColor || '#3DDCBF';
    ctx.lineWidth = 10;
    ctx.stroke();
  },

  /* ---------- 环手势：单击开始/暂停/继续；长按 650ms 蓄能 → 完成本组（暂停中也一样） ---------- */
  ringTouchStart(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    const st = this.data.stage;
    this._rt = { x: t.clientX, y: t.clientY, t0: Date.now(), moved: false, exec: false };
    this._rtAction = null;
    this._rtWarn = false;
    if (st === 'work') {
      this._rtAction = 'finish';
      this._rtWarn = !this.data.timerPaused && this.elapsedSec() < 3; // 刚点开始就长按：琥珀警示
    } else if (st === 'rest') {
      this._rtAction = 'skip';
      this._rtWarn = false;
    } else {
      return; // ready/countdown 只有单击（倒计时阶段不吃手势）
    }
    this.startCharge(this._rtAction, this._rtWarn);
  },

  ringTouchMove(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!this._rt || !t || !this._rtAction) return;
    if (Math.abs(t.clientX - this._rt.x) > 10 || Math.abs(t.clientY - this._rt.y) > 10) {
      this._rt.moved = true;
      this.stopCharge(true);
    }
  },

  ringTouchEnd() {
    const rt = this._rt;
    this._rt = null;
    if (!rt) return;
    const dur = Date.now() - rt.t0;
    if (rt.exec || rt.moved) { this.stopCharge(true); return; }
    if (dur >= 250 && this._rtAction) {
      // 蓄能没满就松手：就地回弹提示，不弹 toast
      this.stopCharge(true);
      this.flashChargeTip('再按久一点');
      return;
    }
    this.stopCharge(true);
    this.ringTap();
  },

  // 蓄能：650ms 扫满一圈，满即执行；action = finish | skip
  startCharge(action, warn) {
    if (this._chargeTimer) clearInterval(this._chargeTimer);
    this._chargeT0 = Date.now();
    this._chargeAction = action;
    this.setData({
      chargePct: 0.001,
      chargeColor: warn ? '#E8A93D' : '#3DDCBF',
      chargeTip: warn ? '刚开始就要完成？' : ''
    });
    this.draw();
    if (warn) wx.vibrateShort({ type: 'light' });
    this._chargeTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - this._chargeT0) / 650);
      this.setData({ chargePct: p });
      this.draw();
      if (p >= 1) {
        const act = this._chargeAction;
        if (this._rt) this._rt.exec = true;
        this.stopCharge(true);
        wx.vibrateShort({ type: 'heavy' });
        if (act === 'finish') this.finishSet();
        else if (act === 'skip') this.applyAdvice();
      }
    }, 40);
  },

  stopCharge(silent) {
    if (this._chargeTimer) { clearInterval(this._chargeTimer); this._chargeTimer = null; }
    const patch = { chargePct: 0, chargeTip: '' };
    if (!silent) patch.chargeColor = '#3DDCBF';
    this.setData(patch);
    this.draw();
  },

  flashChargeTip(txt) {
    this.setData({ chargePct: 0, chargeTip: txt });
    if (this._tipTimer) clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => this.setData({ chargeTip: '' }), 900);
  },

  // 首次引导：点按开始 · 练完长按环结束
  ringCoachOff() {
    if (!this.data.ringCoach) return;
    this.setData({ ringCoach: false });
    try { wx.setStorageSync('selfagent_coach_ring_v1', 1); } catch (e) {}
  },

  ringTap() {
    if (this.data.stage === 'rest') { this.toggleRest(); return; }
    if (this.data.stage === 'ready' && this.data.setTimer) {
      this.ringCoachOff();
      this.beginSet(false);
      wx.vibrateShort({ type: 'light' });
      return;
    }
    if (this.data.stage === 'work') this.togglePause();
  },

  noop() {}
});
