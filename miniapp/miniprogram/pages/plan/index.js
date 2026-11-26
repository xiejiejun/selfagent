const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const recommend = require('../../libs/recommend');
const decision = require('../../libs/decision');
const ai = require('../../libs/ai');
const sanity = require('../../libs/sanity');

const TMPL = 'whCghbXJjZbMzZACF7k5lhLSPynVFAUPzFvf7gXrWqM';

Page({
  data: {
    days: 3,
    setsPerDay: 12,
    remind: '20:00',
    week: [],
    weekDone: 0,
    planText: '',
    rec: null,
    recReason: '',
    importing: false,
    askingWhy: false,
    sub: false,
    subTs: '',
    asking: false,
    cloudReady: false,
    weekly: null,
    weeklyOpen: true,
    plateau: [],
    qPart: '',
    weeklyOpts: []
  },

  onLoad(q) {
    this.qPart = recommend.normalizePart((q && q.part) || '');
  },

  onShow() {
    const app = getApp();
    const s = store.getSettings() || {};
    const plan = s.plan || {};
    const sub = s.sub || {};
    const train = engine.ensureTrain(store.getTrain());
    const custom = actions.customList();
    const week = engine.lastNDays(train, 7).reverse();
    const target = plan.setsPerDay || this.data.setsPerDay;

    let rec = recommend.recommend(train, custom);
    const qp = this.qPart || this.data.qPart || '';
    if (qp) rec = recommend.recommendFor(train, custom, qp);
    const today = engine.dayKey();
    const joinedIds = (train.records || []).filter(r => r.date === today).map(r => r.exId);
    rec.items = (rec.items || []).map(i => Object.assign({}, i, {
      joined: joinedIds.indexOf(i.exId) >= 0,
      line: i.dur ? ('有氧 ' + i.dur + '′') : ((i.weight > 0 ? engine.wText(i.weight, engine.isUniName(i.name)) + ' ' : '自重 ') + i.sets + '×' + i.reps)
    }));

    const wd = decision.weekly(train);
    const trainDays = (wd.days || []).filter(d => d.part).length;
    const pl = decision.plateau(train).map(x => Object.assign({}, x, { pick: (plan.strategy && plan.strategy[x.name]) || '' }));

    this.setData({
      cloudReady: !!(app && app.globalData && app.globalData.cloudReady),
      days: plan.days || this.data.days,
      setsPerDay: target,
      remind: plan.remind || this.data.remind,
      planText: plan.text || '',
      rec,
      qPart: qp,
      weekly: wd,
      weeklyOpen: plan.weeklyDone !== engine.dayKey(),
      weeklyOpts: [
        { key: 'apply', label: '按此生成 7 天计划', sub: trainDays + ' 天训练 + ' + (7 - trainDays) + ' 天休', rec: true },
        { key: 'me', label: '我自己排', sub: '保留现有计划', rec: false }
      ],
      plateau: pl,
      sub: !!sub.enabled,
      subTs: sub.tmplId ? '模板已绑定' : '',
      week: week.map(d => ({
        label: engine.shortDate(d.date),
        done: d.done,
        h: Math.max(6, Math.round(Math.min(1, d.done / Math.max(1, target)) * 100)),
        ok: d.done >= target
      })),
      weekDone: week.reduce((a, d) => a + d.done, 0)
    }, () => this.autoWeekly(wd));
  },

  // L3：周日或周目标达成时，自动套用下周排布（每天一次，可撤销）
  autoWeekly(wd) {
    if (!decision.autoOn() || !wd) return;
    if (decision.autoDone() === 'weekly') return;
    const isSunday = new Date().getDay() === 0;
    const goalDays = this.data.days || 3;
    const weekTrain = (this.data.week || []).filter(d => d.ok).length;
    if (!isSunday && weekTrain < goalDays) return;
    decision.setAutoDone('weekly');
    this.applyWeekly(true);
  },

  // 一键套用下周排布（写进计划文本 + 周天数）
  applyWeekly(auto) {
    const wd = this.data.weekly;
    if (!wd) return;
    const s = store.getSettings() || {};
    const prev = { text: (s.plan && s.plan.text) || '', days: (s.plan && s.plan.days) || 3, weeklyDone: (s.plan && s.plan.weeklyDone) || '' };
    const trainDays = (wd.days || []).filter(d => d.part).length;
    s.plan = Object.assign({}, s.plan, { text: wd.planText, days: Math.max(2, trainDays), weeklyDone: engine.dayKey(), seq: wd.text });
    store.setSettings(s);
    decision.addOp({
      key: 'weekly', auto: !!auto,
      title: '套用下周排布',
      desc: wd.text + (auto ? '（AI 自动执行）' : ''),
      undo: { kind: 'plan', prev }
    });
    this.setData({ weeklyOpen: false, planText: wd.planText, days: Math.max(2, trainDays) });
    wx.showToast({ title: auto ? '已自动套用下周排布' : '已套用下周排布', icon: 'none' });
  },

  dismissWeekly() {
    const s = store.getSettings() || {};
    s.plan = Object.assign({}, s.plan, { weeklyDone: engine.dayKey() });
    store.setSettings(s);
    this.setData({ weeklyOpen: false });
  },

  onWeeklyPick(e) {
    const k = (e && e.detail && e.detail.key) || '';
    if (k === 'apply') this.applyWeekly(false);
    else this.dismissWeekly();
  },

  // 平台期：三个策略选一个，写进下周计划
  fixPlateau(e) {
    const i = Number(e.currentTarget.dataset.i);
    const k = e.currentTarget.dataset.k;
    const it = (this.data.plateau || [])[i];
    if (!it) return;
    const map = {
      load: { t: '下周 +2.5kg', d: '先加 2.5kg，做不满 8 次就退回原重量' },
      swap: { t: '换同部位动作', d: '换成同类另一动作，换刺激面' },
      deload: { t: '减量 20%', d: '下周降到 80% 重量，做满 3×12 再爬回来' }
    }[k];
    if (!map) return;
    const s = store.getSettings() || {};
    s.plan = Object.assign({}, s.plan, { strategy: Object.assign({}, (s.plan && s.plan.strategy) || {}, { [it.name]: k }) });
    store.setSettings(s);
    decision.addOp({ key: 'plateau', title: it.name + ' · ' + map.t, desc: map.d, undo: { kind: 'plan', prev: { strategy: (s.plan && s.plan.strategy) || {} } } });
    this.setData({ ['plateau[' + i + '].pick']: k });
    wx.showToast({ title: map.t + ' 已记下', icon: 'none' });
  },

  pickDays(e) { const n = Number(e.currentTarget.dataset.n); if (n >= 1 && n <= 7) this.setData({ days: n }); },
  onSets(e) { this.setData({ setsPerDay: Math.max(1, parseInt(e.detail.value, 10) || 12) }); },
  onRemind(e) { this.setData({ remind: e.detail.value }); },

  save() {
    const s = store.getSettings() || {};
    s.plan = Object.assign({}, s.plan, {
      days: this.data.days, setsPerDay: this.data.setsPerDay,
      remind: this.data.remind, text: this.data.planText
    });
    store.setSettings(s);
    this.onShow();
    wx.showToast({ title: '计划已保存', icon: 'none' });
  },

  askPlan() {
    const custom = ai.cfg();
    if (!this.data.cloudReady && !(custom.baseUrl && custom.apiKey)) {
      wx.showModal({ title: 'AI 未配置', content: '配置自定义 Agent API 或部署 aiProxy 后再用。', showCancel: false });
      return;
    }
    const train = engine.ensureTrain(store.getTrain());
    const parts = engine.partStats(train, 30);
    const tops = engine.topExercises(train, 30, 5);
    this.setData({ asking: true });
    ai.ask({
      messages: [
        { role: 'system', content: '健身教练。按目标与记录给一周计划：每天一行“周几 动作 组×次”，最后一句注意点。中文 100 字内。自重动作容量记 0，判断部位练没练看组数。' },
        { role: 'user', content: '目标：每周 ' + this.data.days + ' 天、每天 ' + this.data.setsPerDay + ' 组。\n近30天部位（组数/容量）：' + parts.map(p => p.part + p.sets + '组/' + p.volume + 'kg').join('，') + '\n高频动作：' + tops.map(t => t.name).join('、') }
      ],
      max_tokens: 220,
      temperature: 0.3
    }).then(res => {
      if (res.ok && res.text) {
        const t = sanity.check(res.text, this.fallbackText(parts, tops), { max: 240, minCjk: 0.3 });
        this.setData({ asking: false, planText: t });
      } else this.fallbackPlan(parts, tops, res.error || '');
    }).catch(e => this.fallbackPlan(parts, tops, e && e.errMsg ? e.errMsg : ''));
  },

  // AI 不可用（超时/未配 Key）时按记录本地生成一份可执行计划
  fallbackText(parts, tops) {
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const days = Math.max(2, Math.min(6, this.data.days || 3));
    const picks = (tops || []).slice(0, days).map(t => t.name);
    const fill = ['深蹲', '卧推', '硬拉', '划船', '推举', '引体向上'];
    while (picks.length < days) picks.push(fill[picks.length % fill.length]);
    const per = Math.max(3, Math.round((this.data.setsPerDay || 12) / 3));
    const lines = picks.map((n, i) => dayNames[i] + ' ' + n + ' ' + per + '组×8-12次');
    const weight = (parts || []).slice(0, 2).map(p => p.part).join('/');
    const tail = weight ? '注意：' + weight + '为主，隔天练、留 1 天休息。' : '注意：隔天练、留 1 天休息。';
    return '按每周 ' + days + ' 天安排：' + lines.join('；') + '。' + tail;
  },

  fallbackPlan(parts, tops, err) {
    this.setData({ asking: false, planText: this.fallbackText(parts, tops) });
    wx.showToast({ title: 'AI 超时，已用本地计划', icon: 'none' });
  },

  importToday() {
    if (!this.data.rec || !this.data.rec.items.length) return;
    const today = engine.dayKey();
    let added = 0;
    this.data.rec.items.forEach(i => {
      const exists = (store.getTrain().records || []).some(r => r.date === today && r.exId === i.exId);
      if (i.dur) {
        if (!exists) { actions.saveCardio({ date: today, modal: i.name, name: i.name, min: i.dur, done: false }); added++; }
        return;
      }
      if (exists) return;
      const groups = [];
      for (let g = 0; g < i.sets; g++) groups.push({ no: g + 1, reps: i.reps, weight: i.weight || 0, done: false, warmup: false, rpe: 0, sec: 0 });
      actions.saveStrength({ date: today, exId: i.exId, name: i.name, part: i.part, sets: i.sets, reps: i.reps, weight: i.weight || 0, groups });
      added++;
    });
    this.onShow();
    wx.showToast({ title: '已加入今日 ' + added + ' 项', icon: 'none' });
  },

  aiWhy() {
    const custom = ai.cfg();
    if (!this.data.cloudReady && !(custom.baseUrl && custom.apiKey)) {
      wx.showModal({ title: 'AI 未配置', content: '配置自定义 Agent API 或部署 aiProxy 后再用。', showCancel: false });
      return;
    }
    const rec = this.data.rec;
    if (!rec) return;
    this.setData({ askingWhy: true });
    ai.ask({
      messages: [
        { role: 'system', content: '健身教练。结合部位恢复与历史记录，用 60 字内说明今天推荐练这个部位的理由。' },
        { role: 'user', content: '推荐部位：' + rec.part + '；恢复：' + rec.recovery.text + '；动作：' + rec.items.map(i => i.name).join('、') }
      ],
      max_tokens: 160,
      temperature: 0.3
    }).then(r => {
      const t = r.ok ? sanity.check(r.text, rec.recovery.text, { max: 80, minCjk: 0.3 }) : 'AI 暂不可用';
      this.setData({ askingWhy: false, recReason: t });
    })
      .catch(() => this.setData({ askingWhy: false, recReason: 'AI 暂不可用' }));
  },

  subscribe() {    wx.requestSubscribeMessage({
      tmplIds: [TMPL],
      success: (r) => {
        if (r[TMPL] !== 'accept') {
          wx.showToast({ title: '未授权提醒', icon: 'none' });
          return;
        }
        const s = store.getSettings() || {};
        s.sub = { enabled: true, tmplId: TMPL, remind: this.data.remind, ts: Date.now() };
        store.setSettings(s);
        this.setData({ sub: true, subTs: '模板已绑定' });
        wx.cloud.callFunction({ name: 'notify', data: { action: 'bind', tmplId: TMPL, time: this.data.remind } })
          .then(() => wx.showToast({ title: '提醒已开启', icon: 'none' }))
          .catch(() => wx.showToast({ title: '已本地开启（云端登记失败）', icon: 'none' }));
      },
      fail: (e) => wx.showToast({ title: '订阅失败：' + (e && e.errMsg ? e.errMsg : ''), icon: 'none' })
    });
  },

  unsubscribe() {
    const s = store.getSettings() || {};
    s.sub = { enabled: false, tmplId: TMPL };
    store.setSettings(s);
    this.setData({ sub: false });
    if (this.data.cloudReady) wx.cloud.callFunction({ name: 'notify', data: { action: 'unbind' } }).catch(() => {});
    wx.showToast({ title: '已关闭提醒', icon: 'none' });
  }
});
