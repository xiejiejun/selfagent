// 写入动作层：页面只调这里，统一负责「改训练数据 → 重建当天日志 → 落存储 → 维护墓碑」。
const store = require('./store/index');
const engine = require('./engine/index');

function ctx() {
  return {
    train: engine.ensureTrain(store.getTrain()),
    logs: store.getLogs(),
    tomb: store.getTomb()
  };
}

function commit(c, date, opts) {
  const o = opts || {};
  if (c.train) store.setTrain(c.train);
  if (c.logs) store.setLogs(engine.dedupeLogs(c.logs));
  if (c.tomb) store.setTomb(engine.pruneTomb(c.tomb));
  if (o.sync !== false) {
    const logs = engine.syncTrainLog(store.getLogs(), store.getTrain(), date, o.typeKey);
    store.setLogs(engine.dedupeLogs(logs));
  }
}

function ensureUid(rec, prefix) {
  if (!rec.uid) rec.uid = engine.uid(prefix || 't');
  return rec.uid;
}

/* 力量动作：新增或保存整组 */
function saveStrength(input) {
  const c = ctx();
  const rec = Object.assign({}, input, { groups: (input.groups || []).slice() });
  ensureUid(rec);
  rec.groups = rec.groups.map((g, i) => Object.assign({}, g, { no: i + 1, uid: rec.uid + 's' + i }));
  engine.upsertRecord(c.train, rec);
  commit(c, rec.date);
  return rec;
}

function deleteStrength(uidVal, date) {
  const c = ctx();
  const rec = (c.train.records || []).find(r => r && r.uid === uidVal);
  if (rec) {
    c.tomb = engine.addTomb(c.tomb, 'train', uidVal);
    engine.removeRecord(c.train, uidVal);
  }
  commit(c, date);
  return rec;
}

/* 有氧 */
function saveCardio(input) {
  const c = ctx();
  const rec = Object.assign({}, input);
  ensureUid(rec, 'c');
  engine.upsertCardio(c.train, rec);
  commit(c, rec.date);
  return rec;
}

function deleteCardio(uidVal, date) {
  const c = ctx();
  const rec = (c.train.cardio || []).find(x => x && x.uid === uidVal);
  if (rec) {
    c.tomb = engine.addTomb(c.tomb, 'cardio', uidVal);
    engine.removeCardio(c.train, uidVal);
  }
  commit(c, date);
  return rec;
}

/* 只改某组的完成状态：训练页点一下就记一组 */
function toggleGroup(date, uidVal, groupIndex) {
  const c = ctx();
  const rec = (c.train.records || []).find(r => r && r.uid === uidVal);
  if (!rec) return null;
  const gs = engine.ensureGroups(rec);
  const g = gs[groupIndex];
  if (!g) return null;
  g.done = !g.done;
  rec.groups = gs;
  rec.sets = gs.length;
  commit(c, date);
  return rec;
}

/* 日志：自由记录 */
function addNote(text, opts) {
  const o = opts || {};
  const now = new Date();
  const dk = o.date || engine.dayKey();
  const c = ctx();
  c.logs.push({
    id: engine.uid('note'),
    kind: 'note',
    type: o.type || 'life',
    tags: o.tags || '',
    score: null,
    mood: null,
    content: String(text || '').trim(),
    time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString(),
    date: dk,
    source: 'manual',
    meta: null
  });
  commit(c, dk, { sync: false });
}

function removeLog(id) {
  const c = ctx();
  const hit = c.logs.filter(l => String(l.id) === String(id))[0];
  c.logs = c.logs.filter(l => String(l.id) !== String(id));
  if (hit) c.tomb = engine.addTomb(c.tomb, 'log', hit.id);
  commit(c, engine.dayKey(), { sync: false });
}

/* 只重建某天（导入/迁移后用） */
function rebuildDay(date) {
  const c = ctx();
  commit(c, date);
}

module.exports = {
  ctx, saveStrength, deleteStrength, saveCardio, deleteCardio,
  toggleGroup, addNote, removeLog, rebuildDay
};
