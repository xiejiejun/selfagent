// 统计派生：PR 榜、梯度表、周报口径、部位分布
const engine = require('./engine/index');
function e1rm(w, reps) {
  if (!w) return 0;
  return Math.round(w * (1 + (reps || 1) / 30) * 10) / 10;
}

// 每个动作的最佳组（有重量按重量，自重按次数）
function prList(train) {
  const t = engine.ensureTrain(train);
  const map = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date) return;
    const gs = engine.ensureGroups(r);
    gs.forEach(g => {
      if (!g.done || g.warmup) return;
      const k = r.name || '未命名';
      if (!map[k]) map[k] = { name: k, part: r.part || '', bestW: 0, reps: 0, e1rm: 0, date: '', sets: 0, history: [] };
      const it = map[k];
      it.sets++;
      const w = g.weight || 0;
      const reps = g.reps || 0;
      const better = w > 0
        ? (w > it.bestW || (w === it.bestW && reps > it.reps))
        : (it.bestW === 0 && reps > it.reps);
      if (better) { it.bestW = w; it.reps = reps; it.date = r.date; it.e1rm = e1rm(w, reps); }
    });
  });
  // 梯度：按日期取每天最重的一组
  Object.keys(map).forEach(k => {
    const it = map[k];
    const byDay = {};
    (t.records || []).filter(r => r && r.name === k).forEach(r => {
      const gs = engine.ensureGroups(r).filter(g => g.done && !g.warmup);
      const top = gs.reduce((a, g) => ((g.weight || 0) > (a.weight || 0) ? g : a), gs[0] || null);
      if (top) byDay[r.date] = { date: r.date, weight: top.weight || 0, reps: top.reps || 0, vol: r.volume || 0 };
    });
    it.history = Object.keys(byDay).sort().map(d => byDay[d]).slice(-12);
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.e1rm - a.e1rm || b.sets - a.sets);
}

function weekRange(offsetWeeks) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - (offsetWeeks || 0) * 7);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { end: engine.dayKey(end), start: engine.dayKey(start) };
}

function weekStat(train, offsetWeeks) {
  const t = engine.ensureTrain(train);
  const r = weekRange(offsetWeeks);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(r.start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const dk = engine.dayKey(d);
    const s = engine.dayStat(t, dk);
    days.push({ date: dk, label: engine.shortDate(dk), sets: s.done, total: s.total, volume: s.volume, cardioMin: s.cardioMin, n: s.n });
  }
  const trained = days.filter(d => d.sets > 0 || d.cardioMin > 0).length;
  const sets = days.reduce((a, d) => a + d.sets, 0);
  const volume = Math.round(days.reduce((a, d) => a + d.volume, 0));
  const cardioMin = days.reduce((a, d) => a + d.cardioMin, 0);
  const names = {};
  days.forEach(d => {
    engine.dayItems(t, d.date).forEach(it => { if (it.type !== 'cardio' && it.sets) names[it.name] = (names[it.name] || 0) + it.sets; });
  });
  const prs = prList(t).filter(p => p.date >= r.start && p.date <= r.end);
  return { range: r, days, trained, sets, volume, cardioMin, prs, top: engine.topExercises(t, 7, 4), names: Object.keys(names) };
}

/* ---------- 运动数据四件套（记录 tab 用） ---------- */

const PART_ORDER = ['胸', '背', '肩', '上臂', '前臂', '腰腹', '上腿', '小腿'];
const PUSH_PARTS = ['胸', '肩', '上臂'];
const PULL_PARTS = ['背', '前臂'];

// 部位分布：按「组数」占比（自重动作没有容量，用组数才不丢）
function partDist(rs) {
  const vol = {}, sets = {};
  (rs || []).forEach(r => {
    const k = r.part || '其他';
    vol[k] = (vol[k] || 0) + volOf(r);
    sets[k] = (sets[k] || 0) + engine.ensureGroups(r).filter(g => g.done && !g.warmup).length;
  });
  const totalSets = Object.keys(sets).reduce((a, k) => a + sets[k], 0);
  const arr = Object.keys(sets).map(k => ({ part: k, volume: Math.round(vol[k]), sets: sets[k] }))
    .sort((a, b) => (b.sets - a.sets) || (b.volume - a.volume));
  return arr.map(p => {
    const pct = totalSets ? Math.round(p.sets / totalSets * 100) : 0;
    return Object.assign(p, { pct, low: arr.length >= 3 && pct < 10 });
  });
}

// 进步榜：本期首末 e1RM 涨幅 Top5（至少 2 个训练日）
function progressTop(rs, n) {
  const byEx = {};
  (rs || []).forEach(r => {
    if (!r || !r.date) return;
    const gs = engine.ensureGroups(r).filter(g => g.done && !g.warmup && (g.weight || 0) > 0);
    if (!gs.length) return;
    const top = gs.reduce((a, g) => (e1rm(g.weight, g.reps) > e1rm(a.weight, a.reps) ? g : a), gs[0]);
    const k = r.name || '未命名';
    if (!byEx[k]) byEx[k] = { name: k, part: r.part || '', first: null, last: null };
    const it = byEx[k];
    const e = e1rm(top.weight, top.reps);
    if (!it.first || r.date < it.first.date) it.first = { date: r.date, e: e, w: top.weight, reps: top.reps };
    if (!it.last || r.date > it.last.date) it.last = { date: r.date, e: e, w: top.weight, reps: top.reps };
  });
  const arr = Object.keys(byEx).map(k => byEx[k])
    .filter(x => x.first && x.last && x.first.date !== x.last.date && x.first.e > 0)
    .map(x => {
      const pct = Math.round((x.last.e - x.first.e) / x.first.e * 100);
      return {
        name: x.name, part: x.part,
        from: x.first.w, to: x.last.w, fromReps: x.first.reps, toReps: x.last.reps,
        fromE: x.first.e, toE: x.last.e, pct,
        text: x.first.w + '→' + x.last.w + 'kg', eText: x.first.e + '→' + x.last.e
      };
    })
    .filter(x => x.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  return arr.slice(0, n || 5);
}

// 有氧构成：按模态分钟占比
function cardioComp(cs) {
  const cardioLib = require('./cardio');
  const mins = {};
  (cs || []).forEach(c => {
    const m = cardioLib.modalOf(c.modal || c.name || '');
    mins[m] = (mins[m] || 0) + minOf(c);
  });
  const total = Object.keys(mins).reduce((a, k) => a + mins[k], 0);
  return Object.keys(mins).map(k => ({ label: k, min: Math.round(mins[k]), pct: total ? Math.round(mins[k] / total * 100) : 0 }))
    .sort((a, b) => b.min - a.min);
}

// 本期新增 PR：区间内最佳 e1RM 超过区间前历史最佳
function prInRange(train, start, end) {
  const t = engine.ensureTrain(train);
  const bestBefore = {};
  const inRange = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date) return;
    engine.ensureGroups(r).forEach(g => {
      if (!g.done || g.warmup) return;
      const e = e1rm(g.weight || 0, g.reps || 0);
      const k = r.name || '未命名';
      if (!e) return;
      if (r.date < start) { if (!bestBefore[k] || e > bestBefore[k].e) bestBefore[k] = { e, date: r.date, w: g.weight }; return; }
      if (r.date > end) return;
      if (!inRange[k] || e > inRange[k].e) inRange[k] = { e, date: r.date, w: g.weight || 0, reps: g.reps || 0, part: r.part || '' };
    });
  });
  const list = [];
  const firsts = [];
  Object.keys(inRange).forEach(k => {
    const it = inRange[k];
    const prev = bestBefore[k] ? bestBefore[k].e : 0;
    const row = { name: k, part: it.part, e1rm: it.e, date: it.date, prev, weight: it.w, reps: it.reps };
    if (prev > 0) {
      if (it.e > prev) list.push(row);
    } else {
      firsts.push(row);
    }
  });
  list.sort((a, b) => (b.date > a.date ? 1 : -1));
  firsts.sort((a, b) => (b.date > a.date ? 1 : -1));
  return { count: list.length, list, firsts };
}

/* ---------- 区间统计（对应网页版「统计」tab） ---------- */
const settings = require('./settings');

function shiftDay(k, n) {
  const d = new Date(k + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return engine.dayKey(d);
}

function dayList(start, end) {
  const out = [];
  let k = start;
  let guard = 0;
  while (k <= end && guard < 400) { out.push(k); k = shiftDay(k, 1); guard++; }
  return out;
}

function volOf(r) {
  if (!r) return 0;
  const gs = (r.groups && r.groups.length) ? r.groups : engine.ensureGroups(r);
  return gs.filter(g => g.done && !g.warmup).reduce((a, g) => a + (g.reps || 0) * (g.weight || 0), 0);
}

function minOf(c) {
  if (!c) return 0;
  return c.min || c.dur || Math.round((c.sec || 0) / 60) || 0;
}

function slice(train, logs, start, end) {
  const lg = (logs || []).filter(l => l && l.kind !== 'train' && (l.date || '') >= start && (l.date || '') <= end);
  const rs = ((train && train.records) || []).filter(r => r && r.date >= start && r.date <= end);
  const cs = ((train && train.cardio) || []).filter(c => c && !c.skipped && c.date >= start && c.date <= end);
  return { lg, rs, cs };
}

function agg(o) {
  const avg = k => {
    const v = o.lg.filter(x => typeof x[k] === 'number' && x[k] > 0).map(x => x[k]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sets = o.rs.reduce((a, r) => {
    const gs = (r.groups && r.groups.length) ? r.groups : engine.ensureGroups(r);
    return a + gs.filter(g => g.done).length;
  }, 0);
  return {
    count: o.lg.length, sets,
    vol: Math.round(o.rs.reduce((a, r) => a + volOf(r), 0)),
    mins: o.cs.reduce((a, c) => a + minOf(c), 0),
    avg: avg('score'), mood: avg('mood'), lg: o.lg, rs: o.rs, cs: o.cs
  };
}

function deltaOf(cur, prev, kind) {
  if (cur == null || prev == null) return { txt: '—', cls: 'flat' };
  if (kind === 'avg') {
    const v = Math.round((cur - prev) * 10) / 10;
    return { txt: (v >= 0 ? '+' : '') + v, cls: v > 0 ? 'up' : v < 0 ? 'down' : 'flat' };
  }
  if (!prev) return cur > 0 ? { txt: '新', cls: 'up' } : { txt: '—', cls: 'flat' };
  const pct = Math.round((cur - prev) / prev * 100);
  return { txt: (pct >= 0 ? '+' : '') + pct + '%', cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

function rangeStats(train, logs, mode, custom) {
  let start, end;
  if (mode === 'custom' && custom && custom.start && custom.end) {
    start = custom.start < custom.end ? custom.start : custom.end;
    end = custom.start < custom.end ? custom.end : custom.start;
  } else {
    const n = mode === 7 ? 7 : mode === 90 ? 90 : 30;
    end = engine.dayKey();
    start = shiftDay(end, -(n - 1));
  }
  const daysN = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 864e5) + 1;
  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(start, -daysN);
  const cur = agg(slice(train, logs, start, end));
  const prev = agg(slice(train, logs, prevStart, prevEnd));
  const days = dayList(start, end);

  const dayKeys = {};
  cur.rs.forEach(r => { if (volOf(r) > 0) dayKeys[r.date] = true; });
  cur.cs.forEach(c => { if (minOf(c) > 0) dayKeys[c.date] = true; });
  const trainedDays = Object.keys(dayKeys).length;
  const prevDayKeys = {};
  prev.rs.forEach(r => { if (volOf(r) > 0) prevDayKeys[r.date] = true; });
  prev.cs.forEach(c => { if (minOf(c) > 0) prevDayKeys[c.date] = true; });

  const kpis = [
    { l: '训练组数', v: cur.sets, u: '组', d: deltaOf(cur.sets, prev.sets) },
    { l: '训练次数', v: trainedDays, u: '次', d: deltaOf(trainedDays, Object.keys(prevDayKeys).length) },
    { l: '容量', v: cur.vol.toLocaleString(), u: 'kg', d: deltaOf(cur.vol, prev.vol) },
    { l: '有氧', v: cur.mins, u: '分钟', d: deltaOf(cur.mins, prev.mins) }
  ];

  const per = {};
  days.forEach(k => { per[k] = { s: [], m: [] }; });
  cur.lg.forEach(l => {
    const k = l.date || '';
    if (!per[k]) return;
    if (+l.score > 0) per[k].s.push(+l.score);
    if (+l.mood > 0) per[k].m.push(+l.mood);
  });
  const energy = days.map(k => {
    const a = per[k].s;
    return { label: k.slice(5), v: a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null };
  });
  const mood = days.map(k => {
    const a = per[k].m;
    return { label: k.slice(5), v: a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null };
  });

  const slots = [0, 0, 0, 0, 0, 0];
  const grid = [[], [], [], [], [], [], []].map(() => [0, 0, 0, 0, 0, 0]);
  let maxCell = 0;
  cur.lg.forEach(l => {
    const d = new Date(l.time || '');
    if (isNaN(d.getTime())) return;
    const wd = (d.getDay() + 6) % 7;
    const si = Math.min(5, Math.floor(d.getHours() / 4));
    grid[wd][si]++;
    slots[si]++;
    if (grid[wd][si] > maxCell) maxCell = grid[wd][si];
  });
  const heat = grid.map((row, i) => ({
    label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
    cells: row.map(c => ({ n: c, lv: c ? Math.min(4, 1 + Math.round((c / Math.max(1, maxCell)) * 3)) : 0 }))
  }));
  const topSlot = slots.indexOf(Math.max.apply(null, slots));

  const comp = [];
  settings.types().forEach(t => {
    const c = cur.lg.filter(l => l.type === t.key).length;
    if (c) comp.push({ label: t.label, n: c, color: settings.colorFor(t.key), pct: Math.round(c / Math.max(1, cur.count) * 100) });
  });
  comp.sort((a, b) => b.n - a.n);

  const tagCnt = {};
  cur.lg.forEach(l => String(l.tags || '').split(/[,，、\s]+/).filter(Boolean).forEach(t => { tagCnt[t] = (tagCnt[t] || 0) + 1; }));
  const tags = Object.keys(tagCnt).sort((a, b) => tagCnt[b] - tagCnt[a]).slice(0, 5)
    .map(t => ({ label: t, n: tagCnt[t], pct: Math.round(tagCnt[t] / Math.max(1, cur.count) * 100) }));

  const byWeek = days.length > 45;
  const order = [];
  const bucket = {};
  const keyOf = ds => {
    if (!byWeek) return ds;
    const d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return engine.dayKey(d);
  };
  days.forEach(k => {
    const key = keyOf(k);
    if (!bucket[key]) { bucket[key] = { vol: 0, min: 0 }; order.push(key); }
  });
  cur.rs.forEach(r => { const k = keyOf(r.date); if (bucket[k]) bucket[k].vol += volOf(r); });
  cur.cs.forEach(c => { const k = keyOf(c.date); if (bucket[k]) bucket[k].min += minOf(c); });
  const maxVol = Math.max(1, ...order.map(k => bucket[k].vol));
  const maxMin = Math.max(1, ...order.map(k => bucket[k].min));
  const load = order.map(k => {
    const v = Math.round(bucket[k].vol), m = Math.round(bucket[k].min);
    return { label: byWeek ? '周' + k.slice(5) : k.slice(5), vol: v, min: m, vh: Math.round(v / maxVol * 100), mh: Math.round(m / maxMin * 100) };
  });

  let noteE = cur.avg == null ? '暂无精力记录' : '平均精力 ' + cur.avg.toFixed(1);
  const lows = energy.filter(x => x.v != null);
  if (lows.length) {
    let low = lows[0];
    lows.forEach(x => { if (x.v < low.v) low = x; });
    noteE += '，最低 ' + low.label + ' ' + low.v.toFixed(1);
  }
  if (cur.mood != null) noteE += ' · 平均情绪 ' + cur.mood.toFixed(1);
  const totalNote = slots.reduce((a, b) => a + b, 0);
  const noteClock = cur.lg.length
    ? '记录集中在 ' + (topSlot * 4) + '–' + (topSlot * 4 + 4) + ' 点（占 ' + Math.round(slots[topSlot] / Math.max(1, totalNote) * 100) + '%）'
    : '该时段还没有记录';
  const noteComp = '类型 ' + comp.length + ' 类 · 标签 ' + tags.length + ' 个，合计 ' + cur.count + ' 条';
  const noteLoad = '容量 ' + cur.vol.toLocaleString() + ' kg' + (cur.mins ? ' · 有氧 ' + cur.mins + ' 分钟' : '') + (byWeek ? ' · 按周汇总' : '');

  const prs = prInRange(train, start, end);
  const partsDist = partDist(cur.rs);
  const progress = progressTop(cur.rs, 5);
  const cdComp = cardioComp(cur.cs);
  const noteParts = partsDist.length
    ? '主力 ' + partsDist[0].part + ' ' + partsDist[0].pct + '%' + (partsDist.filter(p => p.low).length ? ' · 偏少 ' + partsDist.filter(p => p.low).map(p => p.part).join('/') : '')
    : '这段还没有力量训练';  const noteProgress = progress.length ? '涨幅最大 ' + progress[0].name + ' ' + (progress[0].pct >= 0 ? '+' : '') + progress[0].pct + '%' : '至少练同个动作两次才出涨幅';
  const noteCd = cdComp.length ? cdComp.map(c => c.label + ' ' + c.pct + '%').slice(0, 3).join(' · ') : '这段还没有有氧';
  const notePr = prs.count ? '本期新增 ' + prs.count + ' 个 PR' : '本期还没有新 PR';

  return {
    mode, start, end, days: days.length, kpis, energy, mood, heat, comp, tags, load,
    parts: partsDist, progress, cdComp, prs, trainedDays, prevTrainedDays: Object.keys(prevDayKeys).length,
    noteE, noteClock, noteComp, noteLoad, noteParts, noteProgress, noteCd, notePr,
    empty: !cur.count && !cur.rs.length && !cur.cs.length,
    cur, prev
  };
}

module.exports = { prList, weekStat, weekRange, e1rm, rangeStats, dayList, shiftDay, partDist, progressTop, cardioComp, prInRange };