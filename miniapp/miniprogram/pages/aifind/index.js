const data = require('../../libs/data/index');
const cloudurl = require('../../libs/cloudurl');
const CLIP_INDEX = require('../../libs/clip-index.js');
const ai = require('../../libs/ai');

const AI_CACHE = 'selfagent_aifind_v1';
const AI_CACHE_MS = 60 * 60 * 1000;

const PART_WORDS = [
  ['胸', ['胸', '卧推', '飞鸟', '夹胸']],
  ['背', ['背', '划船', '下拉', '引体']],
  ['肩', ['肩', '推举', '侧平举', '飞鸟后束']],
  ['上臂', ['手臂', '二头', '三头', '弯举']],
  ['腰腹', ['腹', '核心', '卷腹', '平板']],
  ['上腿', ['腿', '臀', '深蹲', '硬拉', '腿举']],
  ['小腿', ['小腿', '提踵']],
  ['全身', ['全身', '壶铃摆', '波比']],
  ['有氧', ['有氧', '跑步', '单车', '椭圆', '跳绳']]
];

const EQUIP_WORDS = [
  ['哑铃', ['哑铃', '壶铃', '棒铃']],
  ['杠铃', ['杠铃', '杠']],
  ['器械', ['器械', '固定', '史密斯', '龙门']],
  ['绳索', ['绳索', '龙门', '滑轮']],
  ['自重', ['自重', '徒手', '在家', '无器械', 'bodyweight']],
  ['小器械', ['弹力带', '瑜伽球', '药球', '健腹轮', '滚轴']]
];

function parse(q) {
  const s = String(q || '').toLowerCase();
  let part = '';
  let equip = '';
  const hits = [];
  PART_WORDS.forEach(([p, ws]) => {
    if (ws.some(w => s.indexOf(w) >= 0)) { part = part || p; hits.push(p); }
  });
  EQUIP_WORDS.forEach(([e, ws]) => {
    if (ws.some(w => s.indexOf(w) >= 0)) { equip = equip || e; hits.push(e); }
  });
  return { part, equip, hits };
}

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
    aiErr: ''
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
    const q = this.data.q;
    if (!q.trim()) { wx.showToast({ title: '说一句想练什么', icon: 'none' }); return; }
    const p = parse(q);
    const label = [p.part, p.equip].filter(Boolean).join(' · ') || '按名称匹配';
    let list = data.search('', p.part || '', p.equip || '', 200);
    if (!list.length) list = data.search(q, '', '', 200);
    const kw = q.replace(/练|想|今天|帮我|推荐|动作|一下|的/g, '').trim();
    if (kw && list.length > 12) {
      const strict = list.filter(x => kw.split(/[\s,，]+/).some(w => w && x.n.indexOf(w) >= 0));
      if (strict.length) list = strict.concat(list.filter(x => strict.indexOf(x) < 0));
    }
    // 本地兜底排序：名称命中越多越靠前，避免没 AI 时顺序随机
    const ws = kw.split(/[\s,，]+/).filter(Boolean);
    const score = x => {
      let s = 0;
      ws.forEach(w => { if (w && x.n.indexOf(w) >= 0) s += 3; });
      if (p.part && x.p === p.part) s += 2;
      if (p.equip && x.e === p.equip) s += 1;
      return s;
    };
    list = list.slice().sort((a, b) => score(b) - score(a));
    const head = list.slice(0, 12);
    this.setData({
      parsed: label,
      list: head.map(x => ({ id: x.id, n: x.n, p: x.p, e: x.e, t: x.t, why: '' })),
      shows: Math.min(12, list.length),
      detail: null,
      aiIntent: '',
      aiNote: '',
      aiErr: ''
    });
    this.fillThumbs(head.map(x => x.id));
    this.aiRank(q.trim(), p, list);
  },

  wait(ms) { return new Promise(r => setTimeout(r, ms)); },

  // 训练意图 → AI 排序与理由；失败保持本地规则结果
  aiRank(q, p, pool) {
    if (!pool.length) return;
    const cached = this.readAiCache(q);
    if (cached) { this.applyAi(cached); return; }
    const cands = pool.slice(0, 20).map(x => x.id + '|' + x.n + '|' + x.p + '|' + (x.e || '自重')).join('\n');
    const sys = [
      '你是健身教练。先判断用户这句话的训练意图（部位 / 器械 / 目标 / 限制条件），再只从给定候选动作中挑最合适的 8 个。',
      '只输出 JSON，不要 markdown、不要解释，格式：',
      '{"intent":"≤16字的意图判断","picks":[{"id":"动作id","why":"≤10字推荐理由"}]}',
      '硬规则：id 必须来自候选列表；picks 取 6–8 个，每一个都必须带 why；why 必须说明匹配点（部位、器械、难度或动作模式），不许写空话；候选不匹配时宁可少给。'
    ].join('\n');    const usr = '用户输入：' + q +
      '\n本地规则初判：' + ([p.part, p.equip].filter(Boolean).join(' · ') || '无') +
      '\n候选动作（id|名称|部位|器械）：\n' + cands;
    this.setData({ aiBusy: true });
    const tryOnce = (n) => ai.ask({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      temperature: 0.2,
      max_tokens: 420
    }).then(r => {
      if (!r || !r.ok || !r.text) {
        if (n > 1) return this.wait(4000).then(() => tryOnce(n - 1));
        this.setData({ aiBusy: false, aiErr: String((r && r.error) || 'empty').slice(0, 80), aiNote: 'AI 暂不可用，已按本地规则排' });
        return null;
      }
      const parsed = this.parseAiJson(r.text);
      if (!parsed || !(parsed.picks || []).length) {
        if (n > 1) return this.wait(1200).then(() => tryOnce(n - 1));
        this.setData({ aiBusy: false, aiErr: 'fmt: ' + String(r.text || '').slice(0, 120), aiNote: 'AI 返回格式异常，已按本地规则排' });
        return null;
      }
      const res = {
        intent: String(parsed.intent || '').slice(0, 20),
        picks: (parsed.picks || []).filter(x => x && x.id && x.why).slice(0, 8)
          .map(x => ({ id: String(x.id), why: String(x.why).slice(0, 16) }))
      };
      if (!res.picks.length) {
        if (n > 1) return this.wait(1200).then(() => tryOnce(n - 1));
        this.setData({ aiBusy: false, aiErr: 'nowhy: ' + String(r.text || '').slice(0, 120), aiNote: 'AI 未给出推荐理由，已按本地规则排' });
        return null;
      }
      this.writeAiCache(q, res);
      this.setData({ aiBusy: false });
      this.applyAi(res);
      return res;
    }).catch(e => {
      if (n > 1) return this.wait(4000).then(() => tryOnce(n - 1));
      this.setData({ aiBusy: false, aiErr: 'catch: ' + String((e && e.message) || e).slice(0, 100), aiNote: 'AI 请求失败，已按本地规则排' });
      return null;
    });
    tryOnce(3);
  },

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
    if (!res || !res.picks || !res.picks.length) return;
    try {
      const m = wx.getStorageSync(AI_CACHE) || {};
      m[q] = { t: Date.now(), res };
      const keys = Object.keys(m).sort((x, y) => (m[y].t || 0) - (m[x].t || 0)).slice(0, 30);
      const next = {};
      keys.forEach(k => { next[k] = m[k]; });
      wx.setStorageSync(AI_CACHE, next);
    } catch (e) {}
  },

  // 把 AI 选中的动作提到前面，并带上理由
  applyAi(res) {
    const cur = this.data.list || [];
    const byId = {};
    cur.forEach(x => { byId[x.id] = x; });
    const why = {};
    const ordered = [];
    (res.picks || []).forEach(pk => {
      const it = byId[pk.id];
      if (!it || ordered.indexOf(it) >= 0) return;
      why[pk.id] = pk.why || '';
      ordered.push(Object.assign({}, it, { why: pk.why || '' }));
    });
    cur.forEach(it => { if (ordered.every(o => o.id !== it.id)) ordered.push(it); });
    this.setData({
      list: ordered,
      shows: ordered.length,
      aiIntent: res.intent || '',
      aiNote: res.picks && res.picks.length ? 'AI 依据动作详情与训练部位选出 ' + res.picks.length + ' 个' : ''
    });
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
