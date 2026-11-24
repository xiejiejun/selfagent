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
      ord: typeof r.ord === 'number' ? r.ord : null,
      sets: gs.length, reps: pick('reps'), weight: pick('weight'), done,
      volume: Math.round(vol),
      groups: gs.map(g => ({ no: g.no, reps: g.reps, weight: g.weight, done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, uid: g.uid || '' }))
    };
  });
}

// 有氧两种计组方式：timer（按时长）/ sets（按组，和力量同构）
function cardioMode(c) { return c && c.mode === 'sets' ? 'sets' : 'timer'; }

function cdDayItems(train, dk) {
  return ensureTrain(train).cardio.filter(c => c && c.date === dk && !c.skipped).map(c => {
    const mode = cardioMode(c);
    const min = c.min || c.dur || Math.round((c.sec || 0) / 60) || 0;
    const gs = mode === 'sets' ? ensureGroups(c) : [];
    const doneN = gs.filter(g => g.done).length;
    const vol = gs.filter(g => g.done && !g.warmup).reduce((a, g) => a + (g.reps || 0) * (g.weight || 0), 0);
    return {
      type: 'cardio', mode, name: c.modal || c.name || '有氧',
      exId: c.exId || '',
      part: c.part || '有氧',
      min: mode === 'sets' ? 0 : min,
      sets: gs.length, reps: gs.length ? (gs[gs.length - 1].reps || 0) : 0,
      weight: gs.length ? (gs[gs.length - 1].weight || 0) : 0,
      volume: Math.round(vol),
      done: mode === 'sets' ? (gs.length > 0 && doneN === gs.length) : !!c.done,
      doneN: mode === 'sets' ? doneN : ((c.done ? 1 : 0)),
      totalN: mode === 'sets' ? gs.length : 1,
      dist: Number(c.dist) || 0,
      groups: gs.map(g => ({ no: g.no, reps: g.reps, weight: g.weight, done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, uid: g.uid || '' })),
      uid: c.uid || '',
      ord: typeof c.ord === 'number' ? c.ord : null
    };
  });
}

// 力量与有氧统一按 ord（用户拖拽出来的顺序）排列；老数据没有 ord 时保持「力量在前、有氧在后」
function dayItems(train, dk) {
  const all = stDayItems(train, dk).concat(cdDayItems(train, dk));
  if (!all.some(i => typeof i.ord === 'number')) return all;
  return all
    .map((it, k) => ({ it, k }))
    .sort((a, b) => {
      const ao = typeof a.it.ord === 'number' ? a.it.ord : 1e6 + a.k;
      const bo = typeof b.it.ord === 'number' ? b.it.ord : 1e6 + b.k;
      return ao - bo;
    })
    .map(x => x.it);
}

function dayContent(items) {
  const st = (items || []).filter(i => i.type !== 'cardio').map(i => i.name);
  const cd = (items || []).filter(i => i.type === 'cardio').map(i => {
    const km = (i.dist || 0) > 0 ? ' ' + i.dist + 'km' : '';
    if (i.mode === 'sets') return i.name + (i.sets ? ' ' + i.sets + '×' + (i.reps || 0) : '') + km;
    return i.name + (i.min ? ' ' + i.min + 'min' : '') + km;
  });
  return st.concat(cd).join('、');
}

/* ---------------- 文案 ---------------- */

function fmtSec(sec) {
  const s = Math.round(sec || 0);
  if (!s) return '';
  return s >= 60 ? Math.floor(s / 60) + '′' + pad2(s % 60) + '″' : s + '″';
}

function groupLine(groups) {
  const a = (groups || []).filter(g => !g.warmup);
  if (!a.length) return '';
  const one = g => (g.weight > 0 ? g.weight + 'kg' : '自重') + '×' + (g.reps || 0);
  const same = a.every(g => (g.weight || 0) === (a[0].weight || 0) && (g.reps || 0) === (a[0].reps || 0));
  const secs = a.filter(g => g.sec > 0);
  const tail = secs.length ? ' · ' + fmtSec(secs.reduce((x, g) => x + g.sec, 0)) : '';
  if (same) return (a[0].weight > 0 ? a[0].weight + 'kg' : '自重') + ' ' + a.length + '×' + (a[0].reps || 0) + tail;
  const parts = a.map(one);
  const line = parts.length > 3 ? parts.slice(0, 3).join(' · ') + ' · +' + (parts.length - 3) : parts.join(' · ');
  return line + tail;
}

function summarize(items) {
  const all = items || [];
  const cardio = all.filter(i => i.type === 'cardio');
  const cdSets = cardio.filter(i => i.mode === 'sets');
  const strength = all.filter(i => i.type !== 'cardio').concat(cdSets);
  let done = 0, total = 0;
  strength.forEach(it => {
    const gs = it.groups || [];
    total += gs.length || it.sets || 0;
    done += gs.length ? gs.filter(g => g.done).length : (it.done ? 1 : 0);
  });
  const volume = Math.round(strength.reduce((a, i) => a + (i.volume || 0), 0));
  const cardioMin = cardio.filter(i => i.mode !== 'sets').reduce((a, i) => a + (i.min || 0), 0);
  return { n: all.length, done, total, volume, cardio, cardioMin };
}

function summaryText(items) {
  const s = summarize(items);
  const cd = s.cardio.length
    ? ' · 有氧 ' + s.cardio.map(c => {
      const km = (c.dist || 0) > 0 ? ' · ' + c.dist + 'km' : '';
      return (c.mode === 'sets' ? (c.name + ' ' + c.sets + '×' + (c.reps || 0)) : (c.name + ' ' + c.min + '′')) + km;
    }).join('、')
    : '';
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
  const cardioMin = s.cardioMin;
  const cardioSets = s.cardio.filter(c => c.mode === 'sets').reduce((a, c) => a + (c.totalN || 0), 0);
  return { date: dk, n: s.n, done: s.done, total: s.total, volume: s.volume, cardioMin, cardioSets, items };
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
    if (s.volume > 0 || s.cardioMin > 0 || s.cardioSets > 0) n++;
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
  groupLine, summarize, summaryText, fmtSec,
  upsertRecord, removeRecord, upsertCardio, removeCardio,
  addTomb, pruneTomb,
  buildTrainLog, syncTrainLog, dedupeLogs,
  dayStat, lastNDays, streakDays, partStats, topExercises,
  dateLabel, shortDate, fmtTime
};
