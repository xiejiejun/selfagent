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

// 打时间戳 + 标脏：同步时按 ts 做 LWW，只推这个实体
function touchTrain(rec) {
  if (!rec) return;
  rec.ts = Date.now();
  store.markDirty('train', rec.uid);
}

function touchLog(l) {
  if (!l) return;
  l.ts = Number(l.ts) || (l.time ? Date.parse(l.time) : 0) || Date.now();
  store.markDirty('logs', l.id);
}

/* 力量动作：新增或保存整组 */
function saveStrength(input) {
  const c = ctx();
  const rec = Object.assign({}, input, { groups: (input.groups || []).slice() });
  // 名称能判定部位就以名称为准，避免历史里 part 写错把核心训练算到背/腿上
  rec.part = engine.partForName(c.train, rec.name, rec.part);
  ensureUid(rec);
  rec.groups = rec.groups.map((g, i) => Object.assign({}, g, { no: i + 1, uid: rec.uid + 's' + i }));
  // 排序位：编辑已有动作时沿用原 ord，新动作排到当天末尾
  const old = (c.train.records || []).find(r => r && r.uid === rec.uid);
  if (typeof rec.ord !== 'number') {
    rec.ord = (old && typeof old.ord === 'number')
      ? old.ord
      : (c.train.records || []).filter(r => r && r.date === rec.date && typeof r.ord === 'number').length;
  }
  engine.upsertRecord(c.train, rec);
  touchTrain(rec);
  commit(c, rec.date);
  return rec;
}

function deleteStrength(uidVal, date) {
  const c = ctx();
  const rec = (c.train.records || []).find(r => r && r.uid === uidVal);
  if (rec) {
    c.tomb = engine.addTomb(c.tomb, 'train', uidVal);
    engine.removeRecord(c.train, uidVal);
    store.markDirty('train', uidVal);
  }
  commit(c, date);
  return rec;
}

/* 有氧 */
function saveCardio(input) {
  const c = ctx();
  const rec = Object.assign({}, input);
  ensureUid(rec, 'c');
  const old = (c.train.cardio || []).find(x => x && x.uid === rec.uid);
  rec.mode = rec.mode === 'sets' ? 'sets' : 'timer';
  rec.name = rec.name || rec.modal || '有氧';
  rec.modal = rec.modal || rec.name;
  rec.part = rec.part || '有氧';
  rec.dist = Math.max(0, Number(typeof rec.dist === 'number' ? rec.dist : (rec.dist || (old && old.dist) || 0)) || 0);
  if (rec.mode === 'sets') {
    rec.groups = (rec.groups || (old && old.groups) || []).slice().map((g, i) => Object.assign({}, g, { no: i + 1, uid: rec.uid + 's' + i }));
    rec.sets = rec.groups.length;
    rec.sec = 0;
    // 时长保留：切回计时时原分钟数还在
    if (rec.min === undefined) rec.min = (old && (old.min || old.dur)) || 0;
    if (rec.dur === undefined) rec.dur = rec.min || 0;
  } else {
    // groups 保留：切回计组时原组完成态还在（互转不清场）
    rec.sets = 0;
    rec.sec = (rec.min || rec.dur || 0) * 60;
    if (!Array.isArray(rec.groups)) rec.groups = (old && Array.isArray(old.groups)) ? old.groups : [];
    if (rec.min === undefined) rec.min = (old && (old.min || old.dur)) || 0;
    if (rec.dur === undefined) rec.dur = rec.min || 0;
  }
  if (typeof rec.ord !== 'number') {
    rec.ord = (old && typeof old.ord === 'number')
      ? old.ord
      : (c.train.records || []).concat(c.train.cardio || []).filter(x => x && x.date === rec.date && typeof x.ord === 'number').length;
  }
  engine.upsertCardio(c.train, rec);
  touchTrain(rec);
  commit(c, rec.date);
  return rec;
}

function deleteCardio(uidVal, date) {
  const c = ctx();
  const rec = (c.train.cardio || []).find(x => x && x.uid === uidVal);
  if (rec) {
    c.tomb = engine.addTomb(c.tomb, 'cardio', uidVal);
    engine.removeCardio(c.train, uidVal);
    store.markDirty('train', uidVal);
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
  touchTrain(rec);
  commit(c, date);
  return rec;
}

/* 有氧计组型：点一下记一组 */
function toggleCardioGroup(date, uidVal, groupIndex) {
  const c = ctx();
  const rec = (c.train.cardio || []).find(r => r && r.uid === uidVal);
  if (!rec) return null;
  const gs = engine.ensureGroups(rec);
  const g = gs[groupIndex];
  if (!g) return null;
  g.done = !g.done;
  rec.mode = 'sets';
  rec.groups = gs;
  rec.sets = gs.length;
  rec.done = gs.length > 0 && gs.every(x => x.done);
  touchTrain(rec);
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
    score: o.score == null ? null : Number(o.score),
    mood: o.mood == null ? null : Number(o.mood),
    content: String(text || '').trim(),
    time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString(),
    date: dk,
    source: 'manual',
    meta: null
  });
  touchLog(c.logs[c.logs.length - 1]);
  commit(c, dk, { sync: false });
}

function removeLog(id) {
  const c = ctx();
  const hit = c.logs.filter(l => String(l.id) === String(id))[0];
  c.logs = c.logs.filter(l => String(l.id) !== String(id));
  if (hit) {
    c.tomb = engine.addTomb(c.tomb, 'log', hit.id);
    store.markDirty('logs', hit.id);
  }
  commit(c, engine.dayKey(), { sync: false });
}

/* 动作库收藏 */
function toggleFav(id) {
  const c = ctx();
  const favs = c.train.favs || (c.train.favs = []);
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1); else favs.push(id);
  store.setTrain(c.train);
  store.markDirty('snap', 'trainmeta');
  return i < 0;
}

/* 动作别名：只改本地显示名，不影响历史记录里已存的名称 */
function setExName(id, name) {
  if (!id) return '';
  const c = ctx();
  const known = c.train.exnames || (c.train.exnames = {});
  const v = String(name || '').trim();
  if (v) known[id] = v; else delete known[id];
  store.setTrain(c.train);
  store.markDirty('snap', 'trainmeta');
  return v;
}

function exNameMap() {
  const c = ctx();
  return (c.train && c.train.exnames) || {};
}

/* 自定义动作库：存在 train.custom 里，动作库页会置顶合并 */
function customList() {
  const c = ctx();
  return (c.train.custom || []).slice();
}

function saveCustom(ex) {
  const c = ctx();
  const list = c.train.custom || (c.train.custom = []);
  const rec = Object.assign({}, ex);
  if (!rec.id) rec.id = engine.uid('my');
  const i = list.findIndex(x => x && x.id === rec.id);
  if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
  store.setTrain(c.train);
  store.markDirty('snap', 'trainmeta');
  pushNow();
  return rec;
}

function removeCustom(id) {
  const c = ctx();
  c.train.custom = (c.train.custom || []).filter(x => !(x && x.id === id));
  store.setTrain(c.train);
  store.markDirty('snap', 'trainmeta');
  pushNow();
}

// 自定义动作改了立刻上行，不等防抖；失败就留给下一次自动同步
function pushNow() {
  try { require('./sync/index').flush(); } catch (e) {}
}

/* 拖动排序：把某天的动作（含自定义序）按 uid 顺序写回 ord，力量与有氧同一套序 */
function reorderDay(date, uids) {
  const c = ctx();
  (uids || []).forEach((u, i) => {
    const key = String(u || '');
    if (!key) return;
    const r = (c.train.records || []).find(x => x && String(x.uid) === key);
    if (r) { r.ord = i; touchTrain(r); return; }
    const cd = (c.train.cardio || []).find(x => x && String(x.uid) === key);
    if (cd) { cd.ord = i; touchTrain(cd); }
  });
  commit(c, date);
}

/* 只重建某天（导入/迁移后用） */
function rebuildDay(date) {
  const c = ctx();
  commit(c, date);
}

module.exports = {
  ctx, saveStrength, deleteStrength, saveCardio, deleteCardio,
  toggleGroup, toggleCardioGroup, addNote, removeLog, rebuildDay, toggleFav, reorderDay,
  setExName, exNameMap, customList, saveCustom, removeCustom
};
