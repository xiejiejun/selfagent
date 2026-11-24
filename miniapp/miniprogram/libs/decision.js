// 决策层：把「规则算出的选项」摆到用户面前（L2），必要时经授权自动执行（L3）。
// 纯计算 + 存储：不涉及界面跳转，页面拿到结果后自己执行 action。
const engine = require('./engine/index');
const store = require('./store/index');
const settings = require('./settings');
const recommend = require('./recommend');
const progress = require('./progress');
const stats = require('./stats');
const actions = require('./actions');

const REST_KEY = 'selfagent_rest_days_v1';
const OPS_KEY = 'selfagent_ai_ops_v1';
const AUTO_KEY = 'selfagent_ai_auto_v1';

/* ---------- 休息日 ---------- */
function restDays() {
  try { return wx.getStorageSync(REST_KEY) || []; } catch (e) { return []; }
}

function setRestDays(list) {
  const arr = (list || []).filter(Boolean).sort().slice(-400);
  try { wx.setStorageSync(REST_KEY, arr); } catch (e) {}
  return arr;
}

function isRest(dk) {
  return restDays().indexOf(dk || engine.dayKey()) >= 0;
}

function markRest(dk, on) {
  const date = dk || engine.dayKey();
  const cur = restDays();
  const has = cur.indexOf(date) >= 0;
  if (on === false) {
    if (has) setRestDays(cur.filter(d => d !== date));
    addOp({ key: 'rest', title: '取消休息日', desc: engine.shortDate(date) + ' · 恢复为普通日', undo: { kind: 'rest', date, on: true } });
    return false;
  }
  if (!has) setRestDays(cur.concat([date]));
  addOp({ key: 'rest', title: '标记休息日', desc: engine.shortDate(date) + ' · 连续记录已保护', undo: { kind: 'rest', date, on: false } });
  return true;
}

// 连续天数：休息日算「不断档」，但不加天数
function streak(train) {
  let n = 0;
  const today = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dk = engine.dayKey(d);
    const s = engine.dayStat(train, dk);
    const trained = s.volume > 0 || s.cardioMin > 0 || s.cardioSets > 0;
    if (trained) { n++; continue; }
    if (isRest(dk)) continue;
    if (i > 0) break;
  }
  return n;
}

/* ---------- 操作日志（AI 动过什么，可撤销） ---------- */
function ops() {
  try { return wx.getStorageSync(OPS_KEY) || []; } catch (e) { return []; }
}

function setOps(list) {
  try { wx.setStorageSync(OPS_KEY, (list || []).slice(0, 60)); } catch (e) {}
}

function addOp(op) {
  const rec = Object.assign({ id: engine.uid('op'), at: Date.now(), auto: !!op.auto }, op || {});
  setOps([rec].concat(ops()));
  return rec;
}

function undoTip(u) {
  if (!u) return '';
  if (u.kind === 'rest') return '休息日';
  if (u.kind === 'items') return (u.ids || []).length + ' 个动作';
  if (u.kind === 'plan') return '下周排布';
  return '一条改动';
}

function undo(id) {
  const list = ops();
  const op = list.find(x => x && x.id === id);
  if (!op || !op.undo) return { ok: false };
  const u = op.undo;
  if (u.kind === 'rest') {
    const cur = restDays();
    setRestDays(u.on ? cur.concat([u.date]) : cur.filter(d => d !== u.date));
  } else if (u.kind === 'items') {
    (u.ids || []).forEach(uid => actions.deleteStrength(uid, u.date || engine.dayKey()));
    (u.cids || []).forEach(uid => actions.deleteCardio(uid, u.date || engine.dayKey()));
  } else if (u.kind === 'plan') {
    const s = store.getSettings() || {};
    s.plan = Object.assign({}, s.plan, u.prev || {});
    store.setSettings(s);
  }
  setOps(list.map(x => (x && x.id === id) ? Object.assign({}, x, { undone: true }) : x));
  return { ok: true, tip: undoTip(u) };
}

function clearOps() { setOps([]); }

/* ---------- 授权（L3） ---------- */
function autoOn() {
  const s = store.getSettings() || {};
  return !!(s.ai && s.ai.agentAuto);
}

function setAuto(v) {
  const s = store.getSettings() || {};
  s.ai = s.ai || {};
  s.ai.agentAuto = !!v;
  store.setSettings(s);
  return s.ai.agentAuto;
}

function autoDone(dk) {
  try {
    const st = wx.getStorageSync(AUTO_KEY) || {};
    return st[dk || engine.dayKey()] || '';
  } catch (e) { return ''; }
}

function setAutoDone(kind, dk) {
  const date = dk || engine.dayKey();
  try {
    const st = wx.getStorageSync(AUTO_KEY) || {};
    st[date] = kind;
    const keys = Object.keys(st).sort();
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => { delete st[k]; });
    wx.setStorageSync(AUTO_KEY, st);
  } catch (e) {}
}

/* ---------- 时刻 1：今日简报 ---------- */
function gapOf(train, part) {
  let last = '';
  (train.records || []).forEach(r => { if (r && r.date && (r.part === part || (r.part === '' && r.name))) { if (r.date > last) last = r.date; } });
  (train.cardio || []).forEach(c => { if (c && c.date) { if (c.date > last) last = c.date; } });
  if (!last) return { h: 999, days: 0, text: '还没练过' };
  const h = Math.round((new Date(engine.dayKey() + 'T00:00:00') - new Date(last + 'T00:00:00')) / 36e5);
  return { h, days: Math.floor(h / 24), text: h < 24 ? '今天练过' : Math.floor(h / 24) + ' 天前' };
}

function lastPartTrain(train) {
  let last = null;
  (train.records || []).forEach(r => { if (r && r.date && r.part && r.part !== '有氧') { if (!last || r.date > last.date) last = { date: r.date, part: r.part }; } });
  (train.cardio || []).forEach(c => { if (c && c.date) { if (!last || c.date > last.date) last = { date: c.date, part: '有氧' }; } });
  return last;
}

// 今日简报：三个可执行选项 + 数字依据
function daily(train, logs, custom) {
  const t = engine.ensureTrain(train);
  const today = engine.dayKey();
  const st = engine.dayStat(t, today);
  const week = engine.lastNDays(t, 7);
  const weekTrain = week.filter(d => d.volume > 0 || d.cardioMin > 0 || d.cardioSets > 0).length;
  const plan = (store.getSettings() || {}).plan || {};
  const goalDays = Number(plan.days) || 3;

  if (st.n > 0 || st.cardioMin > 0) {
    return {
      key: 'daily', done: true,
      question: '今天已经开练了',
      reason: st.done + '/' + st.total + ' 组、' + st.volume + ' kg，练完再回来排明天。',
      options: [{ key: 'go', label: '继续今天', sub: st.done + '/' + st.total + ' 组', rec: true }],
      evidence: [{ t: '今日', v: st.done + ' 组 ' + st.volume + 'kg' }, { t: '本周', v: weekTrain + '/' + goalDays + ' 天' }]
    };
  }
  if (isRest(today)) {
    return {
      key: 'daily', restDay: true,
      question: '今天是休息日',
      reason: '已标记休息，连续 ' + streak(t) + ' 天不会断。想动就选轻有氧。',
      options: [
        { key: 'cardio', label: '改成轻有氧', sub: '主动恢复 30′', rec: false },
        { key: 'unrest', label: '取消休息', sub: '照常安排训练', rec: false }
      ],
      evidence: [{ t: '连续', v: streak(t) + ' 天' }, { t: '本周', v: weekTrain + '/' + goalDays + ' 天' }]
    };
  }

  const pick = recommend.pickPart(t);           // 恢复最久的部位
  const gap = gapOf(t, pick.part);
  const last = lastPartTrain(t);
  // 近 7 天组数最低的部位（排除刚练的）
  const sets7 = {};
  t.records.forEach(r => {
    if (!r || !r.date || r.date < stats.shiftDay(today, -6)) return;
    const k = r.part || '其他';
    sets7[k] = (sets7[k] || 0) + engine.ensureGroups(r).filter(g => g.done && !g.warmup).length;
  });
  const weakest = Object.keys(sets7).sort((a, b) => (sets7[a] === sets7[b] ? 0 : sets7[a] < sets7[b] ? -1 : 1))[0];
  const pickItems = recommend.genPlan(pick.part, t, custom || []);
  const partView = recommend.PART_LIST.indexOf(pick.part) >= 0 ? pick.part : pick.part;

  const reasonBits = [];
  reasonBits.push(pick.part + ' ' + (gap.h >= 999 ? '还没练过' : '已 ' + gap.days + ' 天未练'));
  if (last) {
    const lg = gapOf(t, last.part);
    if (lg.h < 48) reasonBits.push(last.part + ' ' + lg.h + 'h 前刚练完');
  }
  if (weekTrain < goalDays) reasonBits.push('本周 ' + weekTrain + '/' + goalDays + ' 天');

  const evidence = [
    { t: pick.part, v: gap.h >= 999 ? '未练过' : (gap.days ? gap.days + ' 天未练' : '今天练过') },
    { t: '本周', v: weekTrain + '/' + goalDays + ' 天' }
  ];
  if (last) evidence.push({ t: last.part, v: gapOf(t, last.part).h + 'h 前' });
  if (weakest && weakest !== pick.part) evidence.push({ t: '最弱', v: weakest + ' ' + (sets7[weakest] || 0) + ' 组' });

  return {
    key: 'daily',
    part: pick.part,
    question: '今天练什么？',
    reason: reasonBits.join(' · '),
    options: [
      { key: 'plan', label: pick.part + '日计划', sub: pickItems.length + ' 个动作 · 约 ' + (pickItems.length * 3) + ' 组', rec: true },
      { key: 'cardio', label: '轻有氧 30′', sub: '主动恢复，不占容量', rec: false },
      { key: 'rest', label: '休息日', sub: '连续记录不断档', rec: false }
    ],
    evidence
  };
}

/* ---------- 时刻 2：组间建议 ---------- */
function restAdvice(ctx) {
  const c = ctx || {};
  const step = settings.trainCfg().step || 2.5;
  const last = c.last || {};
  const plan = c.plan || {};
  const w = Number(last.weight != null ? last.weight : plan.weight) || 0;
  const reps = Number(last.reps != null ? last.reps : plan.reps) || 0;
  const planReps = Number(plan.reps) || reps || 10;
  const rpe = Number(last.rpe) || 0;
  const sec = Number(last.sec) || 0;
  const nextW = Math.max(0, Math.round((w + 0) * 10) / 10);

  if (w <= 0) {
    return { weight: 0, reps: Math.max(1, reps + 1), delta: 0, text: '自重动作：把次数再 +1 次，节奏慢下来比加组有用。' };
  }
  if (rpe >= 9 || (planReps && reps < planReps - 1)) {
    return {
      weight: Math.max(0, Math.round((w - step) * 10) / 10), reps: Math.max(1, Math.min(planReps || reps, reps + 1)), delta: -step,
      text: (rpe >= 9 ? '上一组 RPE ' + rpe + '，偏力竭' : '上一组少 ' + (planReps - reps) + ' 次') + '，建议降到 ' + Math.max(0, Math.round((w - step) * 10) / 10) + 'kg 先把次数做满。'
    };
  }
  if (sec && sec >= (c.planSec || 0) * 1.3 && c.planSec) {
    return { weight: w, reps: Math.max(1, reps), delta: 0, text: '上一组用时比平时多 30%，维持 ' + w + 'kg，状态好再 +' + step + 'kg。' };
  }
  return {
    weight: Math.round((w + step) * 10) / 10, reps: Math.max(1, reps), delta: step,
    text: '上一组做满 ' + reps + ' 次' + (rpe ? '、RPE ' + rpe : '') + '，状态够，建议下一组 ' + Math.round((w + step) * 10) / 10 + 'kg 试一次。'
  };
}

/* ---------- 时刻 3：练完的两个决策输出 ---------- */
function postSession(items, stat, cardioMin) {
  const today = engine.dayKey();
  const t = engine.ensureTrain(store.getTrain());
  const plan = (store.getSettings() || {}).plan || {};
  const planGoal = (Number(plan.setsPerDay) || 12) * (Number(plan.days) || 3);
  const week = engine.lastNDays(t, 7);
  const weekSets = week.reduce((a, d) => a + d.done, 0);
  // 目标取「计划目标」与「近 4 周实际均值」的较大值，计划填小了不会显示 300% 这种虚数
  const fourWeeks = engine.lastNDays(t, 28).reduce((a, d) => a + d.done, 0);
  const avgWeek = Math.round(fourWeeks / 4);
  const goalSets = Math.max(planGoal, avgWeek);
  const pct = goalSets ? Math.min(100, Math.round(weekSets / goalSets * 100)) : 0;

  let next = null;
  (items || []).slice().reverse().some(it => {
    if (!it || it.type === 'cardio') return false;
    const gs = (it.groups || []).filter(g => g.done && !g.warmup);
    if (!gs.length) return false;
    const g = gs[gs.length - 1];
    const a = restAdvice({ last: g, plan: g });
    next = { name: it.name, part: it.part, from: g.weight || 0, to: a.weight, reps: g.reps || 0, text: a.text };
    return true;
  });

  const tomorrow = progress.tomorrowOf(t);
  return {
    next,
    tomorrow,
    goal: { pct, weekSets, goalSets },
    summary: [
      next ? { k: 'next', t: '下次 ' + next.name, v: (next.from > 0 ? next.from + ' → ' + next.to + 'kg' : '自重 · ' + next.reps + ' 次'), sub: next.text } : null,
      { k: 'week', t: '本周 ' + weekSets + '/' + goalSets + ' 组（' + pct + '%）', v: pct >= 80 ? '明天可休息或练 ' + (tomorrow.part || '腿') : '明天继续 ' + (tomorrow.part || '薄弱部位'), sub: tomorrow.text }
    ].filter(Boolean)
  };
}

/* ---------- 时刻 4：下周排布 + 平台期 ---------- */
function partSetsRange(train, daysN) {
  const t = engine.ensureTrain(train);
  const start = stats.shiftDay(engine.dayKey(), -((daysN || 7) - 1));
  const map = {};
  (t.records || []).forEach(r => {
    if (!r || !r.date || r.date < start) return;
    const k = r.part || '其他';
    map[k] = (map[k] || 0) + engine.ensureGroups(r).filter(g => g.done && !g.warmup).length;
  });
  return map;
}

function weekly(train) {
  const t = engine.ensureTrain(train);
  const sets7 = partSetsRange(t, 7);
  const sets14 = partSetsRange(t, 14);
  const push = (sets7['胸'] || 0) + (sets7['肩'] || 0) + (sets7['上臂'] || 0);
  const pull = (sets7['背'] || 0) + (sets7['前臂'] || 0);
  const legs = (sets7['上腿'] || 0) + (sets7['小腿'] || 0);
  const core = sets7['腰腹'] || 0;

  // 一周 7 格：拉 / 腿 / 推 / 休 / 拉 / 腿 / 休，按缺口换位
  const seq = ['背', '上腿', '胸', '', '背', '上腿', ''];
  const weakest = [['胸', push], ['背', pull], ['上腿', legs], ['腰腹', core]].sort((a, b) => a[1] - b[1])[0][0];
  // 缺口明显（只练过一次以下）时，把第二次同类日让给它
  if (weakest === '胸' && push < 8) seq[4] = '胸';
  else if (weakest === '上腿' && legs < 8) seq[5] = '上腿';
  else if (weakest === '腰腹' && core < 4) seq[4] = '腰腹';
  const labels = { '胸': '推', '背': '拉', '上腿': '腿', '腰腹': '核心' };
  const text = seq.map(p => (p ? (labels[p] || p) : '休')).join('·');
  const days = seq.map((p, i) => ({ d: ['一', '二', '三', '四', '五', '六', '日'][i], part: p, view: p ? (labels[p] || p) : '休' }));

  const basis = '本周 ' + (sets7['胸'] || 0) + ' 组推 / ' + pull + ' 组拉 / ' + legs + ' 组腿' +
    (weakest ? '；' + weakest + ' 缺口最大' : '');
  const planText = days.filter(d => d.part).map((d, i) => '周' + d.d + ' ' + d.view).join('；') + '；其余休息。每组 3×8-12。';
  return { key: 'weekly', question: '下周怎么排？', text, days, basis, planText, sets: sets7, sets14 };
}

// 平台期：同动作 e1RM 近 4 周两段窗口对比，变化 <2% 且数据点 >=2
function plateau(train) {
  const t = engine.ensureTrain(train);
  const names = {};
  (t.records || []).forEach(r => {
    if (!r || !r.name) return;
    const gs = engine.ensureGroups(r).filter(g => g.done && (g.weight || 0) > 0);
    if (!gs.length) return;
    names[r.name] = (names[r.name] || 0) + 1;
  });
  const top = Object.keys(names).sort((a, b) => names[b] - names[a]).slice(0, 8);
  const out = [];
  top.forEach(name => {
    const pts = progress.e1rmSeries(t, name, 28);
    if (pts.length < 3) return;
    const today = engine.dayKey();
    const mid = stats.shiftDay(today, -13);
    const a = pts.filter(p => p.date < mid);
    const b = pts.filter(p => p.date >= mid);
    if (!a.length || !b.length) return;
    const ea = Math.max.apply(null, a.map(p => p.e));
    const eb = Math.max.apply(null, b.map(p => p.e));
    if (!ea) return;
    const chg = (eb - ea) / ea;
    if (Math.abs(chg) < 0.02) {
      out.push({ name, part: (engine.ensureTrain(t).records.find(r => r.name === name) || {}).part || '', from: Math.round(ea * 10) / 10, to: Math.round(eb * 10) / 10, chg: Math.round(chg * 100) });
    }
  });
  return out.slice(0, 3);
}

// 决策触发点注册表：页面按 key 取上下文，规则算完再交给 DecisionCard 渲染
const DECISION_POINTS = [
  { key: 'daily', when: '打开首页且当天未开练', build: 'daily', ctx: ['恢复矩阵', '近7天组数', '周目标'] },
  { key: 'rest', when: '组间休息倒计时开始', build: 'restAdvice', ctx: ['上一组重量/次数/RPE/用时', '历史组数'] },
  { key: 'post', when: '训练小结卡渲染', build: 'postSession', ctx: ['本次组/容量/部位', '周目标进度'] },
  { key: 'weekly', when: '周日或周目标达成', build: 'weekly', ctx: ['推拉腿组数', '缺口部位'] },
  { key: 'plateau', when: 'e1RM 两段窗口变化 <2%', build: 'plateau', ctx: ['该动作近 28 天 e1RM'] }
];

module.exports = {
  DECISION_POINTS,
  restDays, isRest, markRest, streak,
  ops, addOp, undo, clearOps,
  autoOn, setAuto, autoDone, setAutoDone,
  daily, restAdvice, postSession, weekly, plateau, partSetsRange, gapOf
};
