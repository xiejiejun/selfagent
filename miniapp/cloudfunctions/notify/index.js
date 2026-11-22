// 订阅消息：绑定/解绑 + 每日定时推送训练提醒。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const KEY_MAP = { thing1: '训练提醒', time2: '20:00', thing2: '该练了', time3: '20:00' };

function buildData(time) {
  // 模板关键词需与公众平台所选模板一致；如需调整，改 KEY_MAP 或环境变量 SUB_KEYS(JSON)
  let map = KEY_MAP;
  if (process.env.SUB_KEYS) { try { map = Object.assign({}, KEY_MAP, JSON.parse(process.env.SUB_KEYS)); } catch (e) {} }
  const d = {};
  Object.keys(map).forEach(k => { d[k] = { value: String(map[k]).replace('{{time}}', time) }; });
  return d;
}

async function ensure(name) {
  try { await db.createCollection(name); } catch (e) {}
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'send';
  await ensure('subscriptions');

  if (action === 'bind') {
    const doc = {
      openid: OPENID, tmplId: event.tmplId || '', time: event.time || '20:00',
      enabled: true, ts: Date.now()
    };
    try { await db.collection('subscriptions').doc(OPENID).set({ data: doc }); }
    catch (e) { try { await db.collection('subscriptions').add({ data: Object.assign({ _id: OPENID }, doc) }); } catch (e2) {} }
    return { ok: true, bound: true };
  }

  if (action === 'unbind') {
    try { await db.collection('subscriptions').doc(OPENID).update({ data: { enabled: false, ts: Date.now() } }); } catch (e) {}
    return { ok: true, bound: false };
  }

  if (action === 'status') {
    const r = await db.collection('subscriptions').doc(OPENID).get().catch(() => ({ data: null }));
    return { ok: true, data: r.data || null };
  }

  // 定时触发：给所有 enabled 的用户发一条
  const r = await db.collection('subscriptions').where({ enabled: true }).limit(1000).get().catch(() => ({ data: [] }));
  const sent = [], failed = [];
  for (const sub of (r.data || [])) {
    const time = sub.time || '20:00';
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: sub.openid,
        templateId: sub.tmplId,
        page: 'pages/home/index',
        data: buildData(time)
      });
      sent.push(sub.openid);
      try { await db.collection('subscriptions').doc(sub.openid).update({ data: { enabled: false, lastSent: Date.now() } }); } catch (e3) {}
    } catch (e) {
      failed.push({ openid: sub.openid, err: String(e && (e.errCode || e.message || e)) });
    }
  }
  return { ok: true, sent: sent.length, failed };
};
