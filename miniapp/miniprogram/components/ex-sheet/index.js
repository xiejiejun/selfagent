// 动作详情浮层：动图/封面 + 标签 + 动作要领 + 收藏 + 有氧计组方式。训练页与专注页共用。
const dataLib = require('../../libs/data/index');
const actions = require('../../libs/actions');
const store = require('../../libs/store/index');
const cloudurl = require('../../libs/cloudurl');
const cardioLib = require('../../libs/cardio');
const CLIP_INDEX = require('../../libs/clip-index.js');

const defaultCardioMode = cardioLib.defaultCardioMode;
const isCardioEx = cardioLib.isCardioEx;


Component({
  properties: {
    visible: { type: Boolean, value: false },
    exId: { type: String, value: '' },
    exName: { type: String, value: '' },
    uid: { type: String, value: '' },     // 今日已存在的有氧条目 uid；为空表示新加入
    date: { type: String, value: '' },
    theme: { type: String, value: 'light' } // light | dark（专注训练页用 dark）
  },

  data: { sheet: null, cx: null },

  lifetimes: {
    attached() {
      this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    },
    detached() { this.media = null; }
  },

  observers: {
    'visible, exId, exName, uid': function (visible, exId) {
      if (!visible) return;
      if (!exId) { this.setData({ sheet: null, cx: null }); return; }
      this.load(exId);
    }
  },

  methods: {
    load(rawId) {
      const id = String(rawId);
      let ex = dataLib.byId(id);
      // 老记录 id 可能来自旧版动作库：id 与名称对不上时，按名称回查，避免弹出错误的动作
      if (ex && this.data.exName && ex.n !== this.data.exName && id.indexOf('my') !== 0) {
        const byName = dataLib.matchByName(this.data.exName);
        if (byName && byName.id) { ex = byName; }
      }
      if (!ex) ex = (actions.customList() || []).find(x => x && x.id === id);
      if (!ex) { this.setData({ sheet: null }); return; }
      const realId = String(ex.id || id);
      const names = actions.exNameMap();
      const favs = (store.getTrain() || {}).favs || [];
      const steps = String(ex.s || '').split('\n').map(x => x.trim()).filter(Boolean);
      let clipID = '';
      try { clipID = (this.clip && this.clip.url) ? (this.clip.url(realId) || '') : ''; } catch (e) { clipID = ''; }
      this.setData({
        sheet: {
          id: realId,
          n: names[realId] || ex.n,
          p: ex.p,
          e: ex.e,
          t: ex.t,
          alias: !!names[realId],
          mine: realId.indexOf('my') === 0,
          steps,
          fileID: (this.media && this.media[realId]) || '',
          clipID,
          clipReady: !clipID || !!(this.media && this.media[realId]),
          fav: favs.indexOf(realId) >= 0,
          cardio: isCardioEx(ex) || String(ex.p || '') === '有氧'
        }
      });
      this.buildCx(ex, realId, names[realId] || ex.n);
      this.poster(realId);
    },

    // 有氧计组方式：已有记录读旧值，新动作按名称预选
    buildCx(ex, realId, nameArg) {
      if (!isCardioEx(ex)) { this.setData({ cx: null }); return; }
      const train = store.getTrain() || {};
      const rec = this.data.uid ? (train.cardio || []).find(x => x && x.uid === this.data.uid) : null;
      const name = nameArg || ex.n;
      const mode = rec ? (rec.mode === 'sets' ? 'sets' : 'timer') : defaultCardioMode(name);
      const min = rec && (rec.min || rec.dur) ? (rec.min || rec.dur) : 20;
      const gs = (rec && Array.isArray(rec.groups) && rec.groups.length) ? rec.groups : null;
      const sets = gs ? gs.length : 3;
      const reps = gs ? (gs[gs.length - 1].reps || 12) : 12;
      const weight = gs ? (gs[gs.length - 1].weight || 0) : 0;
      const dist = rec && rec.dist ? rec.dist : 0;
      this.setData({
        cx: {
          mode, min, sets, reps, weight, dist, exId: realId, name,
          hasRec: !!rec,
          hasTimer: !!(rec && (rec.min || rec.dur)),
          hasSets: !!gs,
          uid: (rec && rec.uid) || this.data.uid || ''
        }
      });
    },

    // 切换计组方式：两种表单的数据各自保留，不清场、不弹确认
    setCxMode(e) {
      const m = e.currentTarget.dataset.m;
      const cx = this.data.cx;
      if (!cx || cx.mode === m) return;
      const patch = { 'cx.mode': m };
      if (m === 'sets' && !cx.hasSets) {
        patch['cx.sets'] = cx.sets || 3;
        patch['cx.reps'] = cx.reps || 12;
      }
      if (m === 'timer' && !cx.hasTimer) {
        patch['cx.min'] = cx.min || 20;
      }
      this.setData(patch);
      wx.showToast({ title: cx.hasRec ? '已切换，原数据保留' : '已切换为' + (m === 'sets' ? '计组' : '计时'), icon: 'none' });
    },

    recOf(uid) {
      if (!uid) return null;
      return ((store.getTrain() || {}).cardio || []).find(x => x && x.uid === uid) || null;
    },

    cxStep(e) {
      const k = e.currentTarget.dataset.k;
      const d = Number(e.currentTarget.dataset.d);
      const cx = this.data.cx;
      if (!cx) return;
      const cur = Number(cx[k] || 0);
      let v = cur + d;
      if (k === 'min') v = Math.min(180, Math.max(1, v));
      if (k === 'sets') v = Math.min(20, Math.max(1, v));
      if (k === 'reps') v = Math.min(500, Math.max(1, v));
      if (k === 'weight') v = Math.min(200, Math.max(0, Math.round(v * 10) / 10));
      if (k === 'dist') v = Math.min(100, Math.max(0, Math.round(v * 100) / 100));
      this.setData({ ['cx.' + k]: v });
    },

    cxWeightInput(e) {
      const v = Math.max(0, Math.min(200, Number(e.detail.value) || 0));
      this.setData({ 'cx.weight': v });
    },

    cxDistInput(e) {
      const v = Math.max(0, Math.min(100, Math.round((Number(e.detail.value) || 0) * 100) / 100));
      this.setData({ 'cx.dist': v });
    },

    // 保存方式并加入今日：交给页面落库；另一形态的数据一并带上，切回去还在
    saveCx() {
      const cx = this.data.cx;
      if (!cx) return;
      const rec = this.recOf(cx.uid);
      const oldGs = (rec && Array.isArray(rec.groups)) ? rec.groups : [];
      let groups = oldGs;
      if (cx.mode === 'sets') {
        groups = [];
        for (let i = 0; i < cx.sets; i++) {
          const old = oldGs[i];
          groups.push({
            no: i + 1,
            reps: cx.reps,
            weight: cx.weight,
            done: old ? !!old.done : false,
            rpe: old ? (old.rpe || 0) : 0
          });
        }
      }
      this.triggerEvent('save', {
        uid: cx.uid || '',
        name: cx.name,
        exId: cx.exId,
        part: '有氧',
        mode: cx.mode,
        min: cx.min || 0,
        dur: cx.min || 0,
        dist: cx.dist || 0,
        groups,
        done: (rec && rec.mode === cx.mode) ? !!rec.done : false,
        isNew: !cx.hasRec
      });
    },

    // 封面：media_map 取 fileID → 临时链接（cloud:// 不能直接给 <image>）
    poster(id) {
      if (!wx.cloud || !wx.cloud.callFunction) return;
      wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: [id] } })
        .then(r => {
          const fid = (((r && r.result) || {}).map || {})[id];
          if (!fid) { this.cdn(id); return; }
          cloudurl.resolve([fid], (urls) => {
            const u = urls[fid];
            if (!u) { this.cdn(id); return; }
            if (!this.media) this.media = {};
            this.media[id] = u;
            const s = this.data.sheet;
            if (s && s.id === id) this.setData({ 'sheet.fileID': u });
          });
        })
        .catch(() => this.cdn(id));
    },

    cdn(id) {
      if (!/^\d{4}$/.test(String(id))) return;
      const u = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
      if (!this.media) this.media = {};
      this.media[id] = u;
      this.setData({ 'sheet.fileID': u });
    },

    imgErr() {
      const s = this.data.sheet;
      if (!s) return;
      const cur = s.fileID || '';
      if (cur.indexOf('cdn.jsdelivr.net') < 0) { this.cdn(s.id); return; }
      if (this.media) this.media[s.id] = '';
      this.setData({ 'sheet.fileID': '' });
    },

    clipErr() { this.setData({ 'sheet.clipID': '', 'sheet.clipReady': true }); },

    clipReady() { this.setData({ 'sheet.clipReady': true }); },

    star() {
      const s = this.data.sheet;
      if (!s) return;
      const on = actions.toggleFav(s.id);
      this.setData({ 'sheet.fav': on });
      wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
      this.triggerEvent('fav', { id: s.id, on });
    },

    close() { this.triggerEvent('close'); },

    noop() {}
  }
});
