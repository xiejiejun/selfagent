const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');

const TMPL = 'whCghbXJjZbMzZACF7k5lhLSPynVFAUPzFvf7gXrWqM';

Page({
  data: {
    days: 3,
    setsPerDay: 12,
    remind: '20:00',
    week: [],
    weekDone: 0,
    planText: '',
    sub: false,
    subTs: '',
    asking: false,
    cloudReady: false
  },

  onShow() {
    const app = getApp();
    const s = store.getSettings() || {};
    const plan = s.plan || {};
    const sub = s.sub || {};
    const train = engine.ensureTrain(store.getTrain());
    const week = engine.lastNDays(train, 7).reverse();
    const target = plan.setsPerDay || this.data.setsPerDay;
    this.setData({
      cloudReady: !!(app && app.globalData && app.globalData.cloudReady),
      days: plan.days || this.data.days,
      setsPerDay: target,
      remind: plan.remind || this.data.remind,
      planText: plan.text || '',
      sub: !!sub.enabled,
      subTs: sub.tmplId ? '模板已绑定' : '',
      week: week.map(d => ({
        label: engine.shortDate(d.date),
        done: d.done,
        h: Math.max(6, Math.round(Math.min(1, d.done / Math.max(1, target)) * 100)),
        ok: d.done >= target
      })),
      weekDone: week.reduce((a, d) => a + d.done, 0)
    });
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
    if (!this.data.cloudReady) {
      wx.showModal({ title: '云开发未配置', content: '部署 aiProxy 后再用。', showCancel: false });
      return;
    }
    const train = engine.ensureTrain(store.getTrain());
    const parts = engine.partStats(train, 30);
    const tops = engine.topExercises(train, 30, 5);
    this.setData({ asking: true });
    wx.cloud.callFunction({
      name: 'aiProxy',
      data: {
        messages: [
          { role: 'system', content: '健身教练。按目标与记录给一周计划：每天一行“周几 动作 组×次”，最后一句注意点。中文 100 字内。' },
          { role: 'user', content: '目标：每周 ' + this.data.days + ' 天、每天 ' + this.data.setsPerDay + ' 组。\n近30天部位容量：' + parts.map(p => p.part + p.volume + 'kg').join('，') + '\n高频动作：' + tops.map(t => t.name).join('、') }
        ],
        max_tokens: 220,
        temperature: 0.3
      }
    }).then(r => {
      const res = (r && r.result) || {};
      if (res.ok && res.text) this.setData({ asking: false, planText: res.text });
      else this.fallbackPlan(parts, tops, res.error || '');
    }).catch(e => this.fallbackPlan(parts, tops, e && e.errMsg ? e.errMsg : ''));
  },

  // AI 不可用（超时/未配 Key）时按记录本地生成一份可执行计划
  fallbackPlan(parts, tops, err) {
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const days = Math.max(2, Math.min(6, this.data.days || 3));
    const picks = (tops || []).slice(0, days).map(t => t.name);
    const fill = ['深蹲', '卧推', '硬拉', '划船', '推举', '引体向上'];
    while (picks.length < days) picks.push(fill[picks.length % fill.length]);
    const per = Math.max(3, Math.round((this.data.setsPerDay || 12) / 3));
    const lines = picks.map((n, i) => dayNames[i] + ' ' + n + ' ' + per + '组×8-12次');
    const weight = (parts || []).slice(0, 2).map(p => p.part).join('/');
    const head = '按每周 ' + days + ' 天安排：';
    const tail = weight ? '注意：' + weight + '为主，隔天练、留 1 天休息。' : '注意：隔天练、留 1 天休息。';
    this.setData({ asking: false, planText: head + lines.join('；') + '。' + tail + (err ? '' : '') });
    wx.showToast({ title: 'AI 超时，已用本地计划', icon: 'none' });
  },

  subscribe() {
    wx.requestSubscribeMessage({
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
