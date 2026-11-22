const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const since = event.since || {};
  const kinds = event.kinds || ['logs', 'train', 'profile', 'settings'];
  const out = {};

  for (const kind of kinds) {
    const sinceTs = since[kind] || 0;
    if (kind === 'profile' || kind === 'settings') {
      const r = await db.collection('snapshots')
        .where({ _openid: OPENID, kind, ts: _.gt(sinceTs) }).limit(1).get();
      if (r.data && r.data.length) out[kind] = r.data[0].payload;
      continue;
    }
    const r = await db.collection('events')
      .where({ _openid: OPENID, kind, ts: _.gt(sinceTs) }).limit(1000).get();
    out[kind] = (r.data || []).map(d => Object.assign({}, d.payload, { ts: d.ts }));
  }

  const st = await db.collection('sync_state').doc(OPENID).get().catch(() => ({ data: null }));
  return { ok: true, serverTs: (st.data && st.data.ts) || Date.now(), data: out };
};
