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

/* ---------------- 单侧（每侧）动作 ---------------- */
// 名称命中即视为单侧：单臂/单腿/单侧/单脚/单边/保加利亚/交替
const UNI_RE = /单臂|单腿|单侧|单脚|单边|保加利亚|交替/;

function isUniName(name) {
  return UNI_RE.test(String(name || ''));
}

// 记录级单侧标记：新记录看 r.uni；老记录看组上的「每侧」tag；再退回名称识别
function uniOf(r) {
  if (!r) return false;
  if (typeof r.uni === 'boolean') return r.uni;
  if (Array.isArray(r.groups) && r.groups.some(g => g && g.tag === 'side')) return true;
  return isUniName(r.name);
}

// 单组容量：左右分开记时按左+右重量，否则按每侧重量 ×2（单侧动作左右各做一遍）
function setVolume(g, uni) {
  if (!g) return 0;
  const reps = Number(g.reps) || 0;
  if (g.lw != null || g.rw != null) return ((Number(g.lw) || 0) + (Number(g.rw) || 0)) * reps;
  return (Number(g.weight) || 0) * reps * (uni ? 2 : 1);
}

// 重量文案：单侧动作带「/侧」
function wText(w, uni) {
  const v = Number(w) || 0;
  if (v <= 0) return '自重';
  return v + 'kg' + (uni ? '/侧' : '');
}

/* ---------------- 装配 ---------------- */

/* ---------------- 部位归属 ---------------- */
// 历史数据里「悬垂卷腹 / 龙门架卷腹」这类自建或导入的动作，part 常被写错（背/胸/上腿/其他），
// 只按存的 part 统计会把核心训练整段判成没练。这里按名称做一次归位：
// 1) 动作库同名动作的部位（权威） 2) 自建动作的部位 3) 名称含核心词 → 腰腹 4) 原始 part
const LIB_DATA = require('../data/lib');
let LIB_PART = null;
function libPartOf(name) {
  if (!LIB_PART) {
    LIB_PART = {};
    LIB_DATA.forEach(r => { if (r && r[1] && !LIB_PART[String(r[1]).trim()]) LIB_PART[String(r[1]).trim()] = r[2] || ''; });
  }
  return LIB_PART[String(name || '').trim()] || '';
}
const CORE_RE = /卷腹|平板支撑|平板撑|举腿|抬腿|仰卧起坐|侧屈|两头起|登山跑|死虫|核心/;
function partForName(train, name, fallback) {
  const n = String(name || '').trim();
  const lp = libPartOf(n);
  if (lp) return lp;
  const hit = ((train && train.custom) || []).find(x => x && String(x.n || x.name || '').trim() === n);
  if (hit) return hit.p || hit.part || fallback || '';
  if (CORE_RE.test(n)) return '腰腹';
  return fallback || '';
}

function stDayItems(train, dk) {
  return ensureTrain(train).records.filter(r => r && r.date === dk).map(r => {
    const gs = ensureGroups(r);
    const part = partForName(train, r.name, r.part);
    const uni = uniOf(r);
    const done = gs.filter(g => g.done).length;
    const vol = gs.filter(g => g.done && !g.warmup).reduce((a, g) => a + setVolume(g, uni), 0);
    const pick = k => {
      const arr = gs.filter(g => (g[k] || 0) > 0 && !g.warmup);
      const v = arr.slice(-1)[0] || gs.filter(g => (g[k] || 0) > 0).slice(-1)[0];
      return v ? v[k] : 0;
    };
    return {
      type: 'strength', uid: r.uid || '', exId: r.exId, name: r.name, part,
      ord: typeof r.ord === 'number' ? r.ord : null,
      sets: gs.length, reps: pick('reps'), weight: pick('weight'), done, uni,
      volume: Math.round(vol),
      groups: gs.map(g => ({ no: g.no, reps: g.reps, weight: g.weight, lw: g.lw, rw: g.rw, done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, tag: g.tag || '', uid: g.uid || '' }))
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
    const uni = uniOf(c);
    const doneN = gs.filter(g => g.done).length;
    const vol = gs.filter(g => g.done && !g.warmup).reduce((a, g) => a + setVolume(g, uni), 0);
    return {
      type: 'cardio', mode, name: c.modal || c.name || '有氧',
      exId: c.exId || '',
      part: c.part || '有氧',
      min: mode === 'sets' ? 0 : min,
      sets: gs.length, reps: gs.length ? (gs[gs.length - 1].reps || 0) : 0,
      weight: gs.length ? (gs[gs.length - 1].weight || 0) : 0,
      volume: Math.round(vol),
      uni,
      done: mode === 'sets' ? (gs.length > 0 && doneN === gs.length) : !!c.done,
      doneN: mode === 'sets' ? doneN : ((c.done ? 1 : 0)),
      totalN: mode === 'sets' ? gs.length : 1,
      dist: Number(c.dist) || 0,
      groups: gs.map(g => ({ no: g.no, reps: g.reps, weight: g.weight, lw: g.lw, rw: g.rw, done: !!g.done, warmup: !!g.warmup, rpe: g.rpe || 0, sec: g.sec || 0, tag: g.tag || '', uid: g.uid || '' })),
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

function groupLine(groups, uni) {
  const a = (groups || []).filter(g => !g.warmup);
  if (!a.length) return '';
  const lr = g => g.lw != null || g.rw != null;
  const one = g => lr(g)
    ? 'L' + (Number(g.lw) || 0) + ' R' + (Number(g.rw) || 0) + 'kg×' + (g.reps || 0)
    : wText(g.weight, uni) + '×' + (g.reps || 0);
  const same = a.every(g => (g.weight || 0) === (a[0].weight || 0) && (g.reps || 0) === (a[0].reps || 0)
    && (g.lw || 0) === (a[0].lw || 0) && (g.rw || 0) === (a[0].rw || 0));
  const secs = a.filter(g => g.sec > 0);
  const tail = secs.length ? ' · ' + fmtSec(secs.reduce((x, g) => x + g.sec, 0)) : '';
  if (same) {
    const head = lr(a[0])
      ? 'L' + (Number(a[0].lw) || 0) + ' R' + (Number(a[0].rw) || 0) + 'kg'
      : wText(a[0].weight, uni);
    return head + ' ' + a.length + '×' + (a[0].reps || 0) + tail;
  }
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
  // 有氧只报总时长，不再逐个动作名拼接（名称+分钟拼在一行容易读成乱码）
  const cdTimer = s.cardio.filter(c => c.mode !== 'sets' && (c.min || 0) > 0);
  const cdMin = cdTimer.reduce((a, c) => a + (c.min || 0), 0);
  const cdKm = s.cardio.reduce((a, c) => a + (c.dist || 0), 0);
  const cdSets = s.cardio.filter(c => c.mode === 'sets');
  const cdSetsN = cdSets.reduce((a, c) => a + (c.sets || (c.groups || []).length || 0), 0);
  let cd = '';
  if (cdMin) cd += ' · 有氧 ' + cdMin + '′';
  if (cdSetsN) cd += ' · 有氧 ' + cdSetsN + ' 组';
  if (cdKm) cd += ' · ' + (Math.round(cdKm * 10) / 10) + 'km';
  const head = s.total ? (s.n + ' 动作 · ' + s.done + '/' + s.total + ' 组') : (s.n ? (s.n + ' 项有氧') : '无记录');
  return head + cd + ' · ' + (s.volume ? s.volume.toLocaleString() + ' kg' : '—');
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
const TOMB_MAX = 200;

function addTomb(tomb, kind, uidVal) {
  const arr = Array.isArray(tomb) ? tomb : [];
  const rest = arr.filter(t => !(t && t.u === uidVal && t.k === kind));
  rest.push({ k: kind, u: uidVal, t: Date.now() });
  return rest;
}

function pruneTomb(tomb, maxAgeMs) {
  const now = Date.now();
  const max = maxAgeMs || 90 * 24 * 3600 * 1000;
  const list = (Array.isArray(tomb) ? tomb : []).filter(t => t && now - (t.t || 0) < max);
  // 只留最近 200 条：墓碑发完就摘掉，正常不会攒到这个数；攒到说明推送一直在失败
  return list.length > TOMB_MAX ? list.slice(-TOMB_MAX) : list;
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
      if (!map[k]) map[k] = { part: k, volume: 0, sets: 0 };
      map[k].volume += it.volume || 0;
      // 完成的组数：自重动作容量为 0，只有组数能证明这块练过
      map[k].sets += it.done || 0;
    });
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.volume - a.volume);
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
  isUniName, uniOf, setVolume, wText,
  stDayItems, cdDayItems, dayItems, dayContent,
  groupLine, summarize, summaryText, fmtSec,
  upsertRecord, removeRecord, upsertCardio, removeCardio,
  addTomb, pruneTomb,
  buildTrainLog, syncTrainLog, dedupeLogs,
  dayStat, lastNDays, streakDays, partStats, topExercises, partForName,
  dateLabel, shortDate, fmtTime
};
