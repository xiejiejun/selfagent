const food = require('../../libs/food');
const actions = require('../../libs/actions');
const store = require('../../libs/store/index');
const ai = require('../../libs/ai');
const engine = require('../../libs/engine/index');

const CACHE_KEY = 'selfagent_meal_cache_v1';

function extractJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

function readCache() {
  try { const v = wx.getStorageSync(CACHE_KEY); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function writeCache(map) {
  try {
    const keys = Object.keys(map);
    if (keys.length > 20) keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0)).slice(0, keys.length - 20).forEach(k => { delete map[k]; });
    wx.setStorageSync(CACHE_KEY, map);
  } catch (e) {}
}

function nowMeal() {
  const h = new Date().getHours();
  if (h < 10) return '早餐';
  if (h < 15) return '午餐';
  if (h < 21) return '晚餐';
  return '加餐';
}

Page({
  data: {
    date: '',
    img: '',
    busy: false,
    hint: '',
    err: '',
    tip: '',
    saved: false,
    mode: 'photo',          // photo | text
    channel: '',
    meals: ['早餐', '午餐', '晚餐', '加餐'],
    meal: '午餐',
    items: [],
    totalKcal: 0,
    conf: '',
    lowConf: false,
    editIdx: -1,
    addOpen: false,
    addText: '',
    textInput: '',
    textBusy: false,
    keep: false
  },

  onLoad(q) {
    const date = (q && q.date) || engine.dayKey();
    const st = store.getSettings() || {};
    const c = ai.cfg();
    this.setData({
      date,
      meal: nowMeal(),
      keep: !!st.mealKeep,
      channel: ai.usingCustom()
        ? ('直连 ' + String(c.baseUrl || '').replace(/^https?:\/\//, ''))
        : '云端 aiProxy'
    });
  },

  shoot() { this.choose('camera'); },
  album() { this.choose('album'); },

  choose(source) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ img: f.tempFilePath, err: '', tip: '', saved: false, items: [], lowConf: false, editIdx: -1, mode: 'photo' });
        this.recognize(f.tempFilePath);
      }
    });
  },

  recognize(path) {
    this.setData({ busy: true, hint: '压缩图片…' });
    wx.compressImage({
      src: path,
      quality: 55,
      success: (c) => { this.shotPath = c.tempFilePath || path; this.toBase64(this.shotPath); },
      fail: () => { this.shotPath = path; this.toBase64(path); }
    });
  },

  toBase64(path) {
    this.setData({ hint: '读取图片…' });
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (r) => {
        this.md5Of(path, (hash) => {
          const cache = readCache();
          if (hash && cache[hash] && cache[hash].json && Date.now() - (cache[hash].at || 0) < 7 * 864e5) {
            this.apply(JSON.parse(JSON.stringify(cache[hash].json)), true);
            return;
          }
          this.setData({ hint: 'AI 看图中…' });
          this.callAI('data:image/jpeg;base64,' + r.data, hash);
        });
      },
      fail: (e) => this.fail('图片读取失败：' + (e.errMsg || ''))
    });
  },

  // 同图 hash 缓存：同一张照片不重复分析
  md5Of(path, cb) {
    const done = r => cb((r && r.digest) || '');
    try {
      const fs = wx.getFileSystemManager();
      if (fs && typeof fs.getFileInfo === 'function') {
        fs.getFileInfo({ filePath: path, digestAlgorithm: 'md5', success: done, fail: () => cb('') });
        return;
      }
      if (typeof wx.getFileInfo === 'function') {
        wx.getFileInfo({ filePath: path, digestAlgorithm: 'md5', success: done, fail: () => cb('') });
        return;
      }
      cb('');
    } catch (e) { cb(''); }
  },

  callAI(url, hash) {
    ai.ask({ messages: food.visionMessages(url, food.habitHint()), max_tokens: 900, temperature: 0.1 })
      .then(res => {
        if (!res.ok) { this.fail(res.error || 'AI 调用失败'); return; }
        const j = extractJson(res.text || '');
        if (!j) { this.fail('AI 返回格式异常，换个角度再拍，或用文字记'); return; }
        if (j.isFood === false) {
          this.setData({ busy: false, hint: '', err: '没认出食物，试试对准整盘拍', tip: '也可以直接打字：米饭一碗、鸡胸100g' });
          return;
        }
        if (hash) {
          const cache = readCache();
          cache[hash] = { at: Date.now(), json: j };
          writeCache(cache);
        }
        this.apply(j, false);
      })
      .catch(e => this.fail('AI 失败：' + ((e && e.errMsg) || e)));
  },

  apply(j, cached) {
    const items = (j.items || []).map((it, idx) => {
      const name = String((it && it.name) || '').slice(0, 16);
      if (!name) return null;
      const base = food.byName(name);
      const kcal = Math.max(0, Math.round(Number(it.kcal) || 0));
      return {
        k: 'f' + idx + '_' + name,
        name,
        portion: String((it && it.portion) || (base ? base[1] : '1 份')).slice(0, 12),
        kcal,
        baseKcal: kcal,
        factor: 1,
        confidence: it.confidence == null ? 1 : Math.max(0, Math.min(1, Number(it.confidence))),
        low: it.confidence != null && Number(it.confidence) < 0.6,
        chips: false
      };
    }).filter(Boolean).slice(0, 10);

    if (!items.length) {
      this.setData({ busy: false, hint: '', err: '没认出食物，试试对准整盘拍', tip: '也可以直接打字：米饭一碗、鸡胸100g' });
      return;
    }
    const conf = this.confOf(items);
    this.setData({
      busy: false,
      hint: '',
      err: '',
      tip: cached ? '同一张照片用过缓存，没重复请求' : '',
      items,
      lowConf: items.some(x => x.low),
      totalKcal: food.totalOf(items),
      conf: conf.text,
      meal: String(j.meal || '').slice(0, 6) || this.data.meal,
      editIdx: -1
    });
  },

  confOf(items) {
    const v = items.map(x => (x.confidence == null ? 1 : x.confidence));
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1;
    const n = avg >= 0.85 ? 3 : (avg >= 0.6 ? 2 : 1);
    return { avg, text: '●'.repeat(n) + '○'.repeat(3 - n) };
  },

  fail(msg) {
    let err = String(msg || '');
    let tip = '';
    if (/domain list|合法域名|url not in/i.test(err)) {
      err = '自定义 API 域名没加白名单，请求被拦截';
      tip = '把域名加进后台 request 合法域名；开发阶段可勾选「不校验合法域名」';
    } else if (/-504003|timed out after 3 seconds/i.test(err)) {
      err = '云端 aiProxy 3 秒超时';
      tip = '配好自定义 API，或把 aiProxy 超时改成 45 秒；也可以先用文字记';
    } else if (/401|403|invalid api key|unauthorized/i.test(err)) {
      err = 'API Key 被拒绝（401/403）';
      tip = '检查 Key 是否过期、模型名是否可用';
    }
    this.setData({ busy: false, hint: '', err, tip, items: [], totalKcal: 0, lowConf: false });
  },

  retry() { if (this.shotPath || this.data.img) this.recognize(this.shotPath || this.data.img); },

  toText() { this.setData({ mode: 'text', err: '', tip: '', items: [], totalKcal: 0 }); },

  pickMeal(e) {
    this.setData({ meal: e.currentTarget.dataset.m });
  },

  // 点条目 → 展开份量 chips
  toggleItem(e) {
    const i = Number(e.currentTarget.dataset.i);
    const items = this.data.items.map((x, k) => Object.assign({}, x, { chips: k === i ? !x.chips : false }));
    this.setData({ items, editIdx: items[i] && items[i].chips ? i : -1 });
  },

  hintEdit() {
    if (!this.data.items.length) return;
    this.setData({ editIdx: 0, items: this.data.items.map((x, k) => Object.assign({}, x, { chips: k === 0 })) });
  },

  setFactor(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = Number(e.currentTarget.dataset.f);
    const items = this.data.items.slice();
    const it = items[i];
    if (!it) return;
    const next = food.rescale(it, f);
    next.k = it.k;
    next.chips = true;
    next.low = it.low;
    items[i] = next;
    food.remember(next.name, next.portion);
    this.setData({ items, totalKcal: food.totalOf(items), editIdx: i });
  },

  delItem(e) {
    const i = Number(e.currentTarget.dataset.i);
    const items = this.data.items.filter((x, k) => k !== i).map(x => Object.assign({}, x, { chips: false }));
    this.setData({ items, totalKcal: food.totalOf(items), editIdx: -1, lowConf: items.some(x => x.low) });
  },

  toggleAdd() { this.setData({ addOpen: !this.data.addOpen, addText: '' }); },

  onAddInput(e) { this.setData({ addText: e.detail.value }); },

  addItem() {
    const t = String(this.data.addText || '').trim();
    if (!t) return;
    const parsed = food.parseText(t);
    if (!parsed.length) { wx.showToast({ title: '没看懂，写成「米饭一碗」试试', icon: 'none' }); return; }
    const add = parsed.map((x, i) => Object.assign({}, x, { k: 'a' + Date.now() + '_' + i, low: !!x.guess, chips: false }));
    const items = this.data.items.concat(add).slice(0, 12);
    this.setData({ items, totalKcal: food.totalOf(items), addOpen: false, addText: '', lowConf: items.some(x => x.low) });
  },

  onTextInput(e) { this.setData({ textInput: e.detail.value }); },

  // 文字兜底：本地食物库先算，零网络；认不出再加 AI 估
  estimateText() {
    const t = String(this.data.textInput || '').trim();
    if (!t) return;
    const parsed = food.parseText(t);
    if (!parsed.length) { wx.showToast({ title: '没看懂，写成「米饭一碗，鸡胸100g」', icon: 'none' }); return; }
    const items = parsed.map((x, i) => Object.assign({}, x, {
      k: 't' + Date.now() + '_' + i,
      low: !!x.guess,
      confText: x.guess ? '待确认' : '',
      chips: false
    }));
    this.setData({
      items,
      totalKcal: food.totalOf(items),
      lowConf: items.some(x => x.low),
      conf: this.confOf(items).text,
      err: '',
      tip: ''
    });
  },

  save() {
    const items = this.data.items;
    if (!items.length) { wx.showToast({ title: '先加一项食物', icon: 'none' }); return; }
    let image = '';
    if (this.data.keep && this.shotPath) image = this.copyKeep(this.shotPath);
    const avg = this.confOf(items).avg;
    actions.addMeal({
      date: this.data.date,
      meal: this.data.meal,
      items: items.map(x => ({ name: x.name, portion: x.portion, kcal: x.kcal, confidence: x.confidence })),
      confidence: Math.round(avg * 100) / 100,
      image,
      source: this.data.mode === 'text' ? 'text' : (image ? 'photo' : 'photo_once')
    });
    this.setData({ saved: true, items: [], totalKcal: 0, img: '', editIdx: -1 });
    wx.showToast({ title: '已记入今天', icon: 'success' });
  },

  copyKeep(path) {
    try {
      const fs = wx.getFileSystemManager();
      const dir = wx.env.USER_DATA_PATH + '/meals';
      try { fs.mkdirSync(dir, true); } catch (e) {}
      const ext = (String(path).match(/\.(\w+)$/) || [])[1] || 'jpg';
      const dest = dir + '/m' + Date.now() + '.' + ext;
      fs.copyFileSync(path, dest);
      return dest;
    } catch (e) { return ''; }
  },

  again() {
    this.setData({ saved: false, mode: 'photo', img: '', textInput: '', meal: nowMeal() });
  },

  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/log/index' }) }); }
});
