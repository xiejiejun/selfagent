const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const collections = event.collections || {};
  const tomb = event.tomb || [];

  for (const kind of Object.keys(collections)) {
    const data = collections[kind];
    if (data == null) continue;
    if (kind === 'profile' || kind === 'settings') {
      await db.collection('snapshots').doc(OPENID + '_' + kind).set({
        data: { _openid: OPENID, kind, payload: data, ts: now }
      }).catch(async () => {
        await db.collection('snapshots').add({ data: { _openid: OPENID, kind, payload: data, ts: now } });
      });
      continue;
    }
    const arr = Array.isArray(data) ? data : [];
    for (const it of arr) {
      if (!it || !it.uid) continue;
      const id = OPENID + '_' + kind + '_' + it.uid;
      await db.collection('events').doc(id).set({
        data: { _openid: OPENID, kind, uid: it.uid, payload: it, ts: it.ts || now }
      }).catch(() => {});
    }
  }

  for (const t of tomb) {
    if (!t || !t.u) continue;
    await db.collection('events').doc(OPENID + '_' + (t.k || 'train') + '_' + t.u).remove().catch(() => {});
  }

  await db.collection('sync_state').doc(OPENID).set({
    data: { _openid: OPENID, ts: now, kinds: Object.keys(collections) }
  }).catch(() => {});

  return { ok: true, serverTs: now };
};
