// 上行同步：把本机状态拆成实体级事件写进云数据库，便于增量拉取与 LWW 合并。
// 集合：events（logs / train 实体）、snapshots（profile / settings / trainmeta 快照）、sync_state（每用户水位）
// 用户归属统一用 cloud.getWXContext() 里的 OPENID，客户端传什么都不可信。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLS = ['events', 'snapshots', 'sync_state'];
const SNAPS = ['profile', 'settings', 'trainmeta'];
const PAR = 5; // 并发写度，批量导入时避免串行超时

async function ensureColl(name) {
  try { await db.createCollection(name); } catch (e) { /* 已存在时会报错，忽略 */ }
}

async function put(coll, id, data) {
  try {
    await db.collection(coll).doc(id).set({ data });
  } catch (e) {
    try {
      await ensureColl(coll);
      await db.collection(coll).doc(id).set({ data });
    } catch (e2) {
      try { await db.collection(coll).add({ data: Object.assign({ _id: id }, data) }); } catch (e3) { /* 集合未建时静默 */ }
    }
  }
}

// 分批并发执行，单包可能带几十个实体
async function runAll(ops) {
  for (let i = 0; i < ops.length; i += PAR) {
    await Promise.all(ops.slice(i, i + PAR).map(fn => fn()));
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const states = event.states || {};
  const tomb = Array.isArray(event.tomb) ? event.tomb : [];
  const kinds = [];
  const ops = [];

  // 日志：按 id 存实体
  if (Array.isArray(states.logs)) {
    kinds.push('logs');
    for (const l of states.logs) {
      if (!l || !l.id) continue;
      const ts = Number(l.ts) || (l.time ? Date.parse(l.time) : 0) || now;
      ops.push(() => put('events', OPENID + '_logs_' + l.id, {
        _openid: OPENID, kind: 'logs', id: l.id, payload: l, ts, at: now
      }));
    }
  }

  // 训练：records / cardio 分实体存，uid 为键
  if (states.train && typeof states.train === 'object') {
    kinds.push('train');
    const arr = [];
    (states.train.records || []).forEach(r => arr.push({ sub: 'records', item: r }));
    (states.train.cardio || []).forEach(c => arr.push({ sub: 'cardio', item: c }));
    for (const row of arr) {
      const item = row.item;
      if (!item || !item.uid) continue;
      const ts = Number(item.ts) || now;
      ops.push(() => put('events', OPENID + '_train_' + item.uid, {
        _openid: OPENID, kind: 'train', sub: row.sub, uid: item.uid, payload: item, ts, at: now
      }));
    }
  }

  // 快照：profile / settings / trainmeta（收藏、自定义动作、别名）
  for (const k of SNAPS) {
    if (states[k] == null) continue;
    kinds.push(k);
    const upd = k === 'trainmeta' ? (Number(event.metaTs) || now) : now;
    const payload = states[k];
    ops.push(() => put('snapshots', OPENID + '_' + k, {
      _openid: OPENID, kind: k, payload, ts: now, upd
    }));
  }

  await runAll(ops);

  // 墓碑：把已删除的实体从云端摘掉
  for (const t of tomb) {
    if (!t || !t.u) continue;
    await db.collection('events').doc(OPENID + '_train_' + t.u).remove().catch(() => {});
    await db.collection('events').doc(OPENID + '_logs_' + t.u).remove().catch(() => {});
  }

  await put('sync_state', OPENID, { _openid: OPENID, ts: now, kinds });

  return { ok: true, serverTs: now, pushed: kinds };
};
