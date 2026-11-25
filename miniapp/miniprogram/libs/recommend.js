// 今日计划推荐：部位恢复度 + 历史高频/收藏/动作库打分。纯规则，无 wx 依赖。
// 对应网页版 index.html 的 partRecovery / planRecommend / genPlan。
const data = require('./data/index');
const engine = require('./engine/index');
const cardioLib = require('./cardio');

const CANDIDATE = ['胸', '背', '上腿', '肩', '上臂', '腰腹'];
const PV = { '上腿': '腿', '上臂': '臂', '腰腹': '腹' };
// 部位选择 Sheet 的 6 格顺序（肩胸背腹臂腿）
const PART_LIST = ['肩', '胸', '背', '腰腹', '上臂', '上腿'];

const PART_KW = {
  '胸': /卧推|飞鸟|夹胸|俯卧撑|推胸|臂屈伸|推/,
  '背': /划船|下拉|引体|上拉|直臂|面拉|硬拉/,
  '上腿': /深蹲|硬拉|弓步|腿举|腿屈伸|腿弯举|分腿|臀推|提踵/,
  '小腿': /提踵|小腿/,
  '腰腹': /卷腹|仰卧起坐|平板|抬腿|举腿|转体|侧屈|收腹|腹|屈膝/,
  '上臂': /弯举|臂屈伸|三头|二头|屈伸/,
  '前臂': /弯举|腕|握|前臂/,
  '肩': /推举|平举|耸肩|面拉|侧平|前平|肩/,
  '有氧': /跑|跳|单车|划船机|跳绳|登山|开合|波比/
};
const LEG = /深蹲|弓步|臀桥|臀推|腿举|腿弯|腿屈伸|提踵|小腿|分腿/;
const UPPER = /弯举|飞鸟|夹胸|推胸|卧推|划船|下拉|平举|推举|臂屈伸/;

function findEx(id, custom) {
  if (!id) return null;
  const c = (custom || []).find(x => x && x.id === id);
  if (c) return c;
  return data.byId(id);
}

function partLastDate(train, part) {
  let last = '';
  (train.records || []).forEach(r => {
    if (!r || !r.date) return;
    const e = findEx(r.exId, train.custom);
    const p = e ? e.p : r.part;
    if (p === part && r.date > last) last = r.date;
  });
  return last;
}

function partRecovery(train, part) {
  const last = partLastDate(train, part);
  if (!last) return { h: 999, text: '还没练过，可安排', warn: false };
  const h = Math.round((new Date(engine.dayKey() + 'T00:00:00').getTime() - new Date(last + 'T00:00:00').getTime()) / 36e5);
  if (h < 24) return { h, text: part + ' 今日已练 · 建议换部位或降强度', warn: true };
  if (h < 48) return { h, text: part + ' 恢复中（' + h + ' 小时）· 建议换部位', warn: true };
  return { h, text: part + ' 已恢复 ' + Math.floor(h / 24) + ' 天 · 可以练', warn: false };
}

// 部位选择用的短状态：{ key, view, star, warn, state, text }
function partState(train, part, starPart) {
  const rc = partRecovery(train, part);
  const days = Math.floor(rc.h / 24);
  let state = 'ready', text = '';
  if (rc.h >= 999) { state = 'fresh'; text = '还没练过，可安排'; }
  else if (rc.h < 24) { state = 'done'; text = '今日已练'; }
  else if (rc.h < 48) { state = 'recovering'; text = '恢复中 · 剩 ' + (48 - rc.h) + 'h'; }
  else { state = 'ready'; text = days + ' 天前练过'; }
  return { key: part, view: PV[part] || part, star: part === starPart, warn: rc.warn, h: rc.h, state, text };
}

function partStates(train, starPart) {
  return PART_LIST.map(p => partState(train, p, starPart));
}

function pickPart(train) {
  let best = null;
  CANDIDATE.forEach(p => {
    const r = partRecovery(train, p);
    if (!best || r.h > best.h) best = { part: p, h: r.h };
  });
  return best || { part: '胸', h: 999 };
}

function coreOf(n) {
  const m = String(n || '').match(/硬拉|深蹲|弓步|卧推|推胸|划船|下拉|肩推|推举|弯举|飞鸟|夹胸|臂屈伸|伸展|提踵|卷腹|仰卧起坐|平板支撑|引体向上|俯卧撑|臀推|抬腿|举腿|转体|侧屈|平举|耸肩|上拉|跑|单车|跳/);
  return m ? m[0] : String(n || '').slice(-3);
}

function scoreEx(part, kw, e) {
  let v = 0;
  if (/杠铃|哑铃|绳索|器械|史密斯|壶铃/.test(e.e || '')) v += 4;
  if (kw && kw.test(e.n)) v += 8;
  if (kw && !kw.test(e.n)) v -= 4;
  if (/辅助/.test(e.n)) v -= 8;
  if (/弹力带/.test(e.e || '')) v -= 3;
  if (/跪姿|俯卧|瑜伽球|平衡/.test(e.n)) v -= 1;
  return v - String(e.n || '').length * 0.06;
}

function genPlan(part, train, custom) {
  // 部位校验：历史记录按动作库真实部位归类，标签写错的记录不参与本部位
  const recs = (train.records || []).filter(r => {
    if (!r || !r.date) return false;
    const e = findEx(r.exId, custom);
    if (e) return e.p === part;
    return r.part === part;
  });
  const stat = {};
  recs.forEach(r => {
    const k = r.exId || r.name;
    if (!stat[k]) stat[k] = { exId: r.exId, name: r.name, n: 0, last: r };
    stat[k].n++; stat[k].last = r;
  });
  const used = Object.values(stat).sort((a, b) => b.n - a.n);
  const favs = (train.favs || []).map(f => findEx(f, custom)).filter(e => e && e.p === part);

  const picked = [];
  const seen = new Set();
  used.slice(0, 3).forEach(u => {
    const e = findEx(u.exId, custom);
    if (e && !seen.has(e.id)) { seen.add(e.id); picked.push({ e, src: 'hist', u }); }
  });
  favs.forEach(e => { if (!seen.has(e.id)) { seen.add(e.id); picked.push({ e, src: 'fav' }); } });

  const kw = PART_KW[part];
  const pool = data.search('', part, '全部', 1000).concat(custom.filter(x => x && x.p === part))
    .filter(e => !seen.has(e.id))
    .sort((a, b) => scoreEx(part, kw, b) - scoreEx(part, kw, a));

  const eqCount = {}, coreCount = {};
  for (const e of pool) {
    if (picked.length >= 4) break;
    if ((part === '上臂' || part === '前臂') && LEG.test(e.n)) continue;
    if (part === '上腿' && UPPER.test(e.n)) continue;
    const eq = e.e || '自重', core = coreOf(e.n);
    if ((eqCount[eq] || 0) >= 2) continue;
    if ((coreCount[core] || 0) >= 1) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id); eqCount[eq] = (eqCount[eq] || 0) + 1; coreCount[core] = (coreCount[core] || 0) + 1;
    picked.push({ e, src: 'lib' });
  }

  const allRecs = train.records || [];
  const lastWOf = id => {
    const rs = allRecs.filter(r => r.exId === id && (r.weight || 0) > 0);
    return rs.length ? (rs[rs.length - 1].weight || 0) : 0;
  };
  const peerW = eq => {
    let rs = allRecs.filter(r => r.part === part && (r.weight || 0) > 0);
    if (!rs.length && eq) rs = allRecs.filter(r => { const x = findEx(r.exId, custom) || {}; return (x.e || r.e || '') === eq && (r.weight || 0) > 0; });
    if (!rs.length) return 0;
    const t = rs.slice(-3).reduce((a, b) => a + (b.weight || 0), 0) / Math.min(3, rs.length);
    return Math.max(2.5, Math.round(t / 2.5) * 2.5);
  };

  return picked
    .filter(p => p.e && p.e.p === part)            // 兜底：只留同部位动作
    .map(p => {
    const u = p.u;
    let sets = 3, reps = 12, weight = 0, note = '', sugg = false;
    if (u) {
      const last = u.last;
      sets = last.sets >= 4 ? 4 : 3;
      reps = Math.max(last.reps || 10, 8) + 1;
      weight = last.weight || 0;
      note = weight > 0
        ? '上次 ' + engine.wText(last.weight, engine.isUniName(p.e.n)) + ' × ' + (last.reps || 0) + ' 次（该动作 ' + u.n + ' 次记录）· 重量保持，每组多做 1-2 次'
        : '上次 ' + (last.sets || 0) + '×' + (last.reps || 0) + ' 自重（该动作 ' + u.n + ' 次记录）· 加 1 组或放慢离心';
    } else if (p.src === 'fav') {
      note = '你收藏的常用动作 · 按 3×12 起步';
    } else {
      note = '同部位动作库补充 · 按 3×12 起步';
    }
    if (!u) {
      const lw = lastWOf(p.e.id);
      if (lw) { weight = lw; note = '上次 ' + engine.wText(lw, engine.isUniName(p.e.n)) + ' · 沿用重量，先做 3×12'; }
      else if ((p.e.e || '') !== '自重') {
        const pw = peerW(p.e.e || '');
        if (pw) { weight = pw; sugg = true; note = '按同部位最近重量估算 · 采纳后可微调'; }
      }
    }
    if (part === '有氧' || cardioLib.isCardioEx(p.e) || /单车|跑|走|游泳|椭圆|登山|跳|划船机/.test(p.e.n)) {
      return cardioItem(p.e, p.src);
    }
    return {
      exId: p.e.id, name: p.e.n, part: p.e.p, eq: p.e.e, sets, reps, weight, note, sugg: !!sugg, src: p.src,
      why: whyOf(p, { weight, sets, reps, part })
    };
  });
}

// 每个动作一行推荐理由（规则数字，AI 再扩写在计划卡上）
function whyOf(p, it) {
  if (p.u && p.u.last) {
    const last = p.u.last;
    const gap = last.date ? Math.round((new Date(engine.dayKey() + 'T00:00:00') - new Date(last.date + 'T00:00:00')) / 864e5) : 0;
    if (it.weight > 0) return '上次 ' + engine.wText(it.weight, engine.isUniName(p.e.n)) + ' × ' + (last.reps || 0) + '，隔 ' + gap + ' 天，按渐进超负荷做 ' + it.sets + '×' + it.reps;
    return '上次自重 ' + (last.sets || 0) + '×' + (last.reps || 0) + '，这次加量不加时';
  }
  if (p.src === 'fav') return '你收藏的动作，优先排进当天';
  return '补 ' + it.part + ' 的稳定容量，动作库按器械多样性挑的';
}

// 有氧推荐条目：计组型按 3×30 起步，计时型按 20′
function cardioItem(e, src) {
  const mode = cardioLib.defaultCardioMode(e.n);
  if (mode === 'sets') {
    return {
      exId: e.id, name: e.n, part: e.p, eq: e.e, mode: 'sets', sets: 3, reps: 30, weight: 0, dur: 0, dist: 0,
      note: '计组有氧 · 按 3 组起步，可补记距离', src, why: '补充心肺容量，按 3×30 起步，不追配速'
    };
  }
  return {
    exId: e.id, name: e.n, part: e.p, eq: e.e, mode: 'timer', sets: 1, reps: 1, weight: 0, dur: 20, dist: 0,
    note: '有氧以时长为准 · 建议 20-30 分钟中等强度', src, why: '以时长为口径，20′ 中等强度即可，别当力量练'
  };
}

// 入口：返回 { part, view, recovery, items }
function recommend(train, custom) {
  const t = engine.ensureTrain(train);
  const pick = pickPart(t);
  const recovery = partRecovery(t, pick.part);
  const items = genPlan(pick.part, t, custom || []);
  return { part: pick.part, view: PV[pick.part] || pick.part, h: pick.h, recovery, items, ai: true };
}

// 指定部位生成（用户自选）：结构与 recommend 一致，ai=false 表示不是 AI 结论
function recommendFor(train, custom, part) {
  const t = engine.ensureTrain(train);
  const p = PART_LIST.indexOf(part) >= 0 ? part : pickPart(t).part;
  const recovery = partRecovery(t, p);
  const items = genPlan(p, t, custom || []);
  return { part: p, view: PV[p] || p, h: recovery.h, recovery, items, ai: false };
}

// 硬校验：返回只含目标部位的条目（给 UI / AI 结果复用）
function validateItems(part, items) {
  return (items || []).filter(x => x && x.part === part);
}

// 换一个同部位动作（候选不止 4 条，从整池里排除已在列表的）
function nextItem(part, excludeIds, train, custom) {
  const kw = PART_KW[part];
  const pool = data.search('', part, '全部', 500)
    .concat((custom || []).filter(x => x && x.p === part))
    .sort((a, b) => scoreEx(part, kw, b) - scoreEx(part, kw, a));
  const ids = excludeIds || [];
  const e = pool.find(x => ids.indexOf(x.id) < 0);
  if (!e) return null;
  const isCd = part === '有氧' || cardioLib.isCardioEx(e) || /单车|跑|走|游泳|椭圆|登山|跳|划船机/.test(e.n);
  return isCd
    ? cardioItem(e, 'lib')
    : { exId: e.id, name: e.n, part: e.p, eq: e.e, sets: 3, reps: 12, weight: 0, note: '同部位动作库补充 · 按 3×12 起步', src: 'lib' };
}

// ---- AI 周计划：JSON 输出 + 部位校验 + 同部位池重抽 ----
const PART_ALIAS = { '腿': '上腿', '臂': '上臂', '腹': '腰腹', '腹肌': '腰腹', '上肢': '上臂', '下肢': '上腿', '背部': '背', '胸部': '胸', '肩部': '肩' };

function normalizePart(p) {
  const s = String(p || '').trim();
  if (PART_LIST.indexOf(s) >= 0) return s;
  if (PART_ALIAS[s]) return PART_ALIAS[s];
  const hit = PART_LIST.find(k => s.indexOf(PV[k] || k) >= 0 || s.indexOf(k) >= 0);
  return hit || '';
}

// 从 AI 返回的文本里抠出 JSON 对象
function parseAiPlan(text) {
  const s = String(text || '').replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

// 校验 AI 计划的每天部位与动作；动作不属于该部位则丢弃，不足 2 个从同部位池补
function buildAiPlan(obj, train, custom) {
  const t = engine.ensureTrain(train);
  const days = (obj && Array.isArray(obj.days)) ? obj.days.slice(0, 7) : [];
  const out = [];
  let fixed = 0;
  days.forEach((d, i) => {
    const part = normalizePart(d && d.part);
    if (!part) return;
    const raw = (d && Array.isArray(d.items)) ? d.items : [];
    const kept = [];
    raw.forEach(x => {
      const nm = typeof x === 'string' ? x : (x && (x.name || x.n || ''));
      const e = data.matchByName(nm);
      if (e && e.p === part) { if (kept.indexOf(e.n) < 0) kept.push(e.n); }
      else fixed++;
    });
    if (kept.length < 2) {
      genPlan(part, t, custom || []).map(x => x.name).forEach(n => {
        if (kept.length < 3 && kept.indexOf(n) < 0) kept.push(n);
      });
    }
    out.push({ day: (d && d.day) || ('第' + (i + 1) + '天'), part, items: kept.slice(0, 4) });
  });
  const note = obj && obj.note ? String(obj.note) : '';
  const text = out.map(d => d.day + ' ' + (PV[d.part] || d.part) + ' ' + d.items.map(n => n + ' 3×12').join('、')).join('；')
    + (note ? '。' + note : '');
  return { days: out, text, fixed };
}

module.exports = {
  recommend, recommendFor, partRecovery, partState, partStates, pickPart, genPlan, validateItems, nextItem,
  PART_LIST, normalizePart, parseAiPlan, buildAiPlan
};
