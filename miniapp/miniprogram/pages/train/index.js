const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const settings = require('../../libs/settings');
const recommend = require('../../libs/recommend');
const cloudurl = require('../../libs/cloudurl');
const data = require('../../libs/data/index');
const cardioLib = require('../../libs/cardio');
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
          ? (gs.length ? engine.groupLine(gs) : (it.sets || 0) + ' 组') + (it.dist ? ' · ' + it.dist + 'km' : '')
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
          txt: (g.weight > 0 ? g.weight + 'kg' : '自重') + ' × ' + g.reps,
          sec: engine.fmtSec(g.sec),
          rpe: g.rpe || 0,
          done: !!g.done,
          warmup: !!g.warmup,
          tag: g.tag || ''
        }))
      };
    }
    const gs = it.groups || [];
    const last = lastSetsOf(train, it.name, date);
    const top = last && last.top;
    const sug = top ? (top.weight > 0 ? top.weight + 'kg' : '自重') : '';
    return {
      uid: it.uid, isCardio: false, exId: it.exId,
      name: names[it.exId] || it.name,
      rawName: it.name,
      part: it.part,
      line: engine.groupLine(gs),
      doneN: gs.filter(g => g.done).length,
      totalN: gs.length || it.sets || 0,
      volume: it.volume || 0,
      open: !!openMap[it.uid],
      fav: favs.indexOf(it.exId) >= 0,
      sug,
      sugLine: top ? ('上次 ' + (top.weight > 0 ? top.weight + 'kg' : '自重') + ' × ' + (top.reps || 0) + ' 次 · ' + last.date.slice(5) + ' · 组间休 ' + settings.restFor(it.part, it.name) + '″') : '',
      img: '',
      groups: gs.map(g => ({
        no: g.warmup ? 'W' : g.no,
        txt: (g.weight > 0 ? g.weight + 'kg' : '自重') + ' × ' + g.reps,
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
        name: x.name, exId: x.exId, part: x.part, line: (x.weight > 0 ? x.weight + 'kg' : '自重') + ' × ' + x.reps + ' × ' + x.sets
      }))
    };
  }
  return { list, summary: engine.summaryText(items), empty: !list.length, rec };
}

Page({
  data: {
    date: '', dateLabel: '', isToday: true,
    today: '',                        // 计划分段恒用「今天」，datebar 只在今天/记录出现
    tab: 'today',                      // today | plan | log —— 三个分段全部页内切换
    list: [], summary: '—', empty: true,
    editorVisible: false, payload: null,
    streak: 0, weekDone: 0, kpis: [],
    grid: false,
    dragUid: '',
    rec: { part: '', items: [] },
    exSheetVisible: false,
    exSheetId: '',
    exSheetName: '',
    exSheetUid: '',
    rest: { show: false, left: 0, label: '' }
  },

  onLoad() {
    this.media = {};
    this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    this.setData({ date: engine.dayKey(), today: engine.dayKey() });
    this.refresh();
  },

  onShow() { this.refresh(); this.consumeLibPick(); },

  // 动作库学习态「加入今天」：无 pick 通道时经本机中转
  consumeLibPick() {
    let p = null;
    try { p = wx.getStorageSync('selfagent_lib_pick_v1'); } catch (e) { p = null; }
    if (!p || !p.id) return;
    try { wx.removeStorageSync('selfagent_lib_pick_v1'); } catch (e) {}
    if (this.data.tab !== 'today') this.setData({ tab: 'today' });
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
    this.setData({
      today: engine.dayKey(),
      dateLabel: engine.dateLabel(date),
      isToday: date === engine.dayKey(),
      list: this.withImg(v.list), summary: v.summary, empty: v.empty, rec: v.rec,
      streak, weekDone, favStrip,
      kpis: [
        { v: weekDone, l: '本周组数' },
        { v: streak, l: '连续天数' },
        { v: v.list.length, l: '当天动作' }
      ]
    });
    if (this.data.grid) this.fillGrid(v.list);
  },

  // 图卡缩略图：命中内存的直接贴，缺的走云函数取 fileID → 临时链接
  withImg(list) {
    if (!this.media) this.media = {};
    return list.map(x => {
      const u = this.media[String(x.exId || '')] || '';
      return u === x.img ? x : Object.assign({}, x, { img: u });
    });
  },

  fillGrid(list) {
    if (!wx.cloud || !wx.cloud.callFunction) return;
    const ids = (list || []).filter(x => x.exId && /^\d{4}$/.test(String(x.exId)) && !this.media[String(x.exId)])
      .map(x => String(x.exId));
    if (!ids.length) return;
    this.mapChunk(ids.slice(0, 20));
    const rest = ids.slice(20);
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
        if (!keys.length) { this.applyFallback(todo); return; }
        cloudurl.resolve(keys.map(k => map[k]), (urls) => {
          keys.forEach(k => { this.media[k] = urls[map[k]] || ''; });
          this.applyFallback(keys);
        });
      })
      .catch(() => this.applyFallback(todo));
  },

  // 映射里没有的：先用 jsDelivr 直连（图挂了由 binderror 再清成占位符）
  applyFallback(ids) {
    (ids || []).forEach(id => {
      if (this.media[id]) return;
      if (/^\d{4}$/.test(String(id))) this.media[id] = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
    });
    this.setData({ list: this.withImg(this.data.list) });
  },

  // 图卡图片加载失败：CDN 直连 → 云下载落本地 → 占位块（三层，绝不白板）
  gridImgErr(e) {
    const uid = e.currentTarget.dataset.uid;
    const idx = (this.data.list || []).findIndex(x => x.uid === uid);
    if (idx < 0) return;
    const it = this.data.list[idx];
    const id = String(it.exId || '');
    const cur = it.img || '';
    if (!/^\d{4}$/.test(id)) { this.patchImg(idx, ''); return; }
    const cdn = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
    if (cur.indexOf('cdn.jsdelivr.net') < 0) { this.patchImg(idx, cdn); return; }
    if (!this.dlTried) this.dlTried = {};
    if (this.dlTried[id]) { if (this.media) this.media[id] = ''; this.patchImg(idx, ''); return; }
    this.dlTried[id] = 1;
    if (!wx.cloud || !wx.cloud.downloadFile) { this.patchImg(idx, ''); return; }
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: [id] } })
      .then(r => {
        const fid = (((r && r.result) || {}).map || {})[id];
        if (!fid) { this.patchImg(idx, ''); return; }
        wx.cloud.downloadFile({ fileID: fid })
          .then(res => {
            const p = res && res.tempFilePath;
            if (p) { this.media[id] = p; this.patchImg(idx, p); } else { this.patchImg(idx, ''); }
          })
          .catch(() => this.patchImg(idx, ''));
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
    if (this.data.tab !== 'today' || this.data.grid) return;
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
          wx.showToast({ title: '下一组：' + (next.weight > 0 ? next.weight + 'kg' : '自重') + ' × ' + next.reps, icon: 'none' });
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
      itemList: ['查看动作详情', '编辑组次', isFav ? '取消收藏' : '收藏这个动作', '杠铃片构成', '默认休息秒数', '删除这个动作'],
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
        date: this.data.date, groups: engine.ensureGroups(r)
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
        groups: [{ no: 1, reps: 10, weight: 0, done: false }]
      }
    });
  },

  // ＋ 直达动作库：主路径一步进入（搜索框自动聚焦），低频方式收进库内顶部
  openAddSheet() { this.openLibrary(); },

  openLibrary(e) {
    let part = '';
    if (typeof e === 'string') part = e;
    else if (e && e.currentTarget && e.currentTarget.dataset) part = e.currentTarget.dataset.part || '';
    wx.navigateTo({
      url: '/pages/library/index' + (part ? '?part=' + encodeURIComponent(part) : ''),
      events: { pick: (ex) => this.addPick(ex) }
    });
  },

  // 只逛不加：学习态打开动作库，不挂 pick 回调
  browseLibrary() {
    wx.navigateTo({ url: '/pages/library/index?from=learn' });
  },

  focus(e) { this.openFocusByUid(e.currentTarget.dataset.uid); },

  addFav(e) {
    const d = e.currentTarget.dataset;
    if (!d || !d.id) return;
    this.addPick({ id: d.id, n: d.name || '', p: d.part || '' });
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

  // 三个分段：全部页内切换，不跳页、不清栈
  switchTab(e) {
    const t = e.currentTarget.dataset.t;
    if (!t || t === this.data.tab) return;
    openMap = {};
    this.setData({ tab: t });
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
