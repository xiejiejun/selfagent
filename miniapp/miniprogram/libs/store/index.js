// 本地存储层。键名与网页版 index.html 完全一致，便于两端对拷/合并。
const KEYS = {
  logs: 'selfagent_logs_v1',
  train: 'selfagent_training_v1',
  profile: 'selfagent_profile_v1',
  settings: 'selfagent_settings_v1',
  theme: 'selfagent_theme_v1',
  page: 'selfagent_page_v1',
  tomb: 'selfagent_del_v1',
  repFp: 'selfagent_rep_fp',
  sync: 'selfagent_sync_v1',
  dirty: 'selfagent_dirty_v1'
};

function read(key, dft) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? dft : v;
  } catch (e) {
    return dft;
  }
}

// 静默写：不触发变更钩子（同步模块回填云端数据时用，避免自己把自己标脏）
function writeRaw(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

function write(key, val) {
  const ok = writeRaw(key, val);
  if (ok) emit(key);
  return ok;
}

/* ---------- 写入钩子：同步模块据此做增量上行 ---------- */
const hooks = [];

function onWrite(fn) { if (typeof fn === 'function') hooks.push(fn); }
function emit(key) { hooks.forEach(fn => { try { fn(key); } catch (e) {} }); }

/* ---------- 脏标记：只记「本机改过、还没推上去」的实体 ---------- */
// { train:[uid], logs:[id], snap:['settings'|'profile'|'trainmeta'], ts:{'snapKey':ts} }
function emptyDirty() { return { train: [], logs: [], snap: [], ts: {} }; }

function getDirty() {
  const d = read(KEYS.dirty, null);
  if (!d || typeof d !== 'object') return emptyDirty();
  return {
    train: Array.isArray(d.train) ? d.train : [],
    logs: Array.isArray(d.logs) ? d.logs : [],
    snap: Array.isArray(d.snap) ? d.snap : [],
    ts: d.ts && typeof d.ts === 'object' ? d.ts : {}
  };
}

function setDirty(d) { return writeRaw(KEYS.dirty, d); }

function markDirty(kind, key) {
  const d = getDirty();
  if (kind === 'train' || kind === 'logs') {
    const list = d[kind];
    const k = String(key || '');
    if (k && list.indexOf(k) < 0) list.push(k);
  } else if (kind === 'snap') {
    const k = String(key || '');
    if (k) {
      if (d.snap.indexOf(k) < 0) d.snap.push(k);
      d.ts[k] = Date.now();
    }
  }
  setDirty(d);
  emit(kind === 'snap' ? 'dirty:snap' : 'dirty:' + kind);
}

// 推送成功后清脏：只清这次真正发出去的那些键，期间新写入的保留
function clearDirty(sent) {
  const d = getDirty();
  const s = sent || {};
  const out = emptyDirty();
  out.train = d.train.filter(k => (s.train || []).indexOf(k) < 0);
  out.logs = d.logs.filter(k => (s.logs || []).indexOf(k) < 0);
  out.snap = d.snap.filter(k => (s.snap || []).indexOf(k) < 0);
  out.ts = {};
  d.snap.forEach(k => { if (out.snap.indexOf(k) >= 0 && d.ts[k]) out.ts[k] = d.ts[k]; });
  setDirty(out);
}

/* ---------- 取值 ---------- */
function uid(prefix) {
  return (prefix || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dayKey(d) {
  const dt = d ? new Date(d) : new Date();
  const p = n => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}

module.exports = {
  KEYS, read, write, writeRaw, uid, dayKey,
  onWrite, markDirty, getDirty, setDirty, clearDirty,

  getLogs() { return read(KEYS.logs, []); },
  setLogs(v) { return write(KEYS.logs, Array.isArray(v) ? v : []); },

  getTrain() { return read(KEYS.train, {}); },
  setTrain(v) { return write(KEYS.train, v || {}); },

  getTomb() { return read(KEYS.tomb, []); },
  setTomb(v) { return write(KEYS.tomb, Array.isArray(v) ? v : []); },

  getProfile() { return read(KEYS.profile, {}); },
  setProfile(v) { return write(KEYS.profile, v || {}); },

  getSettings() { return read(KEYS.settings, {}); },
  setSettings(v) { return write(KEYS.settings, v || {}); },

  getTheme() { return read(KEYS.theme, 'light'); },
  setTheme(v) { return write(KEYS.theme, v || ''); },

  getSyncState() { return read(KEYS.sync, {}); },
  setSyncState(v) { return write(KEYS.sync, v || {}); }
};
