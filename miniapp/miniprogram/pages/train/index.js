const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const settings = require('../../libs/settings');
const recommend = require('../../libs/recommend');
const cloudurl = require('../../libs/cloudurl');
const thumb = require('../../libs/thumbcache');
const data = require('../../libs/data/index');
const cardioLib = require('../../libs/cardio');
const plan = require('../../libs/plan/index');
const CLIP_INDEX = require('../../libs/clip-index.js');

let openMap = {};
let timer = null;

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

function plateText(total) {
  const w = Number(total) || 0;
  if (w <= 20) return '空杆 20kg';
  let side = (w - 20) / 2;
  const out = [];
  let guard = 0;
  while (side > 0.01 && guard++ < 40) {
    const p = PLATES.find(x => x <= side + 0.001);
    if (!p) break;
    out.push(p);
    side = Math.round((side - p) * 100) / 100;
  }
  return '杆 20kg + 每侧 ' + (out.length ? out.join(' + ') + ' kg' : '无片');
}

function lastSetsOf(train, name, date) {
  const rs = (train.records || []).filter(r => r && r.name === name && r.date <= date);
  if (!rs.length) return null;
  const last = rs.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const gs = engine.ensureGroups(last).filter(g => g.done && !g.warmup);
  if (!gs.length) return { date: last.date, top: null, sets: 0 };
  const top = gs.reduce((a, g) => ((g.weight || 0) >= (a.weight || 0) ? g : a), gs[0]);
  return { date: last.date, top, sets: gs.length };
}

const isCardioEx = cardioLib.isCardioEx;

function buildView(date) {
  const train = engine.ensureTrain(store.getTrain());
  const names = actions.exNameMap();
  const items = engine.dayItems(train, date);
  const favs = train.favs || [];
  const list = items.map(it => {
    if (it.type === 'cardio') {
      const isSets = it.mode === 'sets';
      const gs = it.groups || [];
      // 有氧记录可能没存 exId（自助加的有氧/计划导入）：按名称回查动作库，图卡与详情都靠它
      const exName = it.modal || it.name || '';
      let exHit = it.exId ? data.byId(String(it.exId)) : null;
      if (!exHit && exName) exHit = data.matchByName(exName);
      const exId = it.exId || (exHit && exHit.id) || '';
      return {
        uid: it.uid, isCardio: true, exId: exId, cdMode: it.mode,
        name: it.name, part: '有氧',
        line: isSets
          ? (gs.length ? engine.groupLine(gs, it.uni) : (it.sets || 0) + ' 组') + (it.dist ? ' · ' + it.dist + 'km' : '')
          : (it.min || 0) + ' 分钟' + (it.dist ? ' · ' + it.dist + 'km' : ''),
        cdMin: it.min || 0,
        cdDist: it.dist || 0,
        done: !!it.done,
        doneN: isSets ? (it.doneN || 0) : (it.done ? 1 : 0),
        totalN: isSets ? (it.totalN || 0) : 1,
        volume: it.volume || 0,
        open: isSets ? !!openMap[it.uid] : false,
        fav: false,
        img: '',
        groups: gs.map(g => ({
          no: g.warmup ? 'W' : g.no,
          txt: g.lw != null || g.rw != null
            ? 'L' + (g.lw || 0) + ' R' + (g.rw || 0) + 'kg × ' + g.reps
            : engine.wText(g.weight, it.uni) + ' × ' + g.reps,
          sec: engine.fmtSec(g.sec),
          rpe: g.rpe || 0,
          done: !!g.done,
          warmup: !!g.warmup,
          tag: g.tag || ''
        }))
      };
    }
    const gs = it.groups || [];
    const uni = !!it.uni;
    const last = lastSetsOf(train, it.name, date);
    const top = last && last.top;
    const sug = top ? engine.wText(top.weight, uni) : '';
    return {
      uid: it.uid, isCardio: false, exId: it.exId,
      name: names[it.exId] || it.name,
      rawName: it.name,
      part: it.part,
      uni,
      line: engine.groupLine(gs, uni),
      doneN: gs.filter(g => g.done).length,
      totalN: gs.length || it.sets || 0,
      volume: it.volume || 0,
      open: !!openMap[it.uid],
      fav: favs.indexOf(it.exId) >= 0,
      sug,
      sugLine: top ? ('上次 ' + engine.wText(top.weight, uni) + ' × ' + (top.reps || 0) + ' 次 · ' + last.date.slice(5) + ' · 组间休 ' + settings.restFor(it.part, it.name) + '″') : '',
      img: '',
      groups: gs.map(g => ({
        no: g.warmup ? 'W' : g.no,
        txt: g.lw != null || g.rw != null
          ? 'L' + (g.lw || 0) + ' R' + (g.rw || 0) + 'kg × ' + g.reps
          : engine.wText(g.weight, uni) + ' × ' + g.reps,
        sec: engine.fmtSec(g.sec),
        rpe: g.rpe || 0,
        done: !!g.done,
        warmup: !!g.warmup,
        tag: g.tag || ''
      }))
    };
  });
  // 推荐动作：当天没练的、恢复好的部位
  let rec = { part: '', items: [] };
  if (list.length < 3) {
    const r = recommend.recommend(train, train.custom || []);
    const have = list.map(x => x.name);
    rec = {
      part: r.view,
      recovery: r.recovery ? r.recovery.text : '',
      items: (r.items || []).filter(x => have.indexOf(x.name) < 0).slice(0, 3).map(x => ({
        name: x.name, exId: x.exId, part: x.part, line: engine.wText(x.weight, engine.isUniName(x.name)) + ' × ' + x.reps + ' × ' + x.sets
      }))
    };
  }
  return { list, summary: engine.summaryText(items), empty: !list.length, rec };
}

Page({
  data: {
    date: '', dateLabel: '', dateText: '', isToday: true,
    today: '',
    barDate: '', planOpen: false, planWeek: [], planWeekTip: '',
    addOpen: false, addQuery: '', addPlanDate: '', addPlanLabel: '添加到今天',
    scrollDim: false,
    list: [], summary: '—', empty: true, fbDone: false, prToday: 0, prTxt: 'PR 榜',
    editorVisible: false, payload: null,
    streak: 0, weekDone: 0, kpis: [],
    grid: false,
    dragUid: '',
    rec: { part: '', items: [] },
    exSheetVisible: false,
    exSheetId: '',
    exSheetName: '',
    exSheetUid: '',
    rest: { show: false, left: 0, label: '' },
    same: { show: false, part: '', id: '', name: '', equip: '', line: '', why: '', idx: 0, total: 0 }
  },

  onLoad() {
    this.media = {};
    this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    this.setData({ date: engine.dayKey(), today: engine.dayKey() });
    this.refresh();
  },

  onShow() {
    this.refresh();
    this.consumeLibPick();
    this.consumeSummaryPending();
  },

  // 刚练完：悬浮球「结」挡点进来，或从别的 tab 切回来时补看小结
  consumeSummaryPending() {
    let pend = 0;
    try { pend = Number(wx.getStorageSync('selfagent_finish_pending_v1') || 0); } catch (e) {}
    if (!pend || Date.now() - pend > 3 * 3600 * 1000) return;
    setTimeout(() => this.showSummary(), 500);
  },

  orbSummary() { this.showSummary(); },

  // 滚动时把悬浮球压淡，别挡行尾的 ⋯ / ＋ 加入
  onPageScroll() {
    if (!this.data.scrollDim) this.setData({ scrollDim: true });
    if (this._dimT) clearTimeout(this._dimT);
    this._dimT = setTimeout(() => {
      this._dimT = null;
      this.setData({ scrollDim: false });
    }, 700);
  },

  // 动作库学习态「加入今天」：无 pick 通道时经本机中转
  consumeLibPick() {
    let p = null;
    try { p = wx.getStorageSync('selfagent_lib_pick_v1'); } catch (e) { p = null; }
    if (!p || !p.id) return;
    try { wx.removeStorageSync('selfagent_lib_pick_v1'); } catch (e) {}
    setTimeout(() => this.addPick(p), 80);
  },

  onHide() {
    this.stopRest();
    if (this.data.rest.show) this.setData({ rest: { show: false, left: 0, label: '' } });
  },

  onUnload() { this.stopRest(); },

  refresh() {
    const date = this.data.date || engine.dayKey();
    const v = buildView(date);
    const week = engine.lastNDays(store.getTrain(), 7);
    const weekDone = week.reduce((a, d) => a + d.done, 0);
    const streak = engine.streakDays(store.getTrain());
    // 收藏条：平时在动作库收藏的动作，练时一键加回今天
    const favIds = ((store.getTrain() || {}).favs) || [];
    const favStrip = favIds.slice(0, 20).map(id => {
      const ex = data.byId(String(id)) || actions.customList().find(x => x && x.id === id);
      return ex ? { id: String(id), n: ex.n, p: ex.p } : null;
    }).filter(Boolean);
    const allDone = !!v.list.length && v.list.every(it => (it.type === 'cardio'
      ? !!it.done
      : ((it.groups || []).length ? (it.groups || []).every(g => g.done) : false)));
    // 今日 PR 数：全库最佳成绩正好落在今天的动作个数（PR 入口降级成一个小灰字用）
    let prToday = 0;
    try {
      const dk = engine.dayKey();
      prToday = (require('../../libs/stats').prList(store.getTrain()) || []).filter(p => p && p.date === dk).length;
    } catch (e) {}
    this.setData({
      today: engine.dayKey(),
      dateLabel: engine.dateLabel(date),
      // 页内不再重复写「今天」（tab 已经说了），这里只给日期本身
      dateText: date === engine.dayKey() ? engine.shortDate(date) : engine.dateLabel(date),
      isToday: date === engine.dayKey(),
      list: this.withImg(v.list), summary: v.summary, empty: v.empty, rec: v.rec,
      fbDone: allDone,
      prToday,
      prTxt: prToday ? 'PR×' + prToday : 'PR 榜',
      streak, weekDone, favStrip,
      kpis: [
        { v: weekDone, l: '本周组数' },
        { v: streak, l: '连续天数' }
      ],
      barDate: engine.shortDate(engine.dayKey())
    });
    if (this.data.grid) this.fillGrid(v.list); else this.warmGrid(v.list);
    this.refreshPlanWeek();
  },

  // 点日期栏回到今天
  scrollTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 260 });
    this.setData({ barDate: engine.shortDate(engine.dayKey()) });
  },

  openPlan() {
    this.refreshPlanWeek();
    this.setData({ planOpen: true });
  },

  closePlan() {
    this.setData({ planOpen: false });
  },

  // 本周排期卡：只回答「这周哪天练什么、哪天还空着」
  refreshPlanWeek() {
    const rows = plan.weekRows(engine.ensureTrain(store.getTrain()));
    const n = plan.count(engine.dayKey());
    this.setData({
      planWeek: rows,
      planWeekTip: n ? '今天排了 ' + n + ' 个动作，一键落成训练' : '今天还没排，先去 📅 排一个'
    });
  },

  /* ---------------- 添加 sheet（＋ 的唯一入口） ---------------- */
  openAddSheet() {
    this._planDate = '';
    this.setData({ addOpen: true, addQuery: '', addPlanDate: '', addPlanLabel: '添加到今天' });
  },

  closeAdd() { this.setData({ addOpen: false }); },

  onAddInput(e) { this.setData({ addQuery: e.detail.value || '' }); },

  // 搜索框回车：走动作库的「AI 三合一」搜索（关键词 / 自然语言都在同一框里）
  addSearch() {
    const q = String(this.data.addQuery || '').trim();
    const date = this.data.addPlanDate;
    this.setData({ addOpen: false });
    this._planDate = date || '';
    this.openLibrary(q, date);
  },

  // sheet 里三条快速通道
  addPickLib() {
    const date = this.data.addPlanDate;
    this.setData({ addOpen: false });
    this._planDate = date || '';
    this.openLibrary('', date);
  },

  addCustom() {
    this.setData({ addOpen: false });
    this._planDate = '';
    wx.navigateTo({ url: '/pages/mylib/index' });
  },

  // 从计划加入：今天有排期就一次性落成训练记录；没有就转到排期卡去排
  addFromPlan() {
    const d = this.data.addPlanDate || this.data.today;
    if (plan.count(d)) {
      const n = plan.importToDate(d);
      this.setData({ addOpen: false, planOpen: false });
      this.refresh();
      wx.showToast({ title: n ? '已加入 ' + n + ' 个动作' : '今天的训练里已有这些动作', icon: 'none' });
      return;
    }
    this.setData({ addOpen: false });
    wx.showToast({ title: '这天还没排动作，先排一个', icon: 'none' });
    setTimeout(() => this.openPlan(), 200);
  },

  // 排期卡上「＋排」：复用同一个添加 sheet，只是落点换成该日计划
  planAddDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this._planDate = date;
    this.setData({
      planOpen: false, addOpen: true, addQuery: '',
      addPlanDate: date, addPlanLabel: '排到 ' + engine.shortDate(date)
    });
  },

  // sheet 里的 ✦ / 📷：AI 找动作、拍照识别，都走同一个 pick 回传
  addAiFind() {
    const date = this.data.addPlanDate;
    this.setData({ addOpen: false });
    this._planDate = date || '';
    wx.navigateTo({
      url: '/pages/aifind/index',
      events: { pick: (ex) => this.onPickArrive(ex) }
    });
  },

  addScan() {
    const date = this.data.addPlanDate;
    this.setData({ addOpen: false });
    this._planDate = date || '';
    wx.navigateTo({
      url: '/pages/scan/index',
      events: { pick: (ex) => this.onPickArrive(ex) }
    });
  },

  // 挑完一个动作：排期模式落进 plan.dates，否则照旧进「添加动作」编辑器
  onPickArrive(ex) {
    if (!ex) return;
    const date = this._planDate;
    if (date) {
      const hit = plan.add(date, { exId: ex.id || ex.exId, n: ex.n, p: ex.p || ex.part, cd: ex.p === '有氧' || ex.isCardio });
      this._planDate = '';
      this.refreshPlanWeek();
      // 排完把排期卡弹回来，能立刻看到这天多了一条
      this.setData({ planOpen: true });
      wx.showToast({ title: hit ? '已排到 ' + engine.shortDate(date) : '这天已经排过这个动作', icon: 'none' });
      return;
    }
    this.addPick(ex);
  },

  // 图卡缩略图：本机缓存 → 内存 → 自定义动作自带图 → 空（空则显示部位占位文字）
  withImg(list) {
    if (!this.media) this.media = {};
    if (!this.custImg) {
      this.custImg = {};
      (actions.customList() || []).forEach(c => {
        if (c && c.id) this.custImg[String(c.id)] = String(c.img || c.fileID || '');
      });
    }
    return list.map(x => {
      const id = String(x.exId || '');
      const isMy = id.indexOf('my') === 0;
      let u = this.media[id] || (id ? thumb.get(id) : '') || '';
      if (!u && isMy) {
        const raw = this.custImg[id] || '';
        if (/^https?:/.test(raw) || raw.indexOf('wxfile://') === 0 || raw.indexOf('/') === 0) u = raw;
        else if (raw.indexOf('cloud://') === 0) this.resolveCustImg(id, raw);
      }
      if (u) this.media[id] = u;
      return u === x.img ? x : Object.assign({}, x, { img: u });
    });
  },

  // 自定义动作的图：cloud:// 换成临时 https（<image> 不认 cloud://）
  resolveCustImg(id, fid) {
    if (!wx.cloud || !this.data.cloudReady && this.data.cloudReady !== undefined) { /* 无云也试一次 */ }
    if (!this.custFid) this.custFid = {};
    if (this.custFid[id] || !fid) return;
    this.custFid[id] = fid;
    if (!this.fid) this.fid = {};
    this.fid[id] = fid;
    cloudurl.resolve([fid], (urls) => {
      const u = (urls && urls[fid]) || '';
      if (!u) { this.custFid[id] = ''; return; }
      this.media[id] = u;
      this.setData({ list: this.withImg(this.data.list) });
    });
  },

  // 进页面就预热缩略图（不等切到图卡），切过去时基本已就绪
  warmGrid(list) {
    this.gridIds(list);
  },

  fillGrid(list) {
    this.gridIds(list);
  },

  // 库动作走 gifMigrate 映射；自定义动作（my…）直接用自己上传的图
  gridIds(list) {
    const ids = (list || []).filter(x => x.exId && !this.media[String(x.exId)]).map(x => String(x.exId));
    const my = ids.filter(id => id.indexOf('my') === 0);
    const lib = ids.filter(id => /^\d{4}$/.test(id));
    my.forEach(id => {
      if (thumb.get(id)) { this.media[id] = thumb.get(id); return; }
      const raw = (this.custImg && this.custImg[id]) || '';
      if (/^https?:/.test(raw) || raw.indexOf('wxfile://') === 0) { this.media[id] = raw; return; }
      if (raw.indexOf('cloud://') === 0) this.resolveCustImg(id, raw);
    });
    if (!lib.length || !wx.cloud || !wx.cloud.callFunction) return;
    this.mapChunk(lib.slice(0, 20));
    const rest = lib.slice(20);
    if (rest.length) setTimeout(() => this.fillGridIds(rest), 1200);
  },

  fillGridIds(ids) {
    if (!ids || !ids.length) return;
    this.mapChunk(ids.slice(0, 20));
  },

  mapChunk(todo) {
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: todo } })
      .then(r => {
        const map = ((r && r.result) || {}).map || {};
        const keys = Object.keys(map);
        if (!this.fid) this.fid = {};
        keys.forEach(k => { this.fid[k] = map[k]; });
        if (!keys.length) { this.applyFallback(todo); return; }
        cloudurl.resolve(keys.map(k => map[k]), (urls) => {
          keys.forEach(k => {
            const u = urls[map[k]] || '';
            if (u) this.media[k] = u;
          });
          this.applyFallback(keys);
        });
      })
      .catch(() => this.applyFallback(todo));
  },

  // 映射里没有的：先用 jsDelivr 直连（图挂了由 binderror 再清成占位符）
  applyFallback(ids) {
    (ids || []).forEach(id => {
      if (this.media[id] || (id && thumb.get(id))) return;
      if (/^\d{4}$/.test(String(id))) this.media[id] = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
    });
    this.setData({ list: this.withImg(this.data.list) });
  },

  // 图片真的画出来了：把这张落成本地文件，下次开页直接读盘
  gridImgOk(e) {
    const uid = e.currentTarget.dataset.uid;
    const it = (this.data.list || []).find(x => x.uid === uid);
    if (!it) return;
    const id = String(it.exId || '');
    if (!(/^\d{4}$/.test(id) || id.indexOf('my') === 0) || thumb.get(id)) return;
    const fid = (this.fid || {})[id];
    if (!fid || !wx.cloud || !wx.cloud.downloadFile) return;
    if (!this.caching) this.caching = {};
    if (this.caching[id]) return;
    this.caching[id] = 1;
    wx.cloud.downloadFile({ fileID: fid })
      .then(res => {
        const p = res && res.tempFilePath;
        const local = p ? thumb.save(id, p) : '';
        if (local) this.media[id] = local;
      })
      .catch(() => {});
  },

  // 图卡图片加载失败：云下载 → jsDelivr CDN → 占位块（先国内可用的云，CDN 兜底）
  gridImgErr(e) {
    const uid = e.currentTarget.dataset.uid;
    const idx = (this.data.list || []).findIndex(x => x.uid === uid);
    if (idx < 0) return;
    const it = this.data.list[idx];
    const id = String(it.exId || '');
    const cur = it.img || '';
    if (!/^\d{4}$/.test(id)) { this.patchImg(idx, ''); return; }
    if (!this.dlTried) this.dlTried = {};
    // 已有本地缓存却还报错：文件坏了，丢掉缓存再取
    const cached = thumb.get(id);
    if (cached && cur === cached) {
      this.media[id] = '';
      try { thumb.drop && thumb.drop(id); } catch (err) {}
      this.dlTried[id] = 1;
    }
    if (this.dlTried[id]) {
      const cdn = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
      if (cur.indexOf('cdn.jsdelivr.net') < 0) { this.patchImg(idx, cdn); return; }
      if (this.media) this.media[id] = '';
      this.patchImg(idx, '');
      return;
    }
    this.dlTried[id] = 1;
    if (!wx.cloud || !wx.cloud.downloadFile) { this.patchImg(idx, ''); return; }
    const useFid = (this.fid && this.fid[id]) || '';
    const grab = (fid) => {
      if (!fid) { this.patchImg(idx, ''); return; }
      wx.cloud.downloadFile({ fileID: fid })
        .then(res => {
          const p = res && res.tempFilePath;
          if (!p) { this.patchImg(idx, ''); return; }
          const local = thumb.save(id, p);
          if (this.media) this.media[id] = local || p;
          this.patchImg(idx, local || p);
        })
        .catch(() => this.patchImg(idx, ''));
    };
    if (useFid) { grab(useFid); return; }
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: [id] } })
      .then(r => {
        const fid = (((r && r.result) || {}).map || {})[id];
        if (!this.fid) this.fid = {};
        if (fid) this.fid[id] = fid;
        grab(fid);
      })
      .catch(() => this.patchImg(idx, ''));
  },

  patchImg(idx, url) {
    const patch = {};
    patch['list[' + idx + '].img'] = url;
    this.setData(patch);
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
    if (this.dragMoved || Date.now() - (this.dragTs || 0) < 350) return;
    const uidVal = e.currentTarget.dataset.uid;
    openMap[uidVal] = !openMap[uidVal];
    this.refresh();
  },

  toggleGrid() {
    const g = !this.data.grid;
    this.setData({ grid: g });
    if (g) this.fillGrid(this.data.list);
  },

  /* ---------- 长按拖拽排序（列表视图，力量与有氧同一顺序） ---------- */
  dragStart(e) {
    if (this.data.grid) return;
    const uid = e.currentTarget.dataset.uid;
    if (!uid) return;
    const touch = (e.touches && e.touches[0]) || null;
    this.drag = {
      uid, idx: -1, cur: -1, dy: 0, rects: null,
      startY: touch ? touch.clientY : 0
    };
    this.dragMoved = false;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    const q = wx.createSelectorQuery().in(this);
    q.selectAll('.ex').boundingClientRect((rects) => {
      const dg = this.drag;
      if (!dg || dg.uid !== uid || !rects || !rects.length) return;
      const idx = (this.data.list || []).findIndex(x => x.uid === uid);
      if (idx < 0) { this.drag = null; return; }
      dg.rects = rects;
      dg.idx = idx;
      dg.cur = idx;
      this.setData({ dragUid: uid });
    }).exec();
  },

  dragMove(e) {
    const dg = this.drag;
    if (!dg || !dg.rects) return;
    const touch = (e.touches && e.touches[0]) || null;
    if (!touch) return;
    const raw = touch.clientY - dg.startY;
    const r = dg.rects[dg.idx];
    const first = dg.rects[0];
    const last = dg.rects[dg.rects.length - 1];
    const minDy = first.top - r.top;
    const maxDy = last.top + last.height - r.height - r.top;
    let dy = raw;
    if (dy < minDy) dy = minDy;
    if (dy > maxDy) dy = maxDy;
    if (Math.abs(dy) > 4) this.dragMoved = true;
    dg.dy = dy;
    const center = r.top + r.height / 2 + dy;
    let target = 0;
    for (let i = 0; i < dg.rects.length; i++) {
      if (center > dg.rects[i].top + dg.rects[i].height / 2) target = i;
    }
    const patch = {};
    patch['list[' + dg.idx + '].dy'] = Math.round(dy);
    if (target !== dg.cur) {
      dg.cur = target;
      const h = r.height;
      for (let i = 0; i < dg.rects.length; i++) {
        if (i === dg.idx) continue;
        let v = 0;
        if (dg.idx < target && i > dg.idx && i <= target) v = -h;
        else if (dg.idx > target && i >= target && i < dg.idx) v = h;
        patch['list[' + i + '].dy'] = Math.round(v);
      }
    }
    this.setData(patch);
  },

  dragEnd() {
    const dg = this.drag;
    this.dragTs = Date.now();
    // 必须在出口复位：否则拖过一次排序后 dragMoved 永久为 true，之后所有行点击都被 toggleRow 静默吞掉
    this.dragMoved = false;
    if (!dg) return;
    this.drag = null;
    const clean = this.data.list.map(x => (x.dy ? Object.assign({}, x, { dy: 0 }) : x));
    if (!dg.rects || dg.idx < 0) { this.setData({ dragUid: '', list: clean }); return; }
    const from = dg.idx;
    const to = dg.cur;
    if (from !== to) {
      const uids = this.data.list.map(x => x.uid);
      const moved = uids.splice(from, 1)[0];
      uids.splice(to, 0, moved);
      actions.reorderDay(this.data.date, uids);
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      this.setData({ dragUid: '', list: clean });
      this.refresh();
      wx.showToast({ title: '顺序已调整', icon: 'none', duration: 1200 });
      return;
    }
    this.setData({ dragUid: '', list: clean });
  },

  /* ---------- 动作详情：页内浮层（components/ex-sheet），只显示当前这个动作 ---------- */
  openDetail(e) {
    const uid = e.currentTarget.dataset.uid;
    const train = engine.ensureTrain(store.getTrain());
    const rec = (train.records || []).find(x => x && x.uid === uid);
    if (!rec) {
      // 有氧：从名称回查动作库，同样能打开详情浮层（可改计组方式）
      const cd = (train.cardio || []).find(x => x && x.uid === uid);
      if (!cd) { wx.showToast({ title: '找不到这个动作', icon: 'none' }); return; }
      const name = cd.modal || cd.name || '';
      let ex = cd.exId ? data.byId(String(cd.exId)) : null;
      if (!ex) ex = data.matchByName(name);
      if (!ex) { wx.showToast({ title: '动作库里找不到这个动作', icon: 'none' }); return; }
      this.setData({ exSheetId: String(ex.id), exSheetName: name, exSheetUid: cd.uid, exSheetVisible: true });
      return;
    }
    const exId = String(rec.exId || '');
    if (!exId) { wx.showToast({ title: '这个动作没有动作库条目', icon: 'none' }); return; }
    const found = data.byId(exId) || (actions.customList() || []).some(x => x && x.id === exId);
    if (!found) { wx.showToast({ title: '动作库里找不到这个动作', icon: 'none' }); return; }
    this.setData({ exSheetId: exId, exSheetName: rec.name || '', exSheetUid: '', exSheetVisible: true });
  },

  closeExSheet() { this.setData({ exSheetVisible: false }); },

  // 自定义动作：从详情浮层直接去「我的动作库」改名称/部位/要领/图片
  onExSheetEdit(e) {
    const id = ((e && e.detail) || {}).id;
    this.setData({ exSheetVisible: false });
    if (!id) return;
    wx.navigateTo({ url: '/pages/mylib/index?edit=' + encodeURIComponent(id) });
  },

  // 详情浮层里「保存方式并加入今日」
  onExSheetSave(e) {
    const d = e.detail || {};
    const payload = {
      uid: d.uid,
      date: this.data.date,
      name: d.name,
      exId: d.exId,
      part: '有氧',
      mode: d.mode,
      min: d.min,
      dur: d.dur,
      dist: d.dist,
      groups: d.groups,
      done: d.done
    };
    actions.saveCardio(payload);
    this.setData({ exSheetVisible: false });
    this.refresh();
    wx.showToast({ title: d.isNew ? '已加入今日' : '已保存方式', icon: 'none' });
  },

  // 有氧计组型：点某一组记一组
  tapCardioGroup(e) {
    const uid = e.currentTarget.dataset.uid;
    const i = Number(e.currentTarget.dataset.i);
    const rec = actions.toggleCardioGroup(this.data.date, uid, i);
    if (!rec) return;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.refresh();
  },

  // 点某一组：直接打卡 / 取消，并起休息倒计时
  tapGroup(e) {
    const uid = e.currentTarget.dataset.uid;
    const i = Number(e.currentTarget.dataset.i);
    const rec = actions.toggleGroup(this.data.date, uid, i);
    if (!rec) return;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    const gs = engine.ensureGroups(rec);
    if (gs[i] && gs[i].done) this.startRest(rec, gs, i);
    this.refresh();
    const allDone = gs.every(g => g.done);
    if (allDone) setTimeout(() => this.showSummary(), 300);
  },

  startRest(rec, gs, i) {
    const sec = settings.restFor(rec.part, rec.name);
    if (!sec) return;
    this.stopRest();
    const auto = settings.trainCfg().autoNext;
    let left = sec;
    this.setData({ rest: { show: true, left, label: rec.name + ' · 组间休息' } });
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        this.stopRest();
        this.setData({ rest: { show: false, left: 0, label: '' } });
        const next = gs[i + 1];
        if (auto && next) {
          wx.showToast({ title: '下一组：' + engine.wText(next.weight, engine.uniOf(rec)) + ' × ' + next.reps, icon: 'none' });
        }
        return;
      }
      this.setData({ 'rest.left': left });
    }, 1000);
  },

  stopRest() {
    if (timer) { clearInterval(timer); timer = null; }
  },

  skipRest() {
    this.stopRest();
    this.setData({ rest: { show: false, left: 0, label: '' } });
  },

  // 组行菜单：暖身 / 递减 / 单侧 / 超级组 / 复制上一组 / 删除本组
  openSetMenu(e) {
    const uid = e.currentTarget.dataset.uid;
    const i = Number(e.currentTarget.dataset.i);
    const recs = (engine.ensureTrain(store.getTrain()).records || []);
    const rec = recs.find(r => r && r.uid === uid);
    if (!rec) return;
    const gs = engine.ensureGroups(rec);
    const g = gs[i];
    if (!g) return;
    const curTag = g.tag || '';
    const items = [
      g.warmup ? '取消暖身标记' : '标记为暖身组',
      curTag === 'drop' ? '取消递减组' : '标记递减组',
      curTag === 'side' ? '取消单侧' : '标记单侧',
      curTag === 'super' ? '取消超级组' : '标记超级组',
      '复制上一组的重量与次数',
      '删除这一组'
    ];
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const idx = r.tapIndex;
        if (idx === 0) { g.warmup = !g.warmup; }
        else if (idx <= 3) {
          const tag = ['warm', 'drop', 'side', 'super'][idx];
          g.tag = curTag === tag ? '' : tag;
          if (tag === 'warm') g.warmup = true;
        } else if (idx === 4) {
          const prev = gs[i - 1];
          if (!prev) { wx.showToast({ title: '没有上一组', icon: 'none' }); return; }
          g.weight = prev.weight; g.reps = prev.reps; g.warmup = prev.warmup; g.tag = prev.tag;
        } else {
          if (gs.length <= 1) { wx.showToast({ title: '至少留一组', icon: 'none' }); return; }
          gs.splice(i, 1);
        }
        rec.groups = gs;
        rec.sets = gs.length;
        actions.saveStrength(rec);
        this.refresh();
      }
    });
  },

  // 动作行菜单：改名 / 收藏 / 杠铃片 / 休息秒数 / 删除
  openRowMenu(e) {
    const uid = e.currentTarget.dataset.uid;
    const train = engine.ensureTrain(store.getTrain());
    const rec = (train.records || []).find(r => r && r.uid === uid);
    const cd = rec ? null : (train.cardio || []).find(c => c && c.uid === uid);
    if (!rec && !cd) return;

    // 有氧行只给三项：详情 / 编辑 / 收藏 / 删除（没有组次与杠铃片）
    if (cd) {
      const favs = train.favs || [];
      const name = cd.modal || cd.name || '';
      let ex = cd.exId ? data.byId(String(cd.exId)) : null;
      if (!ex) ex = data.matchByName(name);
      const exId = cd.exId || (ex && ex.id) || '';
      const isFav = !!exId && favs.indexOf(exId) >= 0;
      const items = ['查看动作详情'];
      if (exId) items.push(isFav ? '取消收藏' : '收藏这个动作');
      items.push('删除这个动作');
      wx.showActionSheet({
        itemList: items,
        success: (r) => {
          const picked = items[r.tapIndex];
          if (picked === '查看动作详情') { this.openDetail({ currentTarget: { dataset: { uid } } }); return; }
          if (picked === '删除这个动作') {
            wx.showModal({
              title: '删除有氧',
              content: '会从 ' + this.data.dateLabel + ' 移除「' + name + '」，记录不可恢复。',
              confirmText: '删除', confirmColor: '#D9534F',
              success: (m) => {
                if (!m.confirm) return;
                actions.deleteCardio(uid, this.data.date);
                this.refresh();
                wx.showToast({ title: '已删除', icon: 'none' });
              }
            });
            return;
          }
          actions.toggleFav(exId);
          this.refresh();
          wx.showToast({ title: isFav ? '已取消收藏' : '已收藏', icon: 'none' });
        }
      });
      return;
    }

    const favs = train.favs || [];
    const isFav = favs.indexOf(rec.exId) >= 0;
    wx.showActionSheet({
      itemList: ['查看动作详情', '编辑组次', isFav ? '取消收藏' : '收藏这个动作', '杠铃片构成', '默认休息秒数', '推荐同部位动作', '删除这个动作'],
      success: (r) => {
        if (r.tapIndex === 0) { this.openDetail({ currentTarget: { dataset: { uid } } }); return; }
        if (r.tapIndex === 1) { this.openEdit({ currentTarget: { dataset: { uid } } }); return; }
        if (r.tapIndex === 2) {
          actions.toggleFav(rec.exId);
          this.refresh();
          wx.showToast({ title: isFav ? '已取消收藏' : '已收藏', icon: 'none' });
          return;
        }
        if (r.tapIndex === 3) { this.showPlates(rec); return; }
        if (r.tapIndex === 4) { this.setRestSec(rec); return; }
        if (r.tapIndex === 5) { this.openSameRec(rec.part); return; }
        wx.showModal({
          title: '删除动作',
          content: '会从 ' + this.data.dateLabel + ' 移除「' + rec.name + '」，记录不可恢复。',
          confirmText: '删除', confirmColor: '#D9534F',
          success: (m) => {
            if (!m.confirm) return;
            actions.deleteStrength(uid, this.data.date);
            this.refresh();
            wx.showToast({ title: '已删除', icon: 'none' });
          }
        });
      }
    });
  },

  showPlates(rec) {
    const gs = engine.ensureGroups(rec).filter(g => g.done && !g.warmup);
    const top = gs.reduce((a, g) => ((g.weight || 0) >= (a.weight || 0) ? g : a), gs[0] || null);
    if (!top || !(top.weight > 0)) { wx.showToast({ title: '自重动作不需要杠铃片', icon: 'none' }); return; }
    wx.showModal({
      title: top.weight + 'kg · 杠铃片',
      content: plateText(top.weight) + '\n（杆 20kg，两侧均分，从大到小装片）',
      showCancel: false, confirmText: '知道了'
    });
  },

  setRestSec(rec) {
    const cur = settings.restFor(rec.part, rec.name);
    wx.showActionSheet({
      itemList: ['60 秒', '90 秒', '120 秒', '150 秒', '180 秒'],
      success: (r) => {
        const sec = [60, 90, 120, 150, 180][r.tapIndex];
        settings.setTrainCfg({ rest: sec });
        this.refresh();
        wx.showToast({ title: '默认休息 ' + sec + ' 秒', icon: 'none' });
      }
    });
  },

  // 训练小结：全部做完时给一次
  showSummary() {
    try { wx.removeStorageSync('selfagent_finish_pending_v1'); } catch (e) {}
    const items = engine.dayItems(engine.ensureTrain(store.getTrain()), this.data.date);
    const s = engine.summarize(items);
    const vol = s.volume;
    wx.showModal({
      title: '训练小结',
      content: '完成 ' + s.done + '/' + s.total + ' 组 · 容量 ' + vol + ' kg\n' + items.map(it => {
        if (it.type === 'cardio') {
          return it.mode === 'sets' ? (it.name + ' ' + (it.doneN || 0) + '/' + (it.sets || 0) + ' 组') : (it.name + ' ' + (it.min || 0) + '′');
        }
        return it.name + ' ' + (it.done || 0) + '/' + (it.sets || 0) + ' 组';
      }).join('\n'),
      confirmText: '收工', cancelText: '继续练',
      success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/log/index' }); }
    });
  },

  openEdit(e) {
    const uid = e.currentTarget.dataset.uid;
    const cardio = e.currentTarget.dataset.cardio;
    const train = engine.ensureTrain(store.getTrain());
    if (cardio) {
      const c = (train.cardio || []).find(x => x && x.uid === uid);
      if (!c) return;
      // 计组型：直接进详情浮层，用分段控件改方式与参数
      if (c.mode === 'sets') {
        const name = c.modal || c.name || '';
        let ex = c.exId ? data.byId(String(c.exId)) : null;
        if (!ex) ex = data.matchByName(name);
        if (ex) { this.setData({ exSheetId: String(ex.id), exSheetName: name, exSheetUid: c.uid, exSheetVisible: true }); return; }
        wx.showToast({ title: '动作库外条目，只能在详情页改', icon: 'none' });
        return;
      }
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
        date: this.data.date, uni: engine.uniOf(r), groups: engine.ensureGroups(r)
      }
    });
  },

  // 动作库/选择器选中一个动作：有氧 → 详情浮层（计组方式），力量 → 训练表单
  addPick(ex) {
    if (!ex) return;
    if (isCardioEx(ex) && ex.id) {
      this.setData({ exSheetId: String(ex.id), exSheetName: ex.n || '', exSheetUid: '', exSheetVisible: true });
      return;
    }
    this.setData({
      editorVisible: true,
      payload: {
        mode: 'strength', isNew: true, name: ex.n, part: ex.p, exId: ex.id, date: this.data.date,
        uni: engine.isUniName(ex.n),
        groups: [{ no: 1, reps: 10, weight: 0, done: false }]
      }
    });
  },

  // ＋ 直达动作库：主路径一步进入（搜索框自动聚焦），低频方式收进库内顶部
  // 动作库：唯一添加入口；带上 q 直接落到搜索结果，带上 date 则落点是那天的排期
  openLibrary(q, date) {
    let part = '';
    // 兼容旧的模板直接 bindtap="openLibrary" / data-part：参数是一个事件对象
    if (q && typeof q === 'object') {
      const ds = (q.currentTarget && q.currentTarget.dataset) || {};
      part = ds.part || '';
      q = '';
    }
    const qs = [];
    if (q) qs.push('q=' + encodeURIComponent(String(q)));
    if (part) qs.push('part=' + encodeURIComponent(part));
    if (date) qs.push('plan=' + encodeURIComponent(String(date)));
    this._planDate = date || '';
    wx.navigateTo({
      url: '/pages/library/index' + (qs.length ? '?' + qs.join('&') : ''),
      events: { pick: (ex) => this.onPickArrive(ex) }
    });
  },

  // PR 榜 / 梯度：成绩榜与逐日增长，入口从设置挪到训练页顶栏
  goPr() { wx.navigateTo({ url: '/pages/pr/index' }); },

  focus(e) { this.openFocusByUid(e.currentTarget.dataset.uid); },

  addFav(e) {
    const d = e.currentTarget.dataset;
    if (!d || !d.id) return;
    this.addPick({ id: d.id, n: d.name || '', p: d.part || '' });
  },

  /* ---------------- 同部位推荐（AI 推荐卡） ---------------- */
  closeSame() { this.setData({ same: Object.assign({}, this.data.same, { show: false }) }); },

  openSameRec(part) {
    const ALIAS = { '腿': '上腿', '手臂': '上臂', '腹': '腰腹', '腹部': '腰腹', '背部': '背', '胸部': '胸', '肩部': '肩' };
    const p = ALIAS[String(part || '').trim()] || String(part || '').trim();
    if (!p || p === '有氧') { wx.showToast({ title: '有氧没有同部位推荐', icon: 'none' }); return; }
    this._sameWhy = [
      '同部位 · 换个角度刺激',
      '同部位 · 补足训练容量',
      '同部位 · 换器械，避开习惯动作',
      '同部位 · 放到后面收尾正好'
    ];
    this.buildSamePool(p);
    this.showSameAt(0);
  },

  // 候选池：同部位、今天还没加；先挑常见动作（推/划/蹲/弯举…），冷门与拉伸类靠后
  buildSamePool(part) {
    const train = engine.ensureTrain(store.getTrain());
    const used = {};
    (train.records || []).forEach(r => { if (r && r.date === this.data.date && r.exId) used[String(r.exId)] = 1; });
    const all = data.all().filter(x => x && x.p === part && !used[String(x.id)] && String(x.id).indexOf('my') !== 0);
    const POP = ['推', '划船', '蹲', '弯举', '飞鸟', '平举', '下拉', '硬拉', '腿举', '卷腹', '提踵',
      '俯卧撑', '臂屈伸', '下压', '夹胸', '引体', '耸肩', '面拉', '臀桥', '弓步', '侧屈', '挺身'];
    const COLD = ['拉伸', '活动度', 'pose', '瑜伽', '呼吸', '放松', '泡沫轴'];
    const hot = [];
    const cold = [];
    all.forEach(x => {
      const n = String(x.n || '').toLowerCase();
      if (COLD.some(w => n.indexOf(w) >= 0)) cold.push(x);
      else if (POP.some(w => n.indexOf(w) >= 0)) hot.push(x);
      else cold.push(x);
    });
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
    this._same = shuffle(hot).concat(shuffle(cold)).slice(0, 80);
  },

  showSameAt(i) {
    const pool = this._same || [];
    if (!pool.length) {
      this.setData({ same: Object.assign({}, this.data.same, { show: false }) });
      wx.showToast({ title: '这个部位的动作今天都加过了', icon: 'none' });
      return;
    }
    const idx = ((i % pool.length) + pool.length) % pool.length;
    const it = pool[idx];
    const whys = this._sameWhy || ['同部位 · 换个角度刺激'];
    const why = whys[idx % whys.length];
    this.setData({
      same: {
        show: true, part: it.p, id: String(it.id), name: it.n, equip: it.e || '自重',
        line: '3 组 × 12', why, idx, total: pool.length
      }
    });
  },

  // 重新推荐：重新打散候选池（保证换一个，不原地重弹）
  rerollSame() {
    if (!this.data.same.part) return;
    const old = this.data.same.id;
    this.buildSamePool(this.data.same.part);
    this.showSameAt(0);
    if (this.data.same.id === old && (this._same || []).length > 1) this.showSameAt(1);
  },

  // 继续推荐下一个：按当前池顺序轮下去
  nextSame() {
    if (!this._same || !this._same.length) return;
    this.showSameAt((this.data.same.idx || 0) + 1);
  },

  addSame() {
    const s = this.data.same;
    if (!s || !s.id) return;
    this.closeSame();
    this.addPick({ id: s.id, n: s.name, p: s.part });
  },
  openFocusByUid(uid) {
    const train = engine.ensureTrain(store.getTrain());
    const hit = (train.records || []).some(x => x && x.uid === uid) ||
      (train.cardio || []).some(x => x && x.uid === uid);
    if (!hit) return;
    wx.navigateTo({ url: '/pages/focus/index?date=' + (this.data.date || engine.dayKey()) + (uid ? '&uid=' + uid : '') });
  },

  orbFocus() {
    const items = engine.dayItems(engine.ensureTrain(store.getTrain()), this.data.date);
    if (!items.length) { wx.showToast({ title: '先添加一个动作再开专注', icon: 'none' }); return; }
    const undoneSt = items.filter(it => it.type !== 'cardio' && (it.groups || []).some(g => !g.done));
    const undoneCd = items.filter(it => it.type === 'cardio' && !it.done);
    const target = undoneSt[0] || undoneCd[0] || items[0];
    this.openFocusByUid(target.uid);
  },

  afterNote() { this.refresh(); },

  // 推荐动作：一键加入今天
  addRec(e) {
    const ds = e.currentTarget.dataset;
    if (!ds || !ds.exid || !ds.name) return; // 防误触：没有动作参数就不弹编辑层
    const train = engine.ensureTrain(store.getTrain());
    const custom = (train.custom || []).find(x => x.id === ds.exid);
    const item = this.data.rec.items.find(x => x.exId === ds.exid);
    this.setData({
      editorVisible: true,
      payload: {
        mode: 'strength', isNew: true, name: ds.name, part: ds.part || (custom ? custom.p : (item ? item.part : '')),
        exId: ds.exid, date: this.data.date,
        groups: [{ no: 1, reps: 10, weight: 0, done: false }, { no: 2, reps: 10, weight: 0, done: false }, { no: 3, reps: 10, weight: 0, done: false }]
      }
    });
  },

  openAifind() { this.openPickerPage('/pages/aifind/index'); },
  openScan() { this.openPickerPage('/pages/scan/index'); },

  openPickerPage(url) {
    wx.navigateTo({
      url,
      events: { pick: (ex) => this.addPick(ex) }
    });
  },

  // 兼容旧入口：三段已并成单流，切分段一律回到今天
  switchTab() {
    openMap = {};
    this.scrollTop();
    this.refresh();
  },

  // 计划内「加入训练」写入后，回到今天分段时列表要新
  onPlanChanged() {
    this.refresh();
  },

  addExercise() {
    wx.navigateTo({
      url: '/pages/picker/index',
      events: { pick: (ex) => this.addPick(ex) }
    });
  },

  onEditorClose() { this.setData({ editorVisible: false, payload: null }); },

  onEditorConfirm(e) {
    const d = e.detail;
    const rec = Object.assign({}, d.record, { date: this.data.date });
    if (d.mode === 'cardio') {
      rec.mode = rec.mode || 'timer';
      rec.part = '有氧';
      rec.name = rec.name || rec.modal;
      rec.dur = rec.min;
      actions.saveCardio(rec);
    } else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: d.isNew ? '已添加' : '已保存', icon: 'none' });
    // 刚加入一个动作：顺手推荐同部位的另一个动作
    if (d.isNew && d.mode !== 'cardio' && (rec.part || d.record.part)) {
      setTimeout(() => this.openSameRec(rec.part || d.record.part), 320);
    }
  },

  onEditorDelete(e) {
    const d = e.detail;
    if (d.mode === 'cardio') actions.deleteCardio(d.uid, this.data.date);
    else actions.deleteStrength(d.uid, this.data.date);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  }
});
