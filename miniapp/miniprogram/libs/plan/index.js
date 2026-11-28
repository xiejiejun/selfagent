// 排期：按日期存「计划要做但还没开练」的动作（settings.plan.dates）
// 和训练记录分开：排期是待办，记录是已练；从排期「加入今日训练」才会变成记录
const store = require('../store/index');
const engine = require('../engine/index');

const WD = ['日', '一', '二', '三', '四', '五', '六'];

function keyOf(d) {
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function parse(date) {
  const a = String(date || '').split('-').map(Number);
  return new Date(a[0], (a[1] || 1) - 1, a[2] || 1);
}

function map() {
  const s = store.getSettings() || {};
  return (s.plan && s.plan.dates) || {};
}

function save(m) {
  const s = store.getSettings() || {};
  s.plan = Object.assign({}, s.plan, { dates: m });
  store.setSettings(s);
}

function items(date) {
  return (map()[String(date)] || []).slice();
}

function add(date, ex) {
  if (!date || !ex) return null;
  const m = map();
  const list = (m[date] || []).slice();
  const key = String(ex.exId || ex.id || ex.name || '');
  if (list.some(x => String(x.exId || x.id || x.name) === key)) return null;
  const cd = !!(ex.cd || ex.isCardio || (ex.p === '有氧'));
  const it = {
    exId: String(ex.exId || ex.id || ''),
    name: ex.n || ex.name || '',
    part: ex.p || ex.part || (cd ? '有氧' : ''),
    cd,
    sets: cd ? 1 : (Number(ex.sets) || 3),
    reps: cd ? 0 : (Number(ex.reps) || 10),
    weight: Number(ex.weight) || 0,
    dur: cd ? (Number(ex.dur) || 20) : 0,
    ts: Date.now()
  };
  list.push(it);
  m[date] = list;
  save(m);
  return it;
}

function remove(date, idx) {
  const m = map();
  const list = (m[date] || []).slice();
  if (!list[idx]) return false;
  list.splice(idx, 1);
  if (list.length) m[date] = list; else delete m[date];
  save(m);
  return true;
}

function count(date) { return items(date).length; }

// 今天的排期 → 今天的训练记录（幂等：同名/同 exId 已有就跳过），返回新增个数
function importToDate(date) {
  const list = items(date);
  if (!list.length) return 0;
  const train = engine.ensureTrain(store.getTrain());
  const actions = require('../actions');
  let added = 0;
  list.forEach(i => {
    const inSt = (train.records || []).some(r => r && r.date === date &&
      (String(r.exId || '') === i.exId || (!i.exId && r.name === i.name)));
    const inCd = (train.cardio || []).some(c => c && c.date === date &&
      (String(c.exId || '') === i.exId || (!i.exId && c.name === i.name)));
    if (i.cd) {
      if (inCd || inSt) return;
      actions.saveCardio({
        date, modal: i.name, name: i.name, exId: i.exId, part: '有氧',
        mode: 'timer', min: i.dur || 20, dur: i.dur || 20, done: false
      });
      added++;
      return;
    }
    if (inSt) return;
    const groups = [];
    for (let g = 0; g < (i.sets || 3); g++) {
      groups.push({ no: g + 1, reps: i.reps || 10, weight: i.weight || 0, done: false, warmup: false, rpe: 0, sec: 0 });
    }
    actions.saveStrength({ date, exId: i.exId, name: i.name, part: i.part, sets: i.sets || 3, reps: i.reps || 10, weight: i.weight || 0, groups });
    added++;
  });
  return added;
}

// 训练记录里的当天完成态：n 个动作、done/total 组
function trainStat(train, date) {
  const recs = (train.records || []).filter(r => r && r.date === date);
  const cds = (train.cardio || []).filter(c => c && c.date === date);
  let done = 0, total = 0;
  recs.forEach(r => {
    const gs = engine.ensureGroups(r);
    total += gs.length;
    done += gs.filter(g => g.done).length;
  });
  cds.forEach(c => { total += 1; done += c.done ? 1 : 0; });
  return { n: recs.length + cds.length, done, total };
}

// 本周（周一→周日）排期视图：每行只回答「这天排了几个、练到哪了」
function weekRows(train) {
  const now = new Date();
  const today = engine.dayKey();
  const wd = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (wd - 1));
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    const date = keyOf(d);
    const p = count(date);
    const t = trainStat(train, date);
    rows.push({
      date,
      w: WD[d.getDay()],
      md: (d.getMonth() + 1) + '-' + d.getDate(),
      today: date === today,
      past: date < today,
      planned: p,
      n: t.n,
      done: t.done,
      total: t.total,
      empty: p === 0
    });
  }
  return rows;
}

module.exports = { keyOf, items, add, remove, count, importToDate, trainStat, weekRows, parse };
