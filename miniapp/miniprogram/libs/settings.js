// 设置层：记录类型与标签、训练偏好、Agent 记忆。与网页版同一套数据结构（settings.types / train.restUser / settings.mem）。
const store = require('./store/index');

const DEFAULT_TYPES = [
  { key: 'work', label: '工作', tags: ['加班', '代码', '会议', '汇报', '需求'] },
  { key: 'fit', label: '健身', tags: ['跑步', '力量', '瑜伽', '游泳'] },
  { key: 'life', label: '生活习惯', tags: ['作息', '早起', '饮食', '睡眠', '情绪'] }
];
const TYPE_COLORS = ['#6D8CFF', '#5FD3A0', '#3DDCBF', '#C77DB3', '#5AA9A6', '#E08A5B', '#8FBF6C', '#7E7BB5'];
const MOOD_LABELS = ['', '很糟', '低落', '一般', '不错', '很好'];

function ensure() {
  const s = store.getSettings() || {};
  if (!Array.isArray(s.types) || !s.types.length) {
    s.types = DEFAULT_TYPES.map(t => ({ key: t.key, label: t.label, tags: t.tags.slice() }));
  } else if (!s.types.every(t => Array.isArray(t.tags))) {
    s.types = s.types.map(t => ({ key: t.key, label: t.label, tags: (t.tags || []).slice() }));
  }
  return s;
}

function save(s) { store.setSettings(s); return s; }

function types() { return ensure().types; }

function typeLabel(k) {
  const t = types().find(x => x.key === k);
  return t ? t.label : (k || '记录');
}

function colorFor(k) {
  const i = types().findIndex(t => t.key === k);
  return i >= 0 ? TYPE_COLORS[i % TYPE_COLORS.length] : '#8695A5';
}

function tagsOf(k) {
  const t = types().find(x => x.key === k);
  return t ? (t.tags || []) : [];
}

function addType(label) {
  const v = String(label || '').trim();
  if (!v) return null;
  const s = ensure();
  if (s.types.some(t => t.label === v)) return null;
  const rec = { key: 'k' + Date.now().toString(36), label: v, tags: [] };
  s.types.push(rec);
  save(s);
  return rec;
}

function delType(key) {
  const s = ensure();
  s.types = s.types.filter(t => t.key !== key);
  save(s);
}

function addTag(key, tag) {
  const v = String(tag || '').trim();
  if (!v) return false;
  const s = ensure();
  const t = s.types.find(x => x.key === key);
  if (!t) return false;
  if (!t.tags) t.tags = [];
  if (t.tags.indexOf(v) >= 0) return false;
  t.tags.push(v);
  save(s);
  return true;
}

function delTag(key, tag) {
  const s = ensure();
  const t = s.types.find(x => x.key === key);
  if (!t) return;
  t.tags = (t.tags || []).filter(x => x !== tag);
  save(s);
}

/* ---------- 训练偏好 ---------- */
function trainCfg() {
  const train = store.getTrain() || {};
  return {
    rest: Number(train.restUser || 0),
    autoNext: !!train.autoNext,
    step: Number(train.wStep || 2.5),
    groupTimer: !!train.groupTimer
  };
}

function setTrainCfg(patch) {
  const train = store.getTrain() || {};
  if (patch.rest != null) train.restUser = Math.max(0, Math.min(300, Number(patch.rest) || 0));
  if (patch.autoNext != null) train.autoNext = !!patch.autoNext;
  if (patch.step != null) train.wStep = Math.max(0.5, Math.min(10, Number(patch.step) || 2.5));
  if (patch.groupTimer != null) train.groupTimer = !!patch.groupTimer;
  store.setTrain(train);
  store.markDirty('snap', 'trainmeta');
}

// 动作推荐休息秒数：用户设定优先，否则按动作类型给默认
function restFor(part, name) {
  const cfg = trainCfg();
  if (cfg.rest > 0) return cfg.rest;
  if (part === '有氧') return 0;
  if (/硬拉|深蹲|推举|卧推/.test(name || '')) return 150;
  if (/弯举|飞鸟|夹胸|侧平举|提踵|卷腹/.test(name || '')) return 60;
  return 90;
}

/* ---------- Agent 记忆 ---------- */
function mem() {
  const s = store.getSettings() || {};
  const m = s.mem;
  if (Array.isArray(m)) return m;
  return [];
}

function setMem(list) {
  const s = store.getSettings() || {};
  s.mem = Array.isArray(list) ? list.slice(0, 12) : [];
  store.setSettings(s);
  return s.mem;
}

function addMem(items) {
  const cur = mem();
  const add = (items || []).filter(x => x && String(x).trim());
  const merged = cur.concat(add).slice(-12);
  return setMem(Array.from(new Set(merged)));
}

function moodNorm(m) {
  const v = parseInt(m, 10);
  if (!v) return 0;
  return v > 5 ? Math.min(5, Math.ceil(v / 2)) : v;
}

function moodText(m) {
  const v = moodNorm(m);
  return v ? MOOD_LABELS[v] : '';
}

module.exports = {
  DEFAULT_TYPES, TYPE_COLORS, MOOD_LABELS,
  ensure, types, typeLabel, colorFor, tagsOf,
  addType, delType, addTag, delTag,
  trainCfg, setTrainCfg, restFor,
  mem, setMem, addMem,
  moodNorm, moodText
};
