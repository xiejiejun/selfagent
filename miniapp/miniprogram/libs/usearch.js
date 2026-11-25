// 统一检索路由：一个输入框，三种输入 → 一个结果流
// keyword → data.search；自然语言 → AI 理解 + 重排；图片 → 视觉识别 + 本地召回
const data = require('./data/index');
const find = require('./find');
const ai = require('./ai');

const AI_CACHE = 'selfagent_unisearch_v1';
const AI_CACHE_MS = 60 * 60 * 1000;

// 出现这些词就说明用户不是在报动作名，而是在描述场景/条件
const INTENT_WORDS = [
  '只有', '没有', '在家', '家里', '健身房', '想练', '想减', '适合', '帮我', '推荐',
  '能不能', '可以', '怎么', '练哪', '增肌', '减脂', '新手', '伤', '腰疼', '膝', '时间',
  '分钟', '器械', '练背', '练胸', '练腿', '练肩', '练手臂', '腹部', '核心'
];

function route(q) {
  const s = String(q || '').trim();
  if (!s) return 'keyword';
  if (s.length >= 9) return 'ai';
  if (/[，,。？?！!、；;：:]/.test(s)) return 'ai';
  if (INTENT_WORDS.some(w => s.indexOf(w) >= 0)) return 'ai';
  return 'keyword';
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

function ask(messages, maxTokens) {
  const tryOnce = (n) => ai.ask({ messages, temperature: 0.12, max_tokens: maxTokens })
    .then(r => {
      if (!r || !r.ok || !r.text) {
        if (n > 1) return wait(1400).then(() => tryOnce(n - 1));
        return null;
      }
      const j = parseJson(r.text);
      if (!j) {
        if (n > 1) return wait(1100).then(() => tryOnce(n - 1));
        return null;
      }
      return j;
    })
    .catch(() => (n > 1 ? wait(2200).then(() => tryOnce(n - 1)) : null));
  return tryOnce(2);
}

function normRerank(j, cands) {
  const ids = {};
  cands.forEach(x => { ids[x.id] = 1; });
  const picks = ((j && j.picks) || [])
    .map(x => x && { id: find.fixId(x.id, ids), why: String(x.why || '').slice(0, 14) })
    .filter(x => x && x.id)
    .slice(0, 10);
  const notFound = ((j && (j.notFound || j.missing)) || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
  const cl = j && j.clarify;
  const clarify = cl && Array.isArray(cl.options) && cl.options.length
    ? { q: String(cl.q || '').slice(0, 16), options: cl.options.map(x => String(x).trim()).filter(Boolean).slice(0, 4) }
    : null;
  return { intent: String((j && j.intent) || '').slice(0, 24), picks, notFound, clarify };
}

// 把候选按「AI 选中的 → 其余按分数」拼成一条结果流
function pack(cands, res) {
  const byId = {};
  cands.forEach(x => { byId[x.id] = x; });
  const out = [];
  const seen = {};
  const picks = (res && res.picks) || [];
  picks.forEach(pk => {
    const it = byId[pk.id];
    if (!it || seen[pk.id]) return;
    seen[pk.id] = 1;
    out.push(Object.assign({}, it, { why: pk.why || '' }));
  });
  cands.slice(0, 12).forEach(it => {
    if (seen[it.id] || out.length >= 12) return;
    seen[it.id] = 1;
    out.push(Object.assign({}, it, { why: '' }));
  });
  return out;
}

function slotsToChips(slots) {
  const chips = [];
  if (slots.part) chips.push({ k: 'part', v: slots.part, t: slots.part });
  (slots.equips || []).slice(0, 2).forEach(e => chips.push({ k: 'equip', v: e, t: e }));
  (slots.patterns || []).slice(0, 1).forEach(p => chips.push({ k: 'pattern', v: p, t: p }));
  (slots.constraints || []).slice(0, 1).forEach(c => chips.push({ k: 'cons', v: c, t: c }));
  return chips;
}

function readCache(q) {
  try {
    const m = wx.getStorageSync(AI_CACHE) || {};
    const it = m[q];
    if (it && Date.now() - (it.t || 0) < AI_CACHE_MS) return it;
  } catch (e) {}
  return null;
}

function writeCache(q, payload) {
  if (!payload) return;
  try {
    const m = wx.getStorageSync(AI_CACHE) || {};
    m[q] = Object.assign({ t: Date.now() }, payload);
    const keys = Object.keys(m).sort((x, y) => (m[y].t || 0) - (m[x].t || 0)).slice(0, 30);
    const next = {};
    keys.forEach(k => { next[k] = m[k]; });
    wx.setStorageSync(AI_CACHE, next);
  } catch (e) {}
}

// 自然语言：理解 → 召回 → 重排，返回统一结果包
function aiSearch(q) {
  const key = String(q || '').trim();
  if (!key) return Promise.resolve(null);
  const cached = readCache(key);
  if (cached && cached.list) {
    const slots = find.normalize(cached.raw || {});
    return Promise.resolve({
      list: pack(cached.cands || cached.list, cached.res), cands: cached.cands || cached.list,
      slots, res: cached.res || {}, source: 'ai', fromCache: true
    });
  }

  return ask(find.understandMessages(key), 520).then(u => {
    const slots = u ? find.normalize(u) : find.guess(key);
    // 什么都没解析出来（乱码/无意义输入）：不要拿全库兜底，直接空态
    const meaningful = !!(slots.part || (slots.equips && slots.equips.length) ||
      (slots.names && slots.names.length) || (slots.keywords && slots.keywords.length) ||
      (slots.patterns && slots.patterns.length));
    if (!meaningful) {
      return { list: [], cands: [], slots, res: { picks: [], clarify: slots.clarify }, source: 'ai' };
    }
    const cands = find.recall(slots, 90);
    // 只有关键词、且全库一个字都对不上：判定为没找到，别拿全库前 12 个充数
    if (!slots.part && !(slots.equips || []).length && !(slots.names || []).length &&
        !(slots.patterns || []).length && (slots.keywords || []).length) {
      const kws = slots.keywords;
      const hit = data.all().filter(x => kws.some(w => String(x.n || '').indexOf(w) >= 0 ||
        String(x.t || '').indexOf(w) >= 0)).length;
      if (!hit) return { list: [], cands: [], slots, res: { picks: [], clarify: null }, source: 'ai' };
    }
    if (!cands.length) {
      return { list: [], cands, slots, res: { picks: [], clarify: slots.clarify }, source: 'ai' };
    }
    return ask(find.rerankMessages(key, slots, cands), 900).then(j => {
      const res = normRerank(j || null, cands);
      const list = pack(cands, res);
      writeCache(key, { raw: u || {}, cands: cands.slice(0, 30), res, list: list.slice(0, 20) });
      return { list, cands, slots, res, source: 'ai' };
    });
  }).catch(() => null);
}

// 用改过的条件本地重排（点 chip 改条件时用，不再打 AI）
function localBySlots(slots) {
  const cands = find.recall(slots, 90);
  return { list: pack(cands, null), cands, slots, res: {}, source: 'ai' };
}

// 一句话检索（澄清 chips 用）
function refineSlots(slots, kind, value) {
  const s = Object.assign({}, slots);
  if (kind === 'part') { s.part = value; s.parts = []; s.patterns = []; s.names = []; s.keywords = []; }
  if (kind === 'equip') {
    if (!value) { s.equips = []; s.eqSpec = new Set(); s.eqGroups = new Set(); }
    else {
      s.equips = [value];
      const g = find.EQUIP_ALIAS.find(x => x[0] === value);
      s.eqSpec = new Set(g ? g[2] : []);
      s.eqGroups = new Set(g ? [g[0]] : []);
    }
  }
  if (kind === 'pattern') { s.patterns = [value]; }
  if (kind === 'cons') { s.constraints = value ? [value] : []; }
  return s;
}

function compress(path) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: path,
      quality: 55,
      success: c => resolve(c.tempFilePath || path),
      fail: () => resolve(path)
    });
  });
}

function toBase64(path) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: r => resolve('data:image/jpeg;base64,' + r.data),
      fail: e => reject(e)
    });
  });
}

// 图片：识别画面 → 名称直配 + 条件召回，一次 AI 调用，结果落同一网格
function visionSearch(path) {
  return compress(path).then(p => toBase64(p)).then(url => {
    return ask(find.visionMessages(url), 700).then(j => {
      if (!j) return null;
      const scene = String(j.scene || '').slice(0, 18);
      const equips = (j.equipment || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
      const actions = (j.actions || []).slice(0, 5);
      const part = String(j.part || '');
      const parts = (j.parts || []).slice(0, 3);
      const keywords = (j.keywords || []).slice(0, 6);
      const slots = find.normalize({ part, parts, equips, keywords, names: actions });
      const byName = find.byNames(actions).list.filter(x => {
        if (slots.part && x.p !== slots.part && slots.parts.indexOf(x.p) < 0) return false;
        if (slots.eqSpec.size && !slots.eqSpec.has(x.e)) return false;
        return true;
      });
      const cands = find.recall(slots, 70).filter(x => !byName.some(y => y.id === x.id));
      const out = [];
      const seen = {};
      byName.forEach(x => { if (!seen[x.id]) { seen[x.id] = 1; out.push(Object.assign({}, x, { why: '画面直接对应' })); } });
      cands.slice(0, 12 - out.length).forEach(x => {
        if (seen[x.id]) return;
        seen[x.id] = 1;
        out.push(Object.assign({}, x, { why: '' }));
      });
      return {
        list: out, slots, source: 'vision',
        shot: [scene, equips.length ? equips.join(' / ') : ''].filter(Boolean).join(' · '),
        rawText: actions.length ? actions.join('、') : ''
      };
    });
  }).catch(() => null);
}

module.exports = { route, aiSearch, visionSearch, localBySlots, refineSlots, slotsToChips, INTENT_WORDS };
