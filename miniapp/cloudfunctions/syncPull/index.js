// 下行同步：按水位拉增量，返回统一结构给 libs/sync 做 LWW 合并。
// 身份只认 cloud.getWXContext() 的 OPENID，天然按账号隔离。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE = 1000;
const SNAPS = ['profile', 'settings', 'trainmeta'];

async function fetchAll(coll, where) {
  const out = [];
  let skip = 0;
  for (let i = 0; i < 20; i++) {
    const r = await db.collection(coll).where(where).skip(skip).limit(PAGE).get();
    const rows = (r && r.data) || [];
    out.push.apply(out, rows);
    if (rows.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const since = event.since || {};
  const kinds = Array.isArray(event.kinds) && event.kinds.length
    ? event.kinds
    : ['logs', 'train', 'profile', 'settings', 'trainmeta'];
  const data = {};
  let metaTs = 0;

  for (const kind of kinds) {
    const sinceTs = Number(since[kind]) || 0;

    if (SNAPS.indexOf(kind) >= 0) {
      const rows = await fetchAll('snapshots', { _openid: OPENID, kind, ts: _.gt(sinceTs) });
      if (rows.length) {
        const row = rows[rows.length - 1];
        data[kind] = row.payload;
        if (kind === 'trainmeta') metaTs = Number(row.upd) || Number(row.ts) || 0;
      }
      continue;
    }

    if (kind === 'logs') {
      const rows = await fetchAll('events', { _openid: OPENID, kind: 'logs', ts: _.gt(sinceTs) });
      data.logs = rows.map(d => Object.assign({}, d.payload, { ts: d.ts }));
      continue;
    }

    if (kind === 'train') {
      const rows = await fetchAll('events', { _openid: OPENID, kind: 'train', ts: _.gt(sinceTs) });
      data.train = {
        records: rows.filter(d => d.sub !== 'cardio').map(d => Object.assign({}, d.payload, { ts: d.ts })),
        cardio: rows.filter(d => d.sub === 'cardio').map(d => Object.assign({}, d.payload, { ts: d.ts }))
      };
    }
  }

  const st = await db.collection('sync_state').doc(OPENID).get().catch(() => ({ data: null }));
  return { ok: true, serverTs: (st.data && st.data.ts) || Date.now(), metaTs, data };
};
