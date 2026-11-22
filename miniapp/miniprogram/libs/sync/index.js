// 增量同步引擎。传输层是云函数（syncPush / syncPull），这里只管水位、墓碑、LWW 合并。
// 与网页版 sync 模块同一套逻辑，仅把 fetch 换成 wx.cloud.callFunction。
const store = require('../store/index');

// 水位：每个 kind 上次同步成功的时间戳
function watermark() {
  const w = store.read(store.KEYS.sync, {}) || {};
  return typeof w === 'object' ? w : {};
}

function bump(kind, ts) {
  const w = watermark();
  w[kind] = Math.max(Number(w[kind]) || 0, Number(ts) || Date.now());
  store.write(store.KEYS.sync, w);
}

function call(name, data) {
  return wx.cloud.callFunction({ name, data }).then(r => (r && r.result) || {});
}

function statesOf(kinds) {
  const s = {};
  kinds.forEach(k => {
    if (k === 'logs') s.logs = store.getLogs() || [];
    else if (k === 'train') s.train = store.getTrain() || {};
    else s[k] = store.read(store.KEYS[k], null);
  });
  return s;
}

function tombSet() {
  const arr = store.getTomb();
  const m = {};
  (Array.isArray(arr) ? arr : []).forEach(t => { if (t && t.u) m[t.k + ':' + t.u] = 1; });
  return m;
}

// 上行：整份状态按实体推到云端（服务端做 upsert，幂等）
async function push(kinds) {
  const list = kinds || ['logs', 'train', 'profile', 'settings'];
  const res = await call('syncPush', { states: statesOf(list), tomb: store.getTomb(), since: watermark() });
  if (res && res.ok) list.forEach(k => bump(k, res.serverTs));
  return res;
}

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

// 下行：拉水位之后的服务端增量，按实体 LWW 合并，墓碑条目丢弃
async function pull(kinds) {
  const list = kinds || ['logs', 'train', 'profile', 'settings'];
  const res = await call('syncPull', { kinds: list, since: watermark(), tomb: store.getTomb() });
  if (!res || !res.ok) return res;
  const saved = res.data || {};
  const tomb = tombSet();

  if (Array.isArray(saved.logs)) {
    const merged = mergeByKey(store.getLogs(), saved.logs, 'id', x => tomb['log:' + x.id]);
    store.setLogs(merged);
    bump('logs', res.serverTs);
  }

  if (saved.train && typeof saved.train === 'object') {
    const local = store.getTrain() || {};
    const records = mergeByKey(local.records, saved.train.records, 'uid', x => tomb['train:' + x.uid]);
    const cardio = mergeByKey(local.cardio, saved.train.cardio, 'uid', x => tomb['cardio:' + x.uid]);
    store.setTrain(Object.assign({}, local, { records, cardio }));
    bump('train', res.serverTs);
  }

  ['profile', 'settings'].forEach(k => {
    if (saved[k] !== undefined && saved[k] !== null) {
      store.write(store.KEYS[k], saved[k]);
      bump(k, res.serverTs);
    }
  });

  return res;
}

module.exports = { push, pull, watermark };
