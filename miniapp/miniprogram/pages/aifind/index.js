const data = require('../../libs/data/index');
const find = require('../../libs/find');
const cloudurl = require('../../libs/cloudurl');
const CLIP_INDEX = require('../../libs/clip-index.js');
const ai = require('../../libs/ai');

const AI_CACHE = 'selfagent_aifind_v1';
const AI_CACHE_MS = 60 * 60 * 1000;

Page({
  data: {
    q: '',
    parsed: '',
    list: [],
    detail: null,
    shows: 0,
    cloudReady: false,
    aiBusy: false,
    aiIntent: '',
    aiNote: '',
    aiErr: '',
    clar: [],
    clarQ: '',
    miss: []
  },

  onLoad(q) {
    const app = getApp();
    this.media = {};
    this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
    if (q && q.q) {
      this.setData({ q: decodeURIComponent(q.q) });
      this.run();
    }
  },

  onInput(e) { this.setData({ q: e.detail.value }); },

  quick(e) {
    this.setData({ q: e.currentTarget.dataset.q });
    this.run();
  },

  run() {
    const q = this.data.q.trim();
    if (!q) { wx.showToast({ title: '说一句想练什么', icon: 'none' }); return; }
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({
      aiBusy: true, list: [], shows: 0, detail: null,
      aiIntent: '', aiErr: '', clar: [], clarQ: '', miss: [], parsed: '',
      aiNote: '正在理解你的训练意图…'
    });

    const cached = this.readAiCache(q);
    if (cached) {
      const slots = find.normalize(cached.understood);
      this.apply(slots, find.recall(slots, 90), cached.ai, seq);
      return;
    }

    this.understand(q).then(u => {
      if (seq !== this._seq) return null;
      const slots = u ? find.normalize(u) : find.guess(q);
      const cands = find.recall(slots, 90);
      this.paintLocal(slots, cands, seq);
      return this.rerank(q, slots, cands).then(res => {
        if (seq !== this._seq) return;
        if (!res || !(res.picks || []).length) {
          this.apply(slots, cands, res, seq);
          return;
        }
        this.writeAiCache(q, { understood: u || {}, ai: res });
        this.apply(slots, cands, res, seq);
      });
    }).catch(e => {
      if (seq !== this._seq) return;
      const slots = find.guess(q);
      const cands = find.recall(slots, 90);
      this.setData({ aiErr: String((e && e.message) || e).slice(0, 80) });
      this.apply(slots, cands, null, seq);
    });
  },

  wait(ms) { return new Promise(r => setTimeout(r, ms)); },

  // 第一步：AI 只解析（部位/器械/动作模式/伤病/缺失条件），不检索
  understand(q) {
    const tryOnce = (n) => ai.ask({
      messages: find.understandMessages(q),
      temperature: 0.1,
      max_tokens: 520
    }).then(r => {
      if (!r || !r.ok || !r.text) {
        if (n > 1) return this.wait(1500).then(() => tryOnce(n - 1));
        return null;
      }
      const j = this.parseAiJson(r.text);
      if (!j) {
        if (n > 1) return this.wait(1200).then(() => tryOnce(n - 1));
        return null;
      }
      return j;
    }).catch(() => (n > 1 ? this.wait(2500).then(() => tryOnce(n - 1)) : null));
    return tryOnce(2);
  },

  // 第二/三步：用召回候选做重排，允许「库里没有」和反问
  rerank(q, slots, cands) {
    if (!cands.length) return Promise.resolve(null);
    const tryOnce = (n) => ai.ask({
      messages: find.rerankMessages(q, slots, cands),
      temperature: 0.15,
      max_tokens: 900
    }).then(r => {
      if (!r || !r.ok || !r.text) {
        if (n > 1) return this.wait(1500).then(() => tryOnce(n - 1));
        return null;
      }
      const j = this.parseAiJson(r.text);
      if (!j) {
        if (n > 1) return this.wait(1200).then(() => tryOnce(n - 1));
        return null;
      }
      return this.normRerank(j, cands);
    }).catch(() => (n > 1 ? this.wait(2500).then(() => tryOnce(n - 1)) : null));
    return tryOnce(2);
  },

  normRerank(j, cands) {
    const ids = {};
    cands.forEach(x => { ids[x.id] = 1; });
    const picks = (j.picks || [])
      .map(x => x && { id: find.fixId(x.id, ids), why: String(x.why || '').slice(0, 14) })
      .filter(x => x && x.id)
      .slice(0, 10);
    const notFound = (j.notFound || j.missing || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
    const cl = j.clarify;
    const clarify = cl && Array.isArray(cl.options) && cl.options.length
      ? { q: String(cl.q || '').slice(0, 16), options: cl.options.map(x => String(x).trim()).filter(Boolean).slice(0, 4) }
      : null;
    return { intent: String(j.intent || '').slice(0, 24), picks, notFound, clarify };
  },

  paintLocal(slots, cands, seq) {
    if (seq !== this._seq) return;
    const head = cands.slice(0, 12);
    const pack = head.map(x => ({ id: x.id, n: x.n, p: x.p, e: x.e, t: x.t, why: '' }));
    this.setData({
      parsed: find.slotLabel(slots) || '按名称匹配',
      list: pack, shows: pack.length,
      clar: slots.clarify && slots.clarify.options ? slots.clarify.options.map(String).slice(0, 4) : [],
      clarQ: (slots.clarify && slots.clarify.q) || '',
      aiNote: '检索到 ' + cands.length + ' 个候选，AI 正在重排…'
    });
    this.fillThumbs(head.map(x => x.id));
  },

  apply(slots, cands, res, seq) {
    if (seq !== this._seq) return;
    const byId = {};
    cands.forEach(x => { byId[x.id] = x; });
    const picks = (res && res.picks) || [];
    const ordered = [];
    const seen = {};
    picks.forEach(pk => {
      const it = byId[pk.id];
      if (!it || seen[pk.id]) return;
      seen[pk.id] = 1;
      ordered.push(Object.assign({}, it, { why: pk.why || '' }));
    });
    const head = cands.slice(0, 12);
    head.forEach(it => { if (!seen[it.id] && ordered.length < 12) { seen[it.id] = 1; ordered.push(Object.assign({}, it, { why: '' })); } });

    const clarify = (res && res.clarify) || null;
    const clar = clarify && clarify.options && clarify.options.length
      ? clarify.options
      : (slots.clarify && slots.clarify.options ? slots.clarify.options.map(String).slice(0, 4) : []);
    const clarQ = (clarify && clarify.q) || (slots.clarify && slots.clarify.q) || '再补一个条件，结果更准';
    const miss = (res && res.notFound) || [];

    let note = '';
    if (picks.length) note = 'AI 从 ' + cands.length + ' 个候选里选出 ' + picks.length + ' 个';
    else if (res) note = 'AI 没有找到完全匹配的，下面是按条件和部位排出的候选';
    else note = 'AI 暂不可用，已用本地检索排出 ' + cands.length + ' 个候选';

    this.setData({
      parsed: find.slotLabel(slots) || '按名称匹配',
      list: ordered, shows: ordered.length,
      aiIntent: (res && res.intent) || slots.intent || '',
      aiBusy: false,
      aiNote: note,
      // 已经选出足够多时才反问会打断用户，只在「没太读懂 / 候选不足」时给选项
      clar: clar.length >= 2 && (!res || picks.length < 4) ? clar : [],
      clarQ,
      miss
    });
    this.fillThumbs(ordered.map(x => x.id));
  },

  clarTap(e) {
    const o = e.currentTarget.dataset.o;
    if (!o) return;
    this.setData({ q: (this.data.q + ' ' + o).trim(), clar: [] });
    this.run();
  },

  toLib() { wx.navigateTo({ url: '/pages/library/index' }); },

  parseAiJson(text) {
    let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  },

  readAiCache(q) {
    try {
      const m = wx.getStorageSync(AI_CACHE) || {};
      const it = m[q];
      if (it && Date.now() - (it.t || 0) < AI_CACHE_MS && it.res) return it.res;
    } catch (e) {}
    return null;
  },

  writeAiCache(q, res) {
    if (!res || !res.ai) return;
    try {
      const m = wx.getStorageSync(AI_CACHE) || {};
      m[q] = { t: Date.now(), res };
      const keys = Object.keys(m).sort((x, y) => (m[y].t || 0) - (m[x].t || 0)).slice(0, 30);
      const next = {};
      keys.forEach(k => { next[k] = m[k]; });
      wx.setStorageSync(AI_CACHE, next);
    } catch (e) {}
  },

  // 缩略图：先查云存储映射，再换临时 https（渲染层不认 cloud://），没有就占位
  fillThumbs(ids) {
    if (!ids.length || !this.data.cloudReady || !wx.cloud) return;
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids } })
      .then(r => {
        const map = ((r && r.result) || {}).map || {};
        const keys = Object.keys(map);
        if (!keys.length) return;
        cloudurl.resolve(keys.map(k => map[k]), (urls) => {
          keys.forEach(k => { this.media[k] = urls[map[k]] || ''; });
          this.setData({ list: this.data.list.map(c => Object.assign({}, c, { fileID: this.media[c.id] || '' })) });
        });
      })
      .catch(() => {});
  },

  open(e) {
    const id = e.currentTarget.dataset.id;
    const ex = data.byId(id);
    if (!ex) return;
    let cid = '';
    try { cid = (this.clip.url ? this.clip.url(ex.id) : '') || ''; } catch (err) { cid = ''; }
    this.setData({
      detail: {
        id: ex.id, n: ex.n, p: ex.p, e: ex.e, t: ex.t,
        fileID: this.media[ex.id] || '',
        clipID: cid,
        steps: (ex.s || '').split('\n').filter(x => x.trim()).slice(0, 8)
      }
    });
    this.clipTempTried = false;
    const fid = this.data.detail && this.data.detail.fileID;
    if (fid && String(fid).indexOf('cloud://') === 0 && wx.cloud) {
      cloudurl.resolve([fid], (urls) => {
        const u = urls[fid];
        const cur = this.data.detail;
        if (u && cur && cur.id === ex.id) this.setData({ detail: Object.assign({}, cur, { fileID: u }) });
      });
    }
    try { this.ensureClip(ex.id); } catch (e) { console.warn('[aifind] ensureClip', e && e.message); }
  },

  // 静止播放：索引命中直接流式播（CDN），不落本地；未命中后台补产一次
  ensureClip(id) {
    if (!id || typeof this.clip.has !== 'function' || this.clip.has(id)) return;
    if (!wx.cloud || !this.data.cloudReady) return;
    if (!this.clipPending) this.clipPending = {};
    if (this.clipPending[id]) return;
    this.clipPending[id] = 1;
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'batchgen', clip: true, ids: [String(id)], budget: 12000 } })
      .then(r => {
        const map = ((r && r.result) || {}).map || {};
        if (!map[id]) return;
        this.clip.ids[String(id).padStart(4, '0')] = 1;
        const d = this.data.detail;
        if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { clipID: this.clip.url(id) }) });
      })
      .catch(() => {})
      .then(() => { delete this.clipPending[id]; });
  },

  onClipErr() {
    const d = this.data.detail;
    if (!d) return;
    if (String(d.clipID).indexOf('cloud://') === 0 && wx.cloud && !this.clipTempTried) {
      this.clipTempTried = true;
      cloudurl.resolve([d.clipID], (urls) => {
        const u = urls[d.clipID];
        const cur = this.data.detail;
        if (u && cur && cur.id === d.id) this.setData({ detail: Object.assign({}, cur, { clipID: u }) });
        else this.setData({ detail: Object.assign({}, cur, { clipID: '' }) });
      });
      return;
    }
    this.clipTempTried = false;
    this.setData({ detail: Object.assign({}, d, { clipID: '' }) });
  },

  close() {
    try {
      const ctx = wx.createVideoContext('dvideo', this);
      if (ctx) ctx.stop();
    } catch (e) {}
    this.setData({ detail: null });
  },

  pick() {
    const d = this.data.detail;
    if (!d) return;
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) {
      ch.emit('pick', { id: d.id, n: d.n, p: d.p, e: d.e, t: d.t });
      wx.navigateBack();
    } else {
      wx.navigateTo({ url: '/pages/library/index' });
    }
  },

  noop() {}
});
