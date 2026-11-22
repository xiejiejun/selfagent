// 增量同步引擎。传输层是云函数（syncPush / syncPull），这里只管水位、墓碑、LWW 合并。
// 与网页版 sync 模块同一套逻辑，仅把 fetch 换成 wx.cloud.callFunction。

const store = require('../store/index');

const colOf = { logs: 'events', train: 'events', profile: 'snapshots', settings: 'snapshots' };

function payloadOf(kind) {
  if (kind === 'logs') return store.getLogs();
  if (kind === 'train') return store.getTrain();
  return store.read(store.KEYS[kind], null);
}

function applyOf(kind, data) {
  if (kind === 'logs') return store.setLogs(data || []);
  if (kind === 'train') return store.setTrain(data || {});
  return store.write(store.KEYS[kind], data);
}

function watermark() {
  return store.read(store.KEYS.sync, {}) || {};
}

function bump(kind, ts) {
  const w = watermark();
  w[kind] = Math.max(w[kind] || 0, ts || Date.now());
  store.write(store.KEYS.sync, w);
}

function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({ name, data })
      .then(r => resolve((r && r.result) || {}))
      .catch(reject);
  });
}

// 上行：只推送水位之后变更过的条目（网页版按 updatedAt/墓碑过滤）
async function push(kinds) {
  const list = kinds || ['logs', 'train', 'profile', 'settings'];
  const tomb = store.getTomb();
  const body = {};
  list.forEach(k => { body[k] = payloadOf(k); });
  const res = await call('syncPush', { collections: body, tomb, since: watermark() });
  if (res && res.ok) list.forEach(k => bump(k, res.serverTs));
  return res;
}

// 下行：拉水位之后的服务端增量，LWW 合并，被墓碑标记的条目丢弃
async function pull(kinds) {
  const list = kinds || ['logs', 'train', 'profile', 'settings'];
  const res = await call('syncPull', { kinds: list, since: watermark(), tomb: store.getTomb() });
  if (!res || !res.ok) return res;
  const saved = res.data || {};
  Object.keys(saved).forEach(k => {
    const remote = saved[k];
    if (remote == null) return;
    if (Array.isArray(remote)) {
      const local = payloadOf(k) || [];
      const tombIds = store.getTomb().map(t => t.u);
      const merged = remote.filter(x => !x || tombIds.indexOf(x.uid) < 0);
      const map = new Map();
      (Array.isArray(local) ? local : []).forEach(x => x && x.uid && map.set(x.uid, x));
      merged.forEach(x => {
        if (!x || !x.uid) return;
        const l = map.get(x.uid);
        if (!l || ((x.ts || 0) > (l.ts || 0))) map.set(x.uid, x);
      });
      applyOf(k, Array.from(map.values()));
    } else {
      applyOf(k, remote);
    }
    bump(k, res.serverTs);
  });
  return res;
}

module.exports = { push, pull, watermark };
