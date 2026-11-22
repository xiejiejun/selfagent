// 规则引擎 / 装配 / 文案 / 统计。纯函数，无 DOM、无 wx API：网页版可以引同一份。
// 网页版对应：index.html 的 stDayItems / cdDayItems / dayItems / dayContent / syncTrainLog / prOfItems / lgd / dots。

/* ---------------- 基础 ---------------- */

function pad2(n) { return String(n).padStart(2, '0'); }

function dayKey(d) {
  const dt = d ? new Date(d) : new Date();
  return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
}

function uid(prefix) {
  return (prefix || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ensureTrain(train) {
  const t = train && typeof train === 'object' ? train : {};
  if (!Array.isArray(t.records)) t.records = [];
  if (!Array.isArray(t.cardio)) t.cardio = [];
  if (!Array.isArray(t.custom)) t.custom = [];
  if (!Array.isArray(t.favs)) t.favs = [];
  if (!t.renames || typeof t.renames !== 'object') t.renames = {};
  return t;
}

// 老数据没有 groups 时，用 sets/reps/weight 补出来（对应网页版 ensureGroups）
function ensureGroups(r) {
  if (!r) return [];
  if (Array.isArray(r.groups) && r.groups.length) return r.groups;
  const n = Math.max(1, r.sets || 1);
  const gs = [];
  for (let i = 0; i < n; i++) {
    gs.push({ no: i + 1, reps: r.reps || 0, weight: r.weight || 0, done: true, warmup: false, rpe: 0, sec: 0, uid: (r.uid || '') + 's' + i });
  }
  return gs;
}

/* ---------------- 装配 ---------------- */

function stDayItems(train, dk) {
  return ensureTrain(train).records.filter(r => r && r.date === dk).map(r => {
    const gs = ensureGroups(r);
    const done = gs.filter(g => g.done).length;
    const vol = gs.filter(g => g.done && !g.warmup).reduce((a, g) => a + (g.reps || 0) * (g.weight || 0), 0);
    const pick = k => {
      const arr = gs.filter(g => (g[k] || 0) > 0 && !g.warmup);
      const v = arr.slice(-1)[0] || gs.filter(g => (g[k] || 0) > 0).slice(-1)[0];
      return v ? v[k] : 0;
    };
    return {
      type: 'strength', uid: r.uid || '', exId: r.exId, name: r.name, part: r.part,
      sets: gs.length, reps: pick('reps'), weight: pick('weight'), done,
      volume: Math.round(vol),
      groups: gs.map(g => ({ no: g.no, reps: g.reps, weight: g.weight, done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, uid: g.uid || '' }))
    };
  });
}

function cdDayItems(train, dk) {
  return ensureTrain(train).cardio.filter(c => c && c.date === dk && !c.skipped).map(c => {
    const min = c.min || c.dur || Math.round((c.sec || 0) / 60) || 0;
    return { type: 'cardio', name: c.modal || c.name || '有氧', min, done: !!c.done, uid: c.uid || '' };
  });
}

function dayItems(train, dk) {
  return stDayItems(train, dk).concat(cdDayItems(train, dk));
}

function dayContent(items) {
  const st = (items || []).filter(i => i.type !== 'cardio').map(i => i.name);
  const cd = (items || []).filter(i => i.type === 'cardio').map(i => i.name + (i.min ? ' ' + i.min + 'min' : ''));
  return st.concat(cd).join('、');
}

/* ---------------- 文案 ---------------- */

function groupLine(groups) {
  const a = (groups || []).filter(g => !g.warmup);
  if (!a.length) return '';
  const one = g => (g.weight > 0 ? g.weight + 'kg' : '自重') + '×' + (g.reps || 0);
  const same = a.every(g => (g.weight || 0) === (a[0].weight || 0) && (g.reps || 0) === (a[0].reps || 0));
  if (same) return (a[0].weight > 0 ? a[0].weight + 'kg' : '自重') + ' ' + a.length + '×' + (a[0].reps || 0);
  const parts = a.map(one);
  return parts.length > 3 ? parts.slice(0, 3).join(' · ') + ' · +' + (parts.length - 3) : parts.join(' · ');
}

function summarize(items) {
  const strength = (items || []).filter(i => i.type !== 'cardio');
  const cardio = (items || []).filter(i => i.type === 'cardio');
  let done = 0, total = 0;
  strength.forEach(it => {
    const gs = it.groups || [];
    total += gs.length || it.sets || 0;
    done += gs.filter(g => g.done).length;
  });
  const volume = Math.round(strength.reduce((a, i) => a + (i.volume || 0), 0));
  return { n: strength.length, done, total, volume, cardio };
}

function summaryText(items) {
  const s = summarize(items);
  const cd = s.cardio.length ? ' · 有氧 ' + s.cardio.map(c => c.name + ' ' + c.min + '′').join('、') : '';
  return s.n + ' 动作 · ' + s.done + '/' + s.total + ' 组' + cd + ' · ' + (s.volume ? s.volume.toLocaleString() + ' kg' : '—');
}

/* ---------------- 写入 ---------------- */

function upsertRecord(train, rec) {
  const t = ensureTrain(train);
  const idx = t.records.findIndex(r => r && r.uid && r.uid === rec.uid);
  if (idx >= 0) t.records[idx] = rec; else t.records.push(rec);
  return t;
}

function removeRecord(train, uidVal) {
  const t = ensureTrain(train);
  t.records = t.records.filter(r => !(r && r.uid === uidVal));
  return t;
}

function upsertCardio(train, c) {
  const t = ensureTrain(train);
  const idx = t.cardio.findIndex(x => x && x.uid && x.uid === c.uid);
  if (idx >= 0) t.cardio[idx] = c; else t.cardio.push(c);
  return t;
}

function removeCardio(train, uidVal) {
  const t = ensureTrain(train);
  t.cardio = t.cardio.filter(c => !(c && c.uid === uidVal));
  return t;
}

// 墓碑：删除后推给云，防止同步时被拉回来
function addTomb(tomb, kind, uidVal) {
  const arr = Array.isArray(tomb) ? tomb : [];
  const rest = arr.filter(t => !(t && t.u === uidVal && t.k === kind));
  rest.push({ k: kind, u: uidVal, t: Date.now() });
  return rest;
}

function pruneTomb(tomb, maxAgeMs) {
  const now = Date.now();
  const max = maxAgeMs || 90 * 24 * 3600 * 1000;
  return (Array.isArray(tomb) ? tomb : []).filter(t => t && now - (t.t || 0) < max);
}

/* ---------------- 日志 ---------------- */

function buildTrainLog(date, items, prev, typeKey) {
  return {
    id: (prev && prev.id) || 'autotr-' + date,
    kind: 'train',
    source: (prev && prev.source === 'manual') ? 'manual' : 'auto',
    type: typeKey || (prev && prev.type) || 'fit',
    tags: '训练',
    score: null,
    mood: null,
    content: dayContent(items),
    time: new Date().toISOString(),
    date,
    meta: {
      items,
      volume: summarize(items).volume,
      checkin: (prev && prev.meta && prev.meta.checkin) || null
    }
  };
}

// 当天训练日志 upsert：有数据就重建，没数据就删掉当天空日志
function syncTrainLog(logs, train, date, typeKey) {
  const arr = Array.isArray(logs) ? logs.slice() : [];
  const items = dayItems(train, date);
  const same = arr.filter(l => l.kind === 'train' && l.date === date);
  const rest = arr.filter(l => !(l.kind === 'train' && l.date === date));
  if (!items.length) return rest;
  const log = buildTrainLog(date, items, same[0], typeKey);
  rest.push(log);
  return rest;
}

function dedupeLogs(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  const seen = {};
  const out = [];
  arr.forEach(l => {
    if (!l) return;
    const key = l.kind === 'train' && l.date ? 'train:' + l.date : (l.id || uid('d'));
    if (seen[key]) return;
    seen[key] = 1;
    out.push(l);
  });
  return out;
}

/* ---------------- 统计 ---------------- */

function dayStat(train, dk) {
  const items = dayItems(train, dk);
  const s = summarize(items);
  const cardioMin = s.cardio.reduce((a, c) => a + (c.min || 0), 0);
  return { date: dk, n: s.n, done: s.done, total: s.total, volume: s.volume, cardioMin, items };
}

function lastNDays(train, n, endDate) {
  const out = [];
  const end = endDate ? new Date(endDate) : new Date();
  for (let i = 0; i < (n || 7); i++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push(dayStat(train, dayKey(d)));
  }
  return out;
}

function streakDays(train, endDate) {
  let n = 0;
  const end = endDate ? new Date(endDate) : new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const s = dayStat(train, dayKey(d));
    if (s.volume > 0 || s.cardioMin > 0) n++;
    else if (i > 0) break;
  }
  return n;
}

function partStats(train, nDays) {
  const days = lastNDays(train, nDays || 30);
  const map = {};
  days.forEach(d => {
    d.items.forEach(it => {
      if (it.type === 'cardio') return;
      const k = it.part || '其他';
      map[k] = (map[k] || 0) + (it.volume || 0);
    });
  });
  return Object.keys(map).map(k => ({ part: k, volume: map[k] })).sort((a, b) => b.volume - a.volume);
}

function topExercises(train, nDays, limit) {
  const days = lastNDays(train, nDays || 30);
  const map = {};
  days.forEach(d => d.items.forEach(it => {
    if (it.type === 'cardio') return;
    const k = it.name;
    if (!map[k]) map[k] = { name: k, part: it.part, sets: 0, volume: 0, last: d.date };
    map[k].sets += it.sets || 0;
    map[k].volume += it.volume || 0;
  }));
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.volume - a.volume).slice(0, limit || 5);
}

/* ---------------- 日期展示 ---------------- */

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dateLabel(dk) {
  const today = dayKey();
  const d = new Date(dk + 'T00:00:00');
  if (dk === today) return '今天';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dk === dayKey(y)) return '昨天';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
}

function shortDate(dk) {
  const d = new Date(dk + 'T00:00:00');
  return (d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function fmtTime(iso) {
  const d = new Date(iso || Date.now());
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

module.exports = {
  pad2, dayKey, uid, ensureTrain, ensureGroups,
  stDayItems, cdDayItems, dayItems, dayContent,
  groupLine, summarize, summaryText,
  upsertRecord, removeRecord, upsertCardio, removeCardio,
  addTomb, pruneTomb,
  buildTrainLog, syncTrainLog, dedupeLogs,
  dayStat, lastNDays, streakDays, partStats, topExercises,
  dateLabel, shortDate, fmtTime
};
