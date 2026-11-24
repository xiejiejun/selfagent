// 「进步」tab 的纯计算：部位均衡雷达、e1RM 曲线、恢复倒计时、PR 时间线、趋势预测
const engine = require('./engine/index');
const stats = require('./stats');

const RADAR = [
  { k: '胸', parts: ['胸'] },
  { k: '背', parts: ['背'] },
  { k: '肩', parts: ['肩'] },
  { k: '臂', parts: ['上臂', '前臂'] },
  { k: '核心', parts: ['腰腹'] },
  { k: '腿', parts: ['上腿', '小腿'] }
];

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
}

function e1rmSeries(train, name, daysN) {
  const t = engine.ensureTrain(train);
  const byDay = {};
  (t.records || []).filter(r => r && r.name === name).forEach(r => {
    const gs = engine.ensureGroups(r).filter(g => g.done && !g.warmup && (g.weight || 0) > 0);
    if (!gs.length) return;
    const top = gs.reduce((a, g) => (stats.e1rm(g.weight, g.reps) > stats.e1rm(a.weight, a.reps) ? g : a), gs[0]);
    const e = stats.e1rm(top.weight, top.reps);
    if (!byDay[r.date] || e > byDay[r.date].e) byDay[r.date] = { date: r.date, e, w: top.weight, reps: top.reps };
  });
  const start = stats.shiftDay(engine.dayKey(), -(daysN - 1));
  return Object.keys(byDay).sort().filter(d => d >= start).map(d => byDay[d]);
}

// 线性回归：x = 距今天数（负数），y = e1RM
function regress(points) {
  if (points.length < 3) return null;
  const today = engine.dayKey();
  const xs = points.map(p => -daysBetween(p.date, today));
  const ys = points.map(p => p.e);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
  if (!sxx) return null;
  const slope = sxy / sxx;             // kg / 天
  const intercept = my - slope * mx;
  // R²
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssTot += (ys[i] - my) * (ys[i] - my);
    ssRes += (ys[i] - pred) * (ys[i] - pred);
  }
  const r2 = ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope, intercept, r2, n };
}

function forecast(train, daysN) {
  const curves = topCurves(train, daysN, 5).sort((a, b) => b.delta - a.delta);
  if (!curves.length) return null;
  const withReg = curves.map(c => ({ c, reg: regress(c.points) })).filter(x => x.reg);
  if (!withReg.length) return null;
  const up = withReg.filter(x => x.reg.slope > 0).sort((a, b) => b.c.delta - a.c.delta)[0];
  if (!up) {
    const best = withReg[0];
    return { name: best.c.name, ok: false, text: best.c.name + ' 近 ' + daysN + ' 天没有上升趋势，先稳住这个重量再加。', conf: '●○○' };
  }
  const c = up.c, reg = up.reg;
  const last = c.points[c.points.length - 1];
  const step = 2.5;
  const target = Math.ceil((last.e + 0.01) / step) * step;
  const need = target - last.e;
  const weeks = Math.max(1, Math.ceil(need / (reg.slope * 7)));
  const conf = reg.r2 >= 0.75 && reg.n >= 4 ? '●●●' : reg.r2 >= 0.45 ? '●●○' : '●○○';
  return {
    name: c.name, ok: true, target, weeks, last: last.e, slope: Math.round(reg.slope * 10) / 10,
    conf, r2: Math.round(reg.r2 * 100) / 100,
    text: '按当前趋势，' + target + 'kg 约 ' + weeks + ' 周后达成（每周 +' + Math.round(reg.slope * 7 * 10) / 10 + 'kg）'
  };
}

// Top N 动作的 e1RM 曲线（按训练次数/最近活跃排序）
function topCurves(train, daysN, n) {
  const t = engine.ensureTrain(train);
  const cnt = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date) return;
    const start = stats.shiftDay(engine.dayKey(), -(daysN - 1));
    if (r.date < start) return;
    const hasW = engine.ensureGroups(r).some(g => g.done && (g.weight || 0) > 0);
    if (!hasW) return;
    cnt[r.name] = (cnt[r.name] || 0) + 1;
  });
  const names = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, n || 5);
  return names.map(name => {
    const points = e1rmSeries(t, name, daysN);
    const first = points[0] || null;
    const last = points[points.length - 1] || null;
    return {
      name, points, n: points.length,
      from: first ? first.e : 0, to: last ? last.e : 0,
      delta: first && last ? Math.round((last.e - first.e) * 10) / 10 : 0
    };
  }).filter(c => c.points.length >= 2);
}

// 按部位统计「组数」：自重动作没有容量，组数才是真实训练量
function partSets(train, daysN) {
  const t = engine.ensureTrain(train);
  const start = stats.shiftDay(engine.dayKey(), -((daysN || 7) - 1));
  const map = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date || r.date < start) return;
    const k = r.part || '其他';
    const n = engine.ensureGroups(r).filter(g => g.done && !g.warmup).length;
    map[k] = (map[k] || 0) + n;
  });
  return map;
}

function radarOf(train, daysN) {
  const sets = partSets(train, daysN);
  const rows = RADAR.map(r => ({
    label: r.k,
    volume: r.parts.reduce((a, k) => a + (sets[k] || 0), 0)
  }));
  const max = Math.max(1, ...rows.map(r => r.volume));
  return rows.map(r => Object.assign(r, { pct: Math.round(r.volume / max * 100) }));
}

function pushPullOf(train, daysN) {
  const sets = partSets(train, daysN);
  const push = ['胸', '肩', '上臂'].reduce((a, k) => a + (sets[k] || 0), 0);
  const pull = ['背', '前臂'].reduce((a, k) => a + (sets[k] || 0), 0);
  const ratio = pull > 0 ? Math.round(push / pull * 10) / 10 : (push > 0 ? 99 : 0);
  let text = '还没有足够数据算推拉比';
  if (push && pull) {
    const r = push / pull;
    if (r >= 1.5) text = '推:拉 = ' + ratio + '，拉力偏少，建议加划船 / 引体';
    else if (r <= 0.67) text = '推:拉 = ' + ratio + '，推力偏少，建议加卧推 / 肩推';
    else text = '推:拉 = ' + ratio + '，比较均衡，保持';
  } else if (push || pull) {
    text = push ? '只有推力训练，建议补拉力（划船/引体）' : '只有拉力训练，建议补推力（卧推/肩推）';
  }
  return { push: Math.round(push), pull: Math.round(pull), ratio, text };
}

// 恢复倒计时：按每个部位最近一次训练距今小时
function recoveryOf(train) {
  const t = engine.ensureTrain(train);
  const last = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date) return;
    const k = r.part || '其他';
    if (!last[k] || r.date > last[k]) last[k] = r.date;
  });
  const now = engine.dayKey();
  return RADAR.map(r => {
    const ds = r.parts.map(k => last[k]).filter(Boolean);
    const recent = ds.length ? ds.sort().reverse()[0] : '';
    const h = recent ? Math.round((new Date(now + 'T00:00:00') - new Date(recent + 'T00:00:00')) / 36e5) : 999;
    let state = 'fresh', text = '还没练过';
    if (h < 24) { state = 'done'; text = h + 'h · 刚练完'; }
    else if (h < 48) { state = 'recovering'; text = h + 'h · 恢复中'; }
    else if (h < 999) { state = 'ready'; text = Math.floor(h / 24) + ' 天前 · 可练'; }
    return { label: r.k, h, state, text, date: recent };
  });
}

// 明日建议：恢复最久 + 近 7 天容量最低的部位
function tomorrowOf(train) {
  const rec = recoveryOf(train);
  const sets = partSets(train, 7);
  const volOfPart = r => r.label === '腿' ? (sets['上腿'] || 0) + (sets['小腿'] || 0)
    : r.label === '臂' ? (sets['上臂'] || 0) + (sets['前臂'] || 0)
      : (sets[r.label] || 0);
  const cand = rec.filter(r => r.state === 'ready' || r.state === 'fresh')
    .map(r => Object.assign({}, r, { v: volOfPart(r) }))
    .sort((a, b) => (a.v === b.v ? b.h - a.h : a.v - b.v));
  if (!cand.length) return { part: '', text: '所有部位都在恢复期，明天安排休息或轻有氧。' };
  const pick = cand[0];
  return { part: pick.label, text: '明天排「' + pick.label + '」最合理：近 7 天训练量最低，且已恢复 ' + (pick.h >= 999 ? '—' : Math.floor(pick.h / 24) + ' 天') };
}

function prTimeline(train, daysN) {
  const t = engine.ensureTrain(train);
  const end = engine.dayKey();
  const start = stats.shiftDay(end, -(daysN - 1));
  const r = stats.prInRange(t, start, end);
  const src = r.list.length ? r.list : (r.firsts || []);
  return src.slice(0, 8).map(p => ({
    name: p.name, part: p.part, weight: p.weight, reps: p.reps, e1rm: p.e1rm,
    prev: p.prev, date: p.date, label: engine.shortDate(p.date),
    up: p.prev ? Math.round((p.e1rm - p.prev) / p.prev * 100) : 0,
    first: !p.prev
  }));
}

function build(train, daysN) {
  const range = daysN || 30;
  const radar = radarOf(train, 7);
  const curves = topCurves(train, range, 5).sort((a, b) => b.delta - a.delta);
  const recovery = recoveryOf(train);
  const forecastInfo = forecast(train, range);
  const pushPull = pushPullOf(train, range);
  const prs = prTimeline(train, 30);
  const tomorrow = tomorrowOf(train);
  return { radar, curves, recovery, forecast: forecastInfo, pushPull, prs, tomorrow, range };
}

module.exports = { build, radarOf, topCurves, e1rmSeries, regress, forecast, pushPullOf, recoveryOf, tomorrowOf, prTimeline };
