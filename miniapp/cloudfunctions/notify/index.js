// 订阅消息：绑定/解绑 + 每日「断签召回」推送。
// 订阅消息是一次性的：每发一条就消耗一次授权，所以这里默认只在「该练而没练」的日子发，
// 并把 lastSent 记下来，避免每天骚扰。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 模板关键词需与公众平台所选模板一致；如需调整，改 KEY_MAP 或环境变量 SUB_KEYS(JSON)
const KEY_MAP = { thing1: '训练提醒', time2: '20:00', thing2: '该练了' };
// 冷场几天后才召回，避免连着骚扰
const QUIET_DAYS = 2;

function dayKey(ts) {
  return new Date(Number(ts || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  if (!a || !b) return 999;
  const t1 = Date.parse(a + 'T00:00:00Z');
  const t2 = Date.parse(b + 'T00:00:00Z');
  if (isNaN(t1) || isNaN(t2)) return 999;
  return Math.round((t2 - t1) / 86400000);
}

// headline：连续/断签文案（模板 thing 类字段限 20 字以内）
function buildData(time, sub) {
  let map = KEY_MAP;
  if (process.env.SUB_KEYS) { try { map = Object.assign({}, KEY_MAP, JSON.parse(process.env.SUB_KEYS)); } catch (e) {} }
  const streak = Number(sub && sub.streak) || 0;
  const gap = daysBetween(sub && sub.lastDay, dayKey());
  const head = streak >= 3 ? '已连续 ' + streak + ' 天' : (gap >= 5 ? '好久没练了' : '今天还没练');
  const body = streak >= 3 ? '今天练一次就不断签' : '20 分钟就能续上';
  const d = {};
  Object.keys(map).forEach(k => {
    let v = String(map[k]).replace('{{time}}', time);
    if (k === 'thing1' || k === 'thing3') v = head;
    if (k === 'thing2' || k === 'thing4') v = body;
    d[k] = { value: v.slice(0, 20) };
  });
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
      enabled: true, ts: Date.now(),
      streak: Number(event.streak) || 0,
      lastDay: event.lastDay || ''
    };
    try { await db.collection('subscriptions').doc(OPENID).set({ data: doc }); }
    catch (e) { try { await db.collection('subscriptions').add({ data: Object.assign({ _id: OPENID }, doc) }); } catch (e2) {} }
    return { ok: true, bound: true };
  }

  // 小程序每次进前台刷新最近训练日，云端才知道「今天练没练」
  if (action === 'touch') {
    const patch = { ts: Date.now(), streak: Number(event.streak) || 0, lastDay: event.lastDay || '' };
    if (event.time) patch.time = event.time;
    try { await db.collection('subscriptions').doc(OPENID).update({ data: patch }); }
    catch (e) {}
    return { ok: true, touched: true };
  }

  if (action === 'unbind') {
    try { await db.collection('subscriptions').doc(OPENID).update({ data: { enabled: false, ts: Date.now() } }); } catch (e) {}
    return { ok: true, bound: false };
  }

  if (action === 'status') {
    const r = await db.collection('subscriptions').doc(OPENID).get().catch(() => ({ data: null }));
    return { ok: true, data: r.data || null };
  }

  // 定时触发：只给「有授权 + 今天没练 + 断签达到阈值」的人发
  const today = dayKey();
  const r = await db.collection('subscriptions').where({ enabled: true }).limit(1000).get().catch(() => ({ data: [] }));
  const sent = [], skipped = [], failed = [];
  for (const sub of (r.data || [])) {
    const time = sub.time || '20:00';
    if (sub.lastDay === today) { skipped.push(sub.openid); continue; }   // 今天已经练了
    const gap = daysBetween(sub.lastDay, today);
    if (gap < QUIET_DAYS) { skipped.push(sub.openid); continue; }         // 刚练过，别打扰
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: sub.openid,
        templateId: sub.tmplId,
        page: 'pages/train/index',
        data: buildData(time, sub)
      });
      sent.push(sub.openid);
      // 订阅消息一次用一条：发完就关掉，等用户下次进来再申请授权
      try { await db.collection('subscriptions').doc(sub.openid).update({ data: { enabled: false, lastSent: Date.now() } }); } catch (e3) {}
    } catch (e) {
      failed.push({ openid: sub.openid, err: String(e && (e.errCode || e.message || e)) });
    }
  }
  return { ok: true, sent: sent.length, skipped: skipped.length, failed };
};
