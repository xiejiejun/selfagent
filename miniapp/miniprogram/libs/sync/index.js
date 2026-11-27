// 增量同步引擎：以微信身份（_openid）为唯一归属，云端只做传输，合并规则在本地。
// 水位 / 墓碑 / 逐实体 LWW：只推「本机改过的实体」，拉「水位之后的增量」，避免整库覆盖。
const store = require('../store/index');

const ALL = ['logs', 'train', 'profile', 'settings', 'trainmeta'];
const AUTO_MIN_GAP = 45000; // 前后台切换时两次自动同步的最小间隔
const DEBOUNCE = 1500;

let timer = null;
let busy = false;
let lastAuto = 0;
let mute = 0;

function cloudOk() {
  return !!(wx.cloud && wx.cloud.callFunction);
}

function call(name, data) {
  if (!cloudOk()) return Promise.reject(new Error('云开发未初始化'));
  const kb = Math.round((bytesOf(data || {}) / 1024));
  return wx.cloud.callFunction({ name, data }).then(r => (r && r.result) || {},
    e => {
      console.warn('[sync] call fail', name, kb + 'KB', String((e && e.errMsg) || e).slice(0, 120));
      throw e;
    });
}

function watermark() {
  const w = store.read(store.KEYS.sync, {}) || {};
  return typeof w === 'object' ? w : {};
}

function bump(kind, ts) {
  const w = watermark();
  w[kind] = Math.max(Number(w[kind]) || 0, Number(ts) || Date.now());
  w.last = Date.now();
  store.writeRaw(store.KEYS.sync, w);
}

function metaTs() {
  const w = watermark();
  return Number(w.metaTs) || 0;
}

function setMetaTs(ts) {
  const w = watermark();
  w.metaTs = Number(ts) || Date.now();
  store.writeRaw(store.KEYS.sync, w);
}

function autoOn() {
  const s = store.getSettings() || {};
  return s.syncAuto !== false;
}

function trainMeta(train) {
  const t = train || {};
  return {
    favs: t.favs || [],
    custom: t.custom || [],
    exnames: t.exnames || {},
    cfg: { restUser: t.restUser, autoNext: t.autoNext, wStep: t.wStep }
  };
}

function tombSet() {
  const arr = store.getTomb();
  const m = {};
  (Array.isArray(arr) ? arr : []).forEach(t => { if (t && t.u) m[t.k + ':' + t.u] = 1; });
  return m;
}

/* ---------- 上行 ---------- */
// wx.cloud.callFunction 入参上限约 100KB，且按 UTF-8 字节算（中文 1 字 ≈ 3 字节）：
// 实测 90KB 字节通、120KB 字节 Failed to fetch。中文笔记很容易在几十条时顶到上限，
// 所以既按字节也按条数切包（实测一包里塞 11 条长笔记就会卡死）。
const PACK = 45 * 1000;
const PACK_MAX = { logs: 5, records: 40, cardio: 40 };

// UTF-8 字节长度（中文/emoji 不能按 JS 字符数算，否则中文笔记一超就失败）
function bytesOf(o) {
  let s = '';
  try { s = JSON.stringify(o) || ''; } catch (e) { return 600; }
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // 代理对按 4 字节
    else n += 3;
  }
  return n;
}

function packItems(kind, arr, keyName, out, sentArr) {
  let cur = [], len = 0;
  const cap = PACK_MAX[kind] || 40;
  const flush = () => {
    if (!cur.length) return;
    const keys = cur.map(x => String(x[keyName]));
    out.push({ kind, items: cur, keys });
    keys.forEach(k => sentArr.push(k));
    cur = []; len = 0;
  };
  (arr || []).forEach(it => {
    if (!it || !it[keyName]) return;
    const n = bytesOf(it) + 2; // +1 分隔符 +1 括号
    if (cur.length && (cur.length >= cap || len + n > PACK)) flush();
    cur.push(it); len += n;
  });
  flush();
}

// 规划批次：full=true（手动整包推）发全部；否则只发脏实体
function plan(full) {
  const d = store.getDirty();
  const train = store.getTrain() || {};
  const out = [];
  const sent = { train: [], logs: [], snap: [] };

  const items = (store.getLogs() || []).filter(l => l && (full || d.logs.indexOf(String(l.id)) >= 0));
  packItems('logs', items, 'id', out, sent.logs);

  const recs = (train.records || []).filter(r => r && (full || d.train.indexOf(String(r.uid)) >= 0));
  const cards = (train.cardio || []).filter(r => r && (full || d.train.indexOf(String(r.uid)) >= 0));
  packItems('records', recs, 'uid', out, sent.train);
  packItems('cardio', cards, 'uid', out, sent.train);

  const snaps = full ? ['profile', 'settings', 'trainmeta'] : d.snap;
  snaps.forEach(k => {
    let v = null;
    if (k === 'settings') v = store.getSettings();
    else if (k === 'profile') v = store.getProfile();
    else if (k === 'trainmeta') v = trainMeta(train);
    if (v == null) return;
    out.push({ kind: 'snap', snap: k, val: v });
    if (sent.snap.indexOf(k) < 0) sent.snap.push(k);
  });
  return { out, sent };
}

function statesOfBatch(b) {
  const states = {};
  if (b.kind === 'logs') states.logs = b.items;
  else if (b.kind === 'records') states.train = { records: b.items, cardio: [] };
  else if (b.kind === 'cardio') states.train = { records: [], cardio: b.items };
  else if (b.kind === 'snap') {
    if (b.snap === 'trainmeta') {
      // 本地改过 meta 的时间点，服务端据此判断谁更新
      const d = store.getDirty();
      setMetaTs(d.ts.trainmeta || Date.now());
      states.trainmeta = b.val;
    } else states[b.snap] = b.val;
  }
  return states;
}

async function push(full) {
  if (!cloudOk()) return { ok: false, error: '云开发未初始化' };
  if (store.pruneDirty) store.pruneDirty();
  // 墓碑单独分批发：云端逐条 remove 是几十次 IO，混进数据包会把整包顶到函数 3s 超时
  const tr = await pushTomb();
  if (!tr.ok) return { ok: false, error: tr.error, stage: 'tomb', remaining: dirtyCount() };
  const { out } = plan(!!full);
  if (!out.length) return { ok: true, skipped: true, remaining: dirtyCount() };

  let serverTs = 0;
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    const res = await call('syncPush', {
      states: statesOfBatch(b),
      tomb: [], // 墓碑由 pushTomb 单独发，数据包保持轻
      metaTs: metaTs(),
      since: watermark()
    });
    if (!res || !res.ok) {
      return { ok: false, error: (res && res.error) || 'push failed', batch: i, total: out.length, serverTs };
    }
    serverTs = Math.max(serverTs, Number(res.serverTs) || 0);
    // 服务端回 written（真落库的键）时按它清脏，超时被截断的部分留着重推
    const one = { train: [], logs: [], snap: [] };
    const w = res.written;
    if (w && (Array.isArray(w.logs) || Array.isArray(w.train) || Array.isArray(w.snap))) {
      one.logs = w.logs || [];
      one.train = w.train || [];
      one.snap = w.snap || [];
    } else if (b.kind === 'records' || b.kind === 'cardio') one.train = b.keys;
    else if (b.kind === 'logs') one.logs = b.keys;
    else if (b.kind === 'snap') one.snap = [b.snap];
    store.clearDirty(one);
  }
  ALL.forEach(k => bump(k, serverTs || Date.now()));
  return { ok: true, serverTs, batches: out.length, remaining: dirtyCount() };
}

/* ---------- 墓碑（删掉的实体）单独上行 ---------- */
const TOMB_PACK = 20;

function tombKey(t) { return (t && t.k) + ':' + (t && t.u); }

function dropTomb(chunk) {
  const keys = chunk.map(tombKey);
  const rest = (store.getTomb() || []).filter(t => keys.indexOf(tombKey(t)) < 0);
  store.setTomb(rest);
}

async function sendTomb(chunk) {
  try {
    return await call('syncPush', { states: {}, tomb: chunk, metaTs: metaTs(), since: watermark() });
  } catch (e) {
    return { ok: false, error: String((e && e.errMsg) || (e && e.message) || e) };
  }
}

async function pushTomb() {
  let guard = 0;
  while (guard++ < 60) {
    const cur = (store.getTomb() || []).filter(t => t && t.u);
    if (!cur.length) return { ok: true, left: 0 };
    let chunk = cur.slice(0, TOMB_PACK);
    let res = await sendTomb(chunk);
    if (!res || !res.ok) {
      // 超时/失败：缩到 5 条再试一次，仍然失败就把墓碑留给下次
      chunk = cur.slice(0, 5);
      res = await sendTomb(chunk);
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'tomb failed' };
    }
    dropTomb(chunk);
  }
  return { ok: true, left: 1 };
}

// 待推行数：设置页「待推 N」与推送结果共用同一个口径
function dirtyCount() {
  const d = store.pruneDirty ? store.pruneDirty() : store.getDirty();
  return (d.train || []).length + (d.logs || []).length + (d.snap || []).length;
}

/* ---------- 下行 ---------- */
function newer(a, b) {
  const ta = Number(a && a.ts) || (a && a.time ? Date.parse(a.time) : 0) || 0;
  const tb = Number(b && b.ts) || (b && b.time ? Date.parse(b.time) : 0) || 0;
  return ta > tb;
}

function mergeByKey(local, remote, keyName, drop) {
  const map = new Map();
  (Array.isArray(local) ? local : []).forEach(x => { if (x && x[keyName] && !drop(x)) map.set(String(x[keyName]), x); });
  (Array.isArray(remote) ? remote : []).forEach(x => {
    if (!x || !x[keyName] || drop(x)) return;
    const k = String(x[keyName]);
    const l = map.get(k);
    if (!l || newer(x, l)) map.set(k, x);
  });
  return Array.from(map.values());
}

// 单次返回同样有大小限制，所以按类别分几次拉，每次只取一类增量
function pullGroups(kinds) {
  if (kinds) return [kinds];
  return [['logs'], ['train'], ['profile', 'settings'], ['trainmeta']];
}

function applyPull(res) {
  const saved = (res && res.data) || {};
  const tomb = tombSet();
  let changed = false;

  if (Array.isArray(saved.logs)) {
    const merged = mergeByKey(store.getLogs(), saved.logs, 'id', x => tomb['log:' + x.id]);
    store.writeRaw(store.KEYS.logs, merged);
    bump('logs', res.serverTs);
    changed = changed || saved.logs.length > 0;
  }

  if (saved.train && typeof saved.train === 'object') {
    const local = store.getTrain() || {};
    const records = mergeByKey(local.records, saved.train.records, 'uid', x => tomb['train:' + x.uid] || tomb['cardio:' + x.uid]);
    const cardio = mergeByKey(local.cardio, saved.train.cardio, 'uid', x => tomb['cardio:' + x.uid] || tomb['train:' + x.uid]);
    store.writeRaw(store.KEYS.train, Object.assign({}, local, { records, cardio }));
    bump('train', res.serverTs);
    changed = changed || (saved.train.records || []).length > 0 || (saved.train.cardio || []).length > 0;
  }

  ['profile', 'settings'].forEach(k => {
    if (saved[k] !== undefined && saved[k] !== null) {
      store.writeRaw(store.KEYS[k], saved[k]);
      bump(k, res.serverTs);
      changed = true;
    }
  });

  // 动作库侧的自定义数据（收藏 / 自定义动作 / 别名），按 updatedAt 比新旧
  if (saved.trainmeta && typeof saved.trainmeta === 'object') {
    if (Number(res.metaTs || res.serverTs) > metaTs()) {
      const local = store.getTrain() || {};
      const m = saved.trainmeta;
      const cfg = m.cfg || {};
      store.writeRaw(store.KEYS.train, Object.assign({}, local, {
        favs: Array.isArray(m.favs) ? m.favs : (local.favs || []),
        custom: Array.isArray(m.custom) ? m.custom : (local.custom || []),
        exnames: (m.exnames && typeof m.exnames === 'object') ? m.exnames : (local.exnames || {}),
        restUser: cfg.restUser == null ? local.restUser : cfg.restUser,
        autoNext: cfg.autoNext == null ? local.autoNext : !!cfg.autoNext,
        wStep: cfg.wStep == null ? local.wStep : cfg.wStep
      }));
      setMetaTs(res.metaTs || res.serverTs);
      bump('trainmeta', res.serverTs);
      changed = true;
    }
  }
  return changed;
}

async function pull(kinds) {
  let changed = false;
  let last = null;
  for (const g of pullGroups(kinds)) {
    const res = await call('syncPull', { kinds: g, since: watermark(), tomb: store.getTomb() });
    if (!res || !res.ok) return res;
    changed = applyPull(res) || changed;
    last = res;
  }
  if (changed) notify();
  return last || { ok: true };
}

/* ---------- 页面刷新：同步落地后让当前页重读数据 ---------- */
function notify() {
  setTimeout(() => {
    try {
      const pages = getCurrentPages() || [];
      pages.forEach(p => {
        if (p && typeof p.refresh === 'function') { try { p.refresh(); } catch (e) {} }
      });
    } catch (e) {}
  }, 0);
}

/* ---------- 自动同步 ---------- */
function schedule() {
  if (mute || !autoOn()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(); }, DEBOUNCE);
}

async function flush() {
  if (busy || !cloudOk() || mute || !autoOn()) return { ok: false };
  busy = true;
  try { return await push(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } finally { busy = false; }
}

// 登录/换设备/回前台：先拉后推，先合并云端新数据，再上传本机改过的实体
async function boot(force) {
  if (!cloudOk() || busy) return { ok: false };
  if (!force && (!autoOn() || Date.now() - lastAuto < AUTO_MIN_GAP)) return { ok: false, skipped: true };
  busy = true;
  mute++;
  const seeded = !!store.read(SEED_KEY, 0);
  try {
    // 第一次跑同步：本机已有的老数据先标脏，保证它们能上去（新设备则本机为空，直接拉）
    if (!seeded) seedLegacy();
    const r = await pull(ALL);
    const p = await push();
    if (!seeded && p && p.ok) store.writeRaw(SEED_KEY, 1);
    lastAuto = Date.now();
    bump('last', lastAuto);
    if (r && r.ok) notify();
    return { ok: !!(r && r.ok), pull: r, push: p };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    mute--;
    busy = false;
  }
}

// 首次启动：本机已有数据也要先合并云端，避免新设备空白
function bootOnce() { return boot(true); }

// 手动「上传本机」「拉取合并」：整份状态推/拉
async function pushAll() { return push(true); }

function status() {
  const w = watermark();
  return { last: Number(w.last) || 0, metaTs: metaTs(), auto: autoOn(), cloud: cloudOk(), dirty: (store.pruneDirty ? store.pruneDirty() : store.getDirty()), pending: dirtyCount() };
}

// 本地写入钩子：实体改脏 → 延时上行；设置/档案/主题等快照改动自动标脏
/* ---------- 首次迁移：把升级前就在本机的老数据标脏，第一次上线时推到云端 ---------- */
const SEED_KEY = 'selfagent_sync_seed_v1';

function seedLegacy() {
  const train = store.getTrain() || {};
  const now = Date.now();
  let n = 0;
  (train.records || []).forEach((r, i) => {
    if (!r || !r.uid) return;
    if (!r.ts) r.ts = now - (i + 1) * 100; // 老数据给个递增的历史时间
    store.markDirty('train', r.uid);
    n++;
  });
  (train.cardio || []).forEach((r, i) => {
    if (!r || !r.uid) return;
    if (!r.ts) r.ts = now - (i + 1) * 100;
    store.markDirty('train', r.uid);
    n++;
  });
  (store.getLogs() || []).forEach((l) => {
    if (!l || !l.id) return;
    if (!l.ts) l.ts = l.time ? Date.parse(l.time) : now;
    store.markDirty('logs', l.id);
    n++;
  });
  store.writeRaw(store.KEYS.train, train);
  store.markDirty('snap', 'trainmeta');
  return n;
}

store.onWrite((key) => {
  if (mute) return;
  if (key.indexOf('dirty:') === 0) {
    // 本地刚改过 trainmeta：立刻记下本地修改时间，拉取时才能压住更旧的云端快照
    if (key === 'dirty:snap') {
      const d = store.getDirty();
      if (d.snap.indexOf('trainmeta') >= 0 && d.ts.trainmeta) setMetaTs(d.ts.trainmeta);
    }
    schedule();
    return;
  }
  if (key === store.KEYS.settings) store.markDirty('snap', 'settings');
  else if (key === store.KEYS.profile) store.markDirty('snap', 'profile');
  else if (key === store.KEYS.theme) store.markDirty('snap', 'settings');
});

module.exports = { push, pull, pushAll, boot, bootOnce, flush, schedule, status, watermark, ALL };
