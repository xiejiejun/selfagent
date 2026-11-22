// 训练笔记（Markdown）导入：解析规则与网页版 index.html 的 mdParse/mdImport 对齐
const store = require('./store/index');
const engine = require('./engine/index');

const PART_KW = [
  ['腿', '上腿'],
  ['臀', '上腿'],
  ['胸', '胸'],
  ['背', '背'],
  ['肩', '肩'],
  ['二头', '上臂'],
  ['三头', '上臂'],
  ['手臂', '上臂'],
  ['前臂', '前臂'],
  ['小腿', '小腿'],
  ['腹', '腰腹'],
  ['核心', '腰腹'],
  ['有氧', '有氧']
];

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function partOf(title) {
  const t = String(title || '');
  for (let i = 0; i < PART_KW.length; i++) {
    if (t.indexOf(PART_KW[i][0]) >= 0) return PART_KW[i][1];
  }
  return '其他';
}

// 「0911」这种 4 位尾数 → 年份按最近一次训练推断
function dateOf(mm, dd, now) {
  const y0 = now.getFullYear();
  const m = Number(mm);
  const d = Number(dd);
  const guess = new Date(y0, m - 1, d);
  const future = new Date(y0, now.getMonth(), now.getDate() + 7);
  const y = guess > future ? y0 - 1 : y0;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// 「卧推 60kg 5×5」「深蹲（3+2）100 5x5」→ 动作 + 每组
function parseStrength(body) {
  const txt = body.replace(/（(\d+)\s*\+\s*(\d+)）/g, '$1');
  const tk = [];
  const re = /(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    tk.push({ reps: Number(m[1]), sets: Number(m[2]), start: m.index, end: re.lastIndex });
  }
  if (!tk.length) return null;

  const name = txt.slice(0, tk[0].start)
    .replace(/[（(].*$/, '')
    .replace(/[，,·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;

  const groups = [];
  tk.forEach((t, i) => {
    const seg = txt.slice(t.end, i + 1 < tk.length ? tk[i + 1].start : txt.length);
    let weight = 0;
    const wm = seg.match(/(\d+(?:\.\d+)?)\s*(kg|lbs|lb|磅)/i);
    if (wm) {
      weight = Number(wm[1]);
      if (/lb/i.test(wm[2])) weight = Math.round(weight * 0.4536 * 10) / 10;
    }
    const warmup = /热身/.test(seg);
    const n = Math.max(1, Math.min(20, t.sets));
    for (let k = 0; k < n; k++) groups.push({ reps: t.reps, weight, warmup });
  });

  const work = groups.filter(g => !g.warmup);
  const anchor = work.length ? work : groups;
  return {
    name,
    groups,
    sets: groups.length,
    reps: Math.max.apply(null, anchor.map(g => g.reps || 0)),
    weight: Math.max.apply(null, anchor.map(g => g.weight || 0))
  };
}

// 标题行必须带 4 位日期（如「腿 0911」）；条目行是 - [x] 开头
function parse(text, now) {
  const out = [];
  const n = now || new Date();
  String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const dm = line.match(/(\d{2})(\d{2})\s*$/);
    const isItem = /^-\s*\[[xX ]\]/.test(line);

    if (!isItem && dm && !/：$/.test(line) && line.length > 4) {
      const title = line.slice(0, dm.index).replace(/[：:]\s*$/, '').replace(/\s+/g, ' ').trim();
      out.push({ date: dateOf(dm[1], dm[2], n), title, part: partOf(title), items: [] });
      return;
    }
    if (isItem && out.length) {
      const body = line.replace(/^-\s*\[[xX ]\]\s*/, '').trim();
      if (!body) return;
      const cm = body.match(/^(.+?)\s*(\d+)\s*(?:min|分钟|′)/i);
      if (cm) {
        out[out.length - 1].items.push({ type: 'cardio', name: cm[1].trim(), min: Number(cm[2]) });
        return;
      }
      const st = parseStrength(body);
      if (st && st.sets) out[out.length - 1].items.push(Object.assign({ type: 'strength' }, st));
    }
  });
  return out;
}

function dupSet() {
  const set = {};
  const train = engine.ensureTrain(store.getTrain());
  (train.records || []).forEach(r => { set[r.date + '|' + r.name + '|' + (r.sets || 0) + '|' + (r.weight || 0)] = 1; });
  (train.cardio || []).forEach(c => { set[c.date + '|cd|' + (c.modal || c.name) + '|' + (c.dur || c.min || 0)] = 1; });
  return set;
}

// 只解析、不写入：给出可导入条数与重复条数
function preview(text) {
  const sess = parse(text);
  const dup = dupSet();
  let rec = 0, cd = 0, skip = 0;
  sess.forEach(s => {
    s.items.forEach(it => {
      if (it.type === 'cardio') {
        if (dup[s.date + '|cd|' + it.name + '|' + it.min]) skip++; else cd++;
      } else {
        if (dup[s.date + '|' + it.name + '|' + it.sets + '|' + it.weight]) skip++; else rec++;
      }
    });
  });
  return {
    sess, dup, rec, cd, skip,
    days: sess.length,
    first: sess.length ? sess[0].date : '',
    last: sess.length ? sess[sess.length - 1].date : ''
  };
}

// 写入：新增记录（同天同动作同组数同重量跳过），按天重建训练日志
function apply(p) {
  const train = engine.ensureTrain(store.getTrain());
  const dup = p.dup || dupSet();
  const now = Date.now();
  const added = { rec: 0, cd: 0, days: [] };

  p.sess.forEach(s => {
    let touched = false;
    s.items.forEach((it, ii) => {
      if (it.type === 'cardio') {
        const k = s.date + '|cd|' + it.name + '|' + it.min;
        if (dup[k]) return;
        dup[k] = 1;
        train.cardio.push({
          uid: 'im' + hash(k + now),
          date: s.date,
          modal: it.name,
          name: it.name,
          dur: it.min,
          min: it.min,
          sec: it.min * 60,
          done: true,
          free: true,
          role: 'post',
          ts: now
        });
        added.cd++;
        touched = true;
        return;
      }
      const k = s.date + '|' + it.name + '|' + it.sets + '|' + it.weight;
      if (dup[k]) return;
      dup[k] = 1;
      const uid = 'im' + hash(k + now + ii);
      const rec = {
        date: s.date,
        exId: 'im' + hash(it.name),
        name: it.name,
        part: s.part,
        sets: it.sets,
        reps: it.reps,
        weight: it.weight,
        dur: 0,
        uid
      };
      rec.groups = it.groups.map((g, gi) => ({
        no: gi + 1,
        reps: g.reps,
        weight: g.weight,
        done: true,
        warmup: !!g.warmup,
        uid: uid + 's' + gi
      }));
      train.records.push(rec);
      added.rec++;
      touched = true;
    });
    if (touched && added.days.indexOf(s.date) < 0) added.days.push(s.date);
  });

  store.setTrain(train);

  let logs = store.getLogs();
  added.days.forEach(d => {
    logs = engine.syncTrainLog(logs, train, d);
    const idx = logs.findIndex(l => l.kind === 'train' && l.date === d);
    if (idx >= 0) {
      const sess = p.sess.filter(s => s.date === d)[0];
      if (sess && sess.title) logs[idx] = Object.assign({}, logs[idx], { tags: '训练 · ' + sess.title });
    }
  });
  store.setLogs(engine.dedupeLogs(logs));
  return added;
}

module.exports = { parse, preview, apply, partOf, dateOf, hash };
