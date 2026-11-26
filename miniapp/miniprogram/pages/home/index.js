const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const settings = require('../../libs/settings');
const recommend = require('../../libs/recommend');
const decision = require('../../libs/decision');
const polish = require('../../libs/aipolish');
const food = require('../../libs/food');
const cardioLib = require('../../libs/cardio');
const ai = require('../../libs/ai');
const sanity = require('../../libs/sanity');
const ui = require('../../libs/ui');

const REVIEW_SEEN = 'selfagent_review_seen';

Page({
  data: {
    todayLabel: '',
    today: { n: 0, done: 0, total: 0, volume: 0, cardioMin: 0 },
    week: [],
    streak: 0,
    items: [],
    hasToday: false,
    canStart: false,
    kpis: [],
    four: [],
    sub: '',
    sigs: [],
    aiInsight: '',
    orb: { done: 0, total: 0, pct: 0, text: '开始训练', kick: '今天还没有动作' },
    hmCols: [],
    hmMonths: [],
    hmHit: 0,
    reviewShow: false,
    review: null,
    rvOpen: false,
    rvShare: false,
    dotTip: false,
    editorVisible: false,
    payload: null,
    decision: null,
    decAi: ''
  },

  onReady() {
    this.drawOrb();
  },

  onShow() {
    this.refresh();
    this.maybeOnboard();
  },

  // 手动同步入口（设置页 / 调试）
  doSync() {
    const sync = require('../../libs/sync/index');
    return sync.boot(true).then(r => { this.refresh(); return r; });
  },

  // 下拉 = 触发云同步
  onPullDownRefresh() {
    const app = getApp();
    const ready = !!(app && app.globalData && app.globalData.cloudReady);
    if (!ready) {
      this.refresh();
      wx.stopPullDownRefresh();
      return;
    }
    const sync = require('../../libs/sync/index');
    sync.boot(true)
      .then(r => {
        this.refresh();
        wx.showToast({ title: r && r.ok ? '已同步' : '同步失败', icon: 'none' });
      })
      .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }))
      .then(() => wx.stopPullDownRefresh());
  },

  // 新手引导：第一次进来、还没有任何数据时给一次三步说明
  maybeOnboard() {
    let st = null;
    try { st = wx.getStorageSync('selfagent_onboard_v1'); } catch (e) {}
    if (st && st.done) return;
    const train = engine.ensureTrain(store.getTrain());
    if ((store.getLogs() || []).length || (train.records || []).length) {
      try { wx.setStorageSync('selfagent_onboard_v1', { done: 1, parts: (st && st.parts) || [] }); } catch (e) {}
      return;
    }
    wx.showModal({
      title: 'SelfAgent · 三步开始',
      content: '1) 记录：一句话写下今天，精力与情绪各点一下\n2) 训练：从动作库挑动作，逐组打点或进专注模式\n3) 分析：攒够几条记录后看画像、规划与推演',
      confirmText: '去记录', cancelText: '先看看',
      success: (r) => {
        try { wx.setStorageSync('selfagent_onboard_v1', { done: 1, parts: (st && st.parts) || [] }); } catch (e) {}
        if (r.confirm) wx.switchTab({ url: '/pages/log/index' });
      }
    });
  },

  refresh() {
    const train = engine.ensureTrain(store.getTrain());
    const logs = store.getLogs() || [];
    const todayKey = engine.dayKey();
    const t = engine.dayStat(train, todayKey);
    const week = engine.lastNDays(train, 7).reverse();
    const maxV = week.reduce((a, d) => Math.max(a, d.volume), 1);
    const streak = decision.streak(train);
    const hasToday = t.n > 0 || t.cardioMin > 0;
    const hm = this.buildHeat(train, logs);
    const items = engine.stDayItems(train, todayKey).concat(engine.cdDayItems(train, todayKey));

    const pct = t.total ? Math.round(t.done / t.total * 100) : 0;
    const avgSc = this.avgOf(logs, 'score', week.map(w => w.date));
    const avgMd = this.avgOf(logs, 'mood', week.map(w => w.date));
    const logsToday = logs.filter(l => l && l.date === todayKey && l.kind !== 'train').length;
    const todayScore = this.avgOf(logs, 'score', [todayKey]);
    const todayMood = this.avgOf(logs, 'mood', [todayKey]);
    const weekCount = logs.filter(l => l && l.kind !== 'train' && l.date >= week[0].date).length;

    // 本周已练组数（orb 的 x/y 用今日；无今日动作时退回本周）
    const four = [
      { l: '连续', v: streak, u: '天' },
      { l: '今日精力', v: todayScore == null ? '—' : todayScore.toFixed(1), u: todayScore == null ? '' : '/5' },
      { l: '今日情绪', v: todayMood == null ? '—' : settings.moodText(Math.round(todayMood)), u: '' },
      { l: '本周记录', v: weekCount, u: '条' }
    ];

    const lastLog = (logs.filter(l => l && l.kind !== 'train' && l.date).map(l => l.date).sort().pop()) || '';
    let sub = '';
    if (!logs.length) sub = '写下第一条，开始认识自己';
    else if (streak >= 2) sub = '连续 ' + streak + ' 天有记录';
    else if (lastLog) {
      const gap = Math.round((new Date(todayKey + 'T00:00:00') - new Date(lastLog + 'T00:00:00')) / 864e5);
      sub = gap <= 0 ? '今天已经记过了' : '上次记录在 ' + gap + ' 天前';
    }

    const sigs = this.buildSignals(train, logs, todayKey, week, logsToday);
    const card = this.reviewData(train, logs);
    const seen = wx.getStorageSync(REVIEW_SEEN) === '1';
    const isSunday = new Date().getDay() === 0;
    const reviewShow = this.data.reviewShow || ((isSunday || this.data.forceReview) && !seen && !!card);

    this.setData({
      todayLabel: engine.dateLabel(todayKey),
      today: { n: t.n, done: t.done, total: t.total, volume: t.volume, cardioMin: t.cardioMin },
      week: week.map(d => ({
        label: engine.shortDate(d.date),
        volume: d.volume,
        done: d.done,
        h: d.volume > 0 ? Math.max(10, Math.round((d.volume / maxV) * 100)) : 0,
        today: d.date === todayKey
      })),
      streak,
      items: items.map(it => ({
        name: it.name,
        type: it.type,
        part: it.part || '',
        uid: it.uid,
        min: it.min || 0,
        sets: it.sets || 0,
        done: it.done || 0,
        dots: (it.groups || []).map(g => ({ on: !!g.done, warm: !!g.warmup }))
      })),
      hasToday,
      canStart: t.n > 0,
      orb: {
        done: t.done,
        total: t.total,
        pct,
        text: t.n ? (t.done >= t.total ? '收工回顾' : '继续训练') : (decision.isRest(todayKey) ? '今天休息 ✓' : '开始训练'),
        kick: t.n ? '今天 ' + t.done + '/' + t.total + ' 组' : (decision.isRest(todayKey) ? '休息日 · 连续 ' + streak + ' 天不断档' : '还没有安排动作')
      },
      four,
      sub,
      sigs,
      reviewShow,
      review: card,
      dotTip: !wx.getStorageSync('selfagent_dot_tip_seen'),
      hmCols: hm.cols,
      hmMonths: hm.months,
      hmHit: hm.hit,
      kpis: [
        { v: streak, l: '连续天' },
        { v: todayScore == null ? '—' : todayScore.toFixed(1), l: '今日精力' },
        { v: todayMood == null ? '—' : settings.moodText(Math.round(todayMood)), l: '今日情绪' },
        { v: weekCount, l: '本周记录' },
        { v: t.volume, l: '总容量 kg' },
        { v: t.cardioMin ? t.cardioMin + '′' : '—', l: '有氧' }
      ]
    }, () => this.drawOrb());

    const dec = decision.daily(train, logs, actions.customList());
    // 简报理由行多一个饮食维度：昨天的摄入量
    if (dec) {
      const yk = engine.dayKey(new Date(Date.now() - 864e5));
      const yCal = food.kcalOfDay(logs, yk);
      if (yCal && Array.isArray(dec.evidence)) {
        dec.evidence = dec.evidence.concat([{ t: '昨天饮食', v: '约 ' + yCal + ' kcal' }]).slice(0, 4);
      }
    }
    this.setData({ decision: dec }, () => {
      this.autoDaily(dec);
      this.maybeDailyAi(dec);
    });
    this.maybeAiInsight();
  },

  // 简报里的 AI 一句话（规则理由已在本地算好，AI 只负责说人话）
  maybeDailyAi(dec) {
    if (!dec || dec.done || !polish.enabled()) return;
    const facts = { part: dec.part || '', reason: dec.reason, evidence: dec.evidence };
    polish.polish('daily', facts, '一句话说明今天该怎么练，30 字内，别列清单')
      .then(r => { if (r.ok) this.setData({ decAi: r.text }); });
  },

  // L3：授权后，今日简报的推荐直接执行（每天一次，改动可撤销）
  autoDaily(dec) {
    if (!dec || !decision.autoOn()) return;
    if (dec.done || dec.restDay) return;
    if (decision.autoDone() === 'plan') return;
    if (!dec.options.some(o => o.key === 'plan')) return;
    decision.setAutoDone('plan');
    setTimeout(() => this.applyDaily({ currentTarget: { dataset: { k: 'plan' } } }, true), 300);
  },

  // 决策卡点击：每个选项都是一个可执行动作
  onDecisionPick(e) {
    const k = (e && e.detail && e.detail.key) || '';
    if (k) this.applyDaily({ currentTarget: { dataset: { k } } });
  },

  pickDaily(e) {
    const k = e.currentTarget.dataset.k;
    this.applyDaily({ currentTarget: { dataset: { k } } });
  },

  applyDaily(e, auto) {
    const k = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.k
      : (e || '');
    const dec = this.data.decision;
    if (!dec && !k) return;
    if (k === 'go') { this.gotoFocus(); return; }
    if (k === 'cardio') { this.applyLightCardio(!!auto); return; }
    if (k === 'rest') {
      decision.markRest(engine.dayKey(), true);
      this.refresh();
      wx.showToast({ title: '今天休息 ✓ 连续不断档', icon: 'none' });
      return;
    }
    if (k === 'unrest') {
      decision.markRest(engine.dayKey(), false);
      this.refresh();
      wx.showToast({ title: '已取消休息', icon: 'none' });
      return;
    }
    if (k === 'plan') this.applyPartPlan((dec && dec.part) || '胸', !!auto);
  },

  // 一键生成部位日计划 → 加入今日 → 跳计划页
  applyPartPlan(part, auto) {
    const train = engine.ensureTrain(store.getTrain());
    const custom = actions.customList();
    const rec = recommend.recommendFor(train, custom, part);
    const today = engine.dayKey();
    const ids = [], cids = [];
    let added = 0;
    (rec.items || []).forEach(i => {
      const exists = (store.getTrain().records || []).some(r => r.date === today && r.exId === i.exId)
        || (store.getTrain().cardio || []).some(c => c.date === today && c.exId === i.exId);
      if (exists) return;
      if (i.dur || i.mode === 'timer') {
        const c = actions.saveCardio({ date: today, exId: i.exId, modal: i.name, name: i.name, min: i.dur || 20, done: false });
        if (c && c.uid) cids.push(c.uid);
        added++;
        return;
      }
      const groups = [];
      for (let g = 0; g < (i.sets || 3); g++) groups.push({ no: g + 1, reps: i.reps || 12, weight: i.weight || 0, done: false, warmup: false, rpe: 0, sec: 0 });
      const r = actions.saveStrength({ date: today, exId: i.exId, name: i.name, part: i.part, sets: i.sets || 3, reps: i.reps || 12, weight: i.weight || 0, groups });
      if (r && r.uid) ids.push(r.uid);
      added++;
    });
    decision.addOp({
      key: 'daily-plan', auto: !!auto,
      title: '生成' + part + '日计划',
      desc: added + ' 个动作已加入今日' + (auto ? '（AI 自动执行）' : ''),
      undo: { kind: 'items', ids, cids, date: today }
    });
    this.refresh();
    if (!added) {
      wx.showToast({ title: '今日已有这些动作', icon: 'none' });
      return;
    }
    wx.showToast({ title: '已加入 ' + added + ' 项', icon: 'none' });
    setTimeout(() => wx.navigateTo({ url: '/pages/plan/index' }), 500);
  },

  // 轻有氧：按历史最常用的模态预填 30′，直接可开
  applyLightCardio(auto) {
    const train = engine.ensureTrain(store.getTrain());
    const cnt = {};
    (train.cardio || []).forEach(c => {
      const k = cardioLib.modalOf(c.modal || c.name || '');
      cnt[k] = (cnt[k] || 0) + 1;
    });
    const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '跑步';
    const name = best === '其他' ? '跑步' : best;
    const today = engine.dayKey();
    const exists = (store.getTrain().cardio || []).some(c => c.date === today && (c.modal || c.name) === name);
    let uid = '';
    if (!exists) {
      const c = actions.saveCardio({ date: today, modal: name, name, min: 30, mode: 'timer', done: false });
      uid = (c && c.uid) || '';
      decision.addOp({
        key: 'daily-cardio', auto: !!auto,
        title: '轻有氧 30′',
        desc: name + ' 已加入今日',
        undo: { kind: 'items', cids: uid ? [uid] : [], date: today }
      });
    }
    this.refresh();
    wx.showToast({ title: name + ' 30′ 已加入', icon: 'none' });
    setTimeout(() => {
      wx.navigateTo({ url: '/pages/focus/index?uid=' + encodeURIComponent(uid || '') + '&date=' + today });
    }, 450);
  },

  // 首页 AI 洞察：每天一次，一句话，不阻塞页面
  maybeAiInsight() {
    if (this.aiAsked) return;
    const cfg = ai.cfg();
    const app = getApp();
    const ready = !!(cfg.apiKey && cfg.baseUrl) || !!(app && app.globalData && app.globalData.cloudReady);
    if (!ready) return;
    const today = engine.dayKey();
    let seen = '';
    try { seen = wx.getStorageSync('selfagent_ai_home_v1') || ''; } catch (e) {}
    if (seen === today) return;
    this.aiAsked = true;
    const train = engine.ensureTrain(store.getTrain());
    const logs = store.getLogs() || [];
    const week = engine.lastNDays(train, 7);
    const recent = logs.filter(l => l.kind !== 'train').slice(-3).map(l => (l.content || '').slice(0, 30));
    setTimeout(() => {
      ai.ask({
        messages: [
          { role: 'system', content: '你是训练与作息教练。只输出一句 40 字内中文洞察，带具体数字，不加引号。' },
          { role: 'user', content: '近7天：训练' + week.filter(d => d.done || d.cardioMin).length + '天，' + week.reduce((a, d) => a + d.done, 0) + '组，容量' + week.reduce((a, d) => a + d.volume, 0) + 'kg；最近记录：' + (recent.join(' | ') || '无') }
        ],
        max_tokens: 80,
        temperature: 0.4
      }).then(r => {
        if (!r.ok) return;
        const raw = String(r.text || '').replace(/["“”']/g, '').replace(/\s+/g, ' ').trim();
        const weekDays = week.filter(d => d.done || d.cardioMin).length;
        const sets = week.reduce((a, d) => a + d.done, 0);
        const volume = week.reduce((a, d) => a + d.volume, 0);
        // 规则兜底句：AI 文案不合格时用它，绝不上屏半句乱码
        const fb = '近 7 天练了 ' + weekDays + ' 天、共 ' + sets + ' 组' + (volume ? '，容量 ' + volume + ' kg' : '') + '。';
        const t = sanity.check(raw, fb, { max: 60, minCjk: 0.3 });
        this.setData({ aiInsight: t });
        try { wx.setStorageSync('selfagent_ai_home_v1', today); } catch (e) {}
      });
    }, 900);
  },

  avgOf(logs, key, days) {
    const set = {};
    days.forEach(d => { set[d] = 1; });
    const v = (logs || []).filter(l => l && set[l.date] && typeof l[key] === 'number' && l[key] > 0).map(l => (key === 'mood' ? settings.moodNorm(l[key]) : l[key]));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  },

  // 首页信号：今天没记 / 多天没练 / 本周记录对比 / 训练次日精力 / 部位太久没练
  buildSignals(train, logs, todayKey, week, logsToday) {
    const out = [];
    if (!logsToday) out.push({ t: '今天还没有记录，写一句就够', go: 'log' });

    const lastRec = (train.records || []).filter(r => r && r.date).map(r => r.date).sort().pop() || '';
    const noTrain = lastRec ? Math.round((new Date(todayKey + 'T00:00:00') - new Date(lastRec + 'T00:00:00')) / 864e5) : 0;
    if (lastRec && noTrain >= 3) {
      const pk = recommend.pickPart(train);
      const rc = recommend.partRecovery(train, pk.part);
      out.push({ t: '已 ' + noTrain + ' 天没训练 · ' + rc.text, go: 'train' });
    }

    const wA = week[0].date;
    const wB = week[week.length - 1].date;
    const prevEnd = new Date(new Date(wA + 'T00:00:00').getTime() - 864e5);
    const prevStart = new Date(prevEnd.getTime() - 6 * 864e5);
    const pk = d => { const x = new Date(d); return engine.dayKey(x); };
    const ps = pk(prevStart), pe = pk(prevEnd);
    const curN = logs.filter(l => l && l.kind !== 'train' && l.date >= wA && l.date <= wB).length;
    const prevN = logs.filter(l => l && l.kind !== 'train' && l.date >= ps && l.date <= pe).length;
    if (prevN > 0 && curN !== prevN) out.push({ t: '本周 ' + curN + ' 条记录，上周 ' + prevN + ' 条', go: 'log' });

    // 训练日次日精力 vs 其它日
    const trainDays = {};
    (train.records || []).forEach(r => { if (r.date) trainDays[r.date] = 1; });
    const byDay = {};
    logs.forEach(l => { if (l.kind === 'train' || !l.date) return; (byDay[l.date] = byDay[l.date] || []).push(+(l.score || 0)); });
    const nextS = [], otherS = [];
    Object.keys(byDay).forEach(d => {
      const v = byDay[d].filter(x => x > 0);
      if (!v.length) return;
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const prev = engine.dayKey(new Date(new Date(d + 'T00:00:00').getTime() - 864e5));
      (trainDays[prev] ? nextS : otherS).push(mean);
    });
    if (nextS.length >= 2 && otherS.length >= 2) {
      const a = nextS.reduce((x, y) => x + y, 0) / nextS.length;
      const b = otherS.reduce((x, y) => x + y, 0) / otherS.length;
      if (Math.abs(a - b) >= 0.3) {
        out.push({ t: '训练次日精力 ' + a.toFixed(1) + '，其它日 ' + b.toFixed(1) + (a < b ? ' · 强度可能偏高' : ' · 训练在帮你'), go: 'agent' });
      }
    }

    // 饮食：昨天热量 vs 本周记录日均，只在差得明显时说
    const yk = engine.dayKey(new Date(Date.now() - 864e5));
    const yCal = food.kcalOfDay(logs, yk);
    const mt = food.trend(logs, 7, train);
    if (yCal > 0 && mt.dayCount >= 2 && mt.avg > 0) {
      const diff = Math.round((yCal - mt.avg) / mt.avg * 100);
      if (Math.abs(diff) >= 25) {
        out.push({ t: '昨天约 ' + yCal + ' kcal · 比这周日均' + (diff > 0 ? '高 ' : '低 ') + Math.abs(diff) + '%', go: 'log' });
      }
    }

    ['胸', '背', '上腿', '肩'].forEach(p => {
      const last = (train.records || []).filter(r => r.part === p && r.date).map(r => r.date).sort().pop();
      if (last) {
        const d = Math.round((new Date(todayKey + 'T00:00:00') - new Date(last + 'T00:00:00')) / 864e5);
        if (d >= 10) out.push({ t: p + ' 已经 ' + d + ' 天没练', go: 'plan', act: 'part', part: p, days: d });
      }
    });

    return out.slice(0, 4);
  },

  // 周回顾（本周 vs 上周）
  reviewData(train, logs) {
    const dk = d => engine.dayKey(d);
    const today = new Date();
    const wd = (today.getDay() + 6) % 7;
    const ws = new Date(today); ws.setDate(today.getDate() - wd);
    const we = new Date(Math.min(new Date(ws.getTime() + 6 * 864e5).getTime(), today.getTime()));
    const ps0 = new Date(ws.getTime() - 7 * 864e5);
    const pe0 = new Date(ws.getTime() - 864e5);
    const aW = dk(ws), bW = dk(we), aP = dk(ps0), bP = dk(pe0);
    const inR = (l, a, b) => (l.date || '') >= a && (l.date || '') <= b;
    const pick = (a, b) => ({
      logs: (logs || []).filter(l => l.kind !== 'train' && inR(l, a, b)),
      recs: ((train && train.records) || []).filter(r => r.date >= a && r.date <= b)
    });
    const avg = (arr, k) => {
      const v = arr.filter(x => typeof x[k] === 'number' && x[k] > 0).map(x => (k === 'mood' ? settings.moodNorm(x[k]) : x[k]));
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    };
    const sets = o => o.recs.reduce((a, r) => a + ((r.groups && r.groups.length) ? r.groups.filter(g => g.done).length : (r.sets || 0)), 0);
    const vol = o => Math.round(o.recs.reduce((a, r) => a + ((r.groups || []).filter(g => g.done && !g.warmup)).reduce((x, g) => x + (g.reps || 0) * (g.weight || 0), 0), 0));
    const kw = o => {
      const c = {};
      o.logs.forEach(l => String(l.tags || '').split(/[,、，]+/).filter(Boolean).forEach(t => { c[t] = (c[t] || 0) + 1; }));
      return Object.keys(c).sort((x, y) => c[y] - c[x]).slice(0, 3);
    };
    const cur = pick(aW, bW), prev = pick(aP, bP);
    const f1 = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
    const s1 = { logs: cur.logs.length, sets: sets(cur), vol: vol(cur), sc: avg(cur.logs, 'score'), md: avg(cur.logs, 'mood'), kw: kw(cur) };
    const s2 = { logs: prev.logs.length, sets: sets(prev), vol: vol(prev), sc: avg(prev.logs, 'score'), md: avg(prev.logs, 'mood') };
    let rise = '';
    if (s2.logs >= 2 && s1.logs > 0) {
      if (s1.logs > s2.logs) rise = '记录比上周多 ' + (s1.logs - s2.logs) + ' 条，节奏稳住了。';
      else if (s1.logs < s2.logs) rise = '记录比上周少 ' + (s2.logs - s1.logs) + ' 条，别让记录断掉。';
      else rise = '记录量和上周持平。';
    } else rise = '数据还不够两周，下周就能看趋势了。';
    if (s1.md != null && s2.md != null && Math.abs(s1.md - s2.md) >= 0.4) rise += ' 情绪均值 ' + s2.md.toFixed(1) + ' → ' + s1.md.toFixed(1) + '。';
    if (!s1.logs && !s1.sets) return null;
    return {
      range: aW.slice(5) + ' – ' + bW.slice(5),
      cells: [
        { v: String(s1.logs), l: '条记录' },
        { v: String(s1.sets), l: '组训练' },
        { v: f1(s1.sc), l: '平均精力' },
        { v: f1(s1.md), l: '平均情绪' }
      ],
      diff: '上周 ' + s2.logs + ' 条 / ' + s2.sets + ' 组 · 容量 ' + s1.vol + ' kg',
      say: rise,
      kw: s1.kw,
      raw: { aW, bW, cur: s1 }
    };
  },

  // 近 13 周记录热力：训练组数 + 随手记条数按天聚合，列=周，行=周一到周日
  buildHeat(train, logs) {
    const cnt = {};
    (logs || []).forEach(l => {
      if (!l) return;
      const k = l.date || (l.time ? store.dayKey(new Date(l.time)) : '');
      if (k) cnt[k] = (cnt[k] || 0) + 1;
    });
    (train.records || []).forEach(r => {
      if (!r || !r.date) return;
      const n = (r.groups && r.groups.length) || r.sets || 1;
      cnt[r.date] = (cnt[r.date] || 0) + n;
    });

    const HM_W = 13;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const wkStart = new Date(t0);
    wkStart.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
    const first = new Date(wkStart);
    first.setDate(wkStart.getDate() - (HM_W - 1) * 7);
    const todayK = engine.dayKey();
    const cols = [];
    const months = [];
    let hit = 0;
    let lastM = -1;
    for (let w = 0; w < HM_W; w++) {
      const cells = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(first);
        d.setDate(first.getDate() + w * 7 + r);
        const k = engine.dayKey(d);
        const c = cnt[k] || 0;
        if (d > t0) { cells.push({ fut: true, lv: 0 }); continue; }
        const lv = c === 0 ? 0 : c <= 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4;
        if (c > 0) hit++;
        cells.push({ fut: false, lv, today: k === todayK });
      }
      // 月份行：该列第一天所在月份若是新月份则标出
      const md = new Date(first);
      md.setDate(first.getDate() + w * 7);
      const m = md.getMonth() + 1;
      months.push(m !== lastM ? m + '月' : '');
      lastM = m;
      cols.push({ cells });
    }
    return { cols, months, hit };
  },

  drawOrb() {
    const pct = this.data.orb.pct || 0;
    const q = this.createSelectorQuery();
    q.select('#orbCv').node(res => {
      const node = res && res.node;
      if (!node) return;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 2;
      const size = 132;
      node.width = size * dpr;
      node.height = size * dpr;
      const ctx = node.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2, cy = size / 2, r = size / 2 - 6;
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#EDF1F0';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (pct > 0) {
        ctx.strokeStyle = '#12A594';
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, pct / 100));
        ctx.stroke();
      }
    }).exec();
  },

  // 有动作就直接开练，没动作就先挑 —— 主 CTA 不再是死路
  mainCta() {
    if (this.data.canStart) {
      this.gotoFocus();
      return;
    }
    this.openLibrary();
  },

  // 今日动作的小圆点：点一下就记一组
  tapDot(e) {
    const ds = e.currentTarget.dataset;
    const uid = ds.uid;
    if (!uid) {
      this.gotoFocus();
      return;
    }
    const t = engine.dayStat(engine.ensureTrain(store.getTrain()), engine.dayKey());
    const rec = (engine.ensureTrain(store.getTrain()).records || []).find(r => r.uid === uid);
    const already = rec ? (engine.ensureGroups(rec).filter(g => g.done).length >= engine.ensureGroups(rec).length) : false;
    actions.toggleGroup(engine.dayKey(), uid, ds.idx);
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    if (this.data.dotTip) {
      try { wx.setStorageSync('selfagent_dot_tip_seen', '1'); } catch (e) {}
      this.setData({ dotTip: false });
    }
    this.refresh();
    if (!already) {
      const rest = settings.restFor(rec ? rec.part : '', rec ? rec.name : '');
      if (rest > 0) wx.showToast({ title: '该歇 ' + rest + ' 秒', icon: 'none' });
    }
  },

  gotoFocus() {
    wx.navigateTo({ url: '/pages/focus/index?date=' + engine.dayKey() });
  },

  tapSig(e) {
    const ds = e.currentTarget.dataset;
    const go = ds.go;
    if (ds.act === 'part' && ds.part) { this.openSignalPart(ds.part, Number(ds.days) || 0); return; }
    if (go === 'log') wx.switchTab({ url: '/pages/log/index' });
    else if (go === 'train') wx.switchTab({ url: '/pages/train/index' });
    else if (go === 'agent') wx.switchTab({ url: '/pages/agent/index' });
    else if (go === 'plan') wx.navigateTo({ url: '/pages/plan/index' });
  },

  // 信号条点一下就出决策卡：补练该部位 / 轻有氧 / 算了
  openSignalPart(part, days) {
    const t = engine.ensureTrain(store.getTrain());
    const items = recommend.genPlan(part, t, actions.customList());
    const sets = items.reduce((a, i) => a + (i.sets || 3), 0);
    const inProgress = !!this.data.hasToday;
    this.setData({
      decAi: '',
      decision: {
        key: 'signal',
        part,
        question: '补练 ' + part + ' 吗？',
        reason: part + ' 已 ' + days + ' 天没练' + (inProgress ? '，点下面第一条会追加到今天（已练的不重复加）。' : '，今天还没开练，正好接上。'),
        options: [
          { key: 'plan', label: part + '日计划', sub: items.length + ' 个动作 · 约 ' + sets + ' 组', rec: true },
          { key: 'cardio', label: '轻有氧 30′', sub: '主动恢复，不占容量', rec: false },
          { key: 'rest', label: inProgress ? '先不补' : '今天算了', sub: '连续记录不断档', rec: false }
        ],
        evidence: [
          { t: '间隔', v: days + ' 天未练' },
          { t: '计划', v: items.length + ' 动作 / ' + sets + ' 组' }
        ]
      }
    });
    wx.pageScrollTo && wx.pageScrollTo({ selector: '#dailyCard', duration: 300 });
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  showReview() {
    ui.light();
    this.setData({ reviewShow: true, forceReview: true, rvOpen: true });
    this.refresh();
  },

  toggleReviewBody() {
    ui.light();
    this.setData({ rvOpen: !this.data.rvOpen });
  },

  closeDotTip() {
    try { wx.setStorageSync('selfagent_dot_tip_seen', '1'); } catch (e) {}
    this.setData({ dotTip: false });
  },

  hideReview() {
    try { wx.setStorageSync(REVIEW_SEEN, '1'); } catch (e) {}
    this.setData({ reviewShow: false, forceReview: false });
  },

  // 周回顾分享图：canvas 生成后存相册（对应网页版 reviewShare）
  shareReview() {
    const r = this.data.review;
    if (!r) return;
    const W = 540, H = 675;
    const q = this.createSelectorQuery();
    q.select('#rvCv').node(res => {
      const node = res && res.node;
      if (!node) { wx.showToast({ title: '画布不可用', icon: 'none' }); return; }
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      node.width = W * dpr; node.height = H * dpr;
      const ctx = node.getContext('2d'); ctx.scale(dpr, dpr);
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0B0F14'); g.addColorStop(0.55, '#0E1620'); g.addColorStop(1, '#131A26');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(61,220,191,.25)'; ctx.lineWidth = 1; ctx.strokeRect(24, 24, W - 48, H - 48);
      ctx.fillStyle = '#3DDCBF'; ctx.font = '600 15px sans-serif'; ctx.fillText('SelfAgent · WEEKLY', 44, 66);
      ctx.fillStyle = '#EAEFF5'; ctx.font = '700 34px sans-serif'; ctx.fillText('本周回顾', 44, 118);
      ctx.fillStyle = 'rgba(234,239,245,.55)'; ctx.font = '400 14px sans-serif'; ctx.fillText(r.cur ? r.cur.aW + ' — ' + r.cur.bW : r.range, 44, 143);
      const cells = [['记录', r.cells[0].v + ' 条'], ['训练', r.cells[1].v + ' 组'], ['精力', r.cells[2].v], ['情绪', r.cells[3].v]];
      cells.forEach((c, i) => {
        const x = 44 + (i % 2) * ((W - 88) / 2), y = 180 + Math.floor(i / 2) * 105;
        ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x, y, (W - 118) / 2, 88);
        ctx.fillStyle = '#3DDCBF'; ctx.font = '700 27px sans-serif'; ctx.fillText(c[1], x + 15, y + 46);
        ctx.fillStyle = 'rgba(234,239,245,.5)'; ctx.font = '400 13px sans-serif'; ctx.fillText(c[0], x + 15, y + 70);
      });
      ctx.fillStyle = 'rgba(109,140,255,.9)'; ctx.font = '500 14px sans-serif';
      ctx.fillText(r.kw && r.kw.length ? ('关键词：' + r.kw.join(' · ')) : '关键词：还不够', 44, 452);
      ctx.fillStyle = 'rgba(234,239,245,.75)'; ctx.font = '400 15px sans-serif';
      let line = '', yy = 492;
      String(r.say || '').split('').forEach(ch => {
        if (ctx.measureText(line + ch).width > W - 100) { ctx.fillText(line, 44, yy); yy += 24; line = ch; } else line += ch;
      });
      ctx.fillText(line, 44, yy);
      ctx.fillStyle = 'rgba(61,220,191,.65)'; ctx.font = '400 12px sans-serif'; ctx.fillText('自我认知 · 每周一张卡', 44, H - 44);
      wx.canvasToTempFilePath({
        canvas: node,
        success: res2 => {
          wx.saveImageToPhotosAlbum({
            filePath: res2.tempFilePath,
            success: () => wx.showToast({ title: '已存到相册', icon: 'success' }),
            fail: () => wx.previewImage({ urls: [res2.tempFilePath] })
          });
        },
        fail: () => wx.showToast({ title: '生成失败', icon: 'none' })
      });
    }).exec();
  },

  openLibrary() {
    wx.navigateTo({
      url: '/pages/library/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          this.setData({
            editorVisible: true,
            payload: {
              mode: 'strength',
              isNew: true,
              name: ex.n,
              part: ex.p,
              exId: ex.id,
              date: engine.dayKey(),
              groups: [{ no: 1, reps: 10, weight: 0, done: false }]
            }
          });
        }
      }
    });
  },

  onEditorClose() {
    this.setData({ editorVisible: false, payload: null });
  },

  onEditorConfirm(e) {
    const d = e.detail;
    const rec = Object.assign({}, d.record, { date: engine.dayKey() });
    if (d.mode === 'cardio') {
      rec.mode = rec.mode || 'timer';
      rec.part = '有氧';
      rec.name = rec.name || rec.modal;
      rec.dur = rec.min;
      actions.saveCardio(rec);
    } else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已添加', icon: 'none' });
  },

  onEditorDelete() {
    this.setData({ editorVisible: false, payload: null });
  },

  // 悬浮球在首页的「专注」= 去训练页
  orbFocus() {
    this.gotoFocus();
  },

  // 「结」挡：切到训练页，训练页 onShow 会把小结弹出来
  orbSummary() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  // 打开随手记弹层（供快捷入口/测试调用）
  openQuickNote() {
    const c = this.selectComponent('#orb');
    if (c && c.openNote) c.openNote();
  }
});

