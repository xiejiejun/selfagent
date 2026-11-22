const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');

const SUGGEST = ['这周训练量够吗？', '哪个部位练得最少？', '给我的下周排个计划'];

Page({
  data: {
    range: 30,
    volume: 0,
    days: 0,
    avgVolume: 0,
    parts: [],
    tops: [],
    q: '',
    asking: false,
    answer: '',
    suggest: SUGGEST,
    cloudReady: false
  },

  onShow() {
    this.refresh();
    const app = getApp();
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
  },

  refresh() {
    const train = engine.ensureTrain(store.getTrain());
    const days = engine.lastNDays(train, this.data.range);
    const trained = days.filter(d => d.volume > 0 || d.cardioMin > 0).length;
    const totalVolume = days.reduce((a, d) => a + d.volume, 0);
    const parts = engine.partStats(train, this.data.range);
    const maxPart = parts.reduce((a, p) => Math.max(a, p.volume), 1);
    this.setData({
      volume: totalVolume,
      days: trained,
      avgVolume: trained ? Math.round(totalVolume / trained) : 0,
      parts: parts.slice(0, 6).map(p => ({ part: p.part, volume: p.volume, w: Math.max(8, Math.round(p.volume / maxPart * 100)) })),
      tops: engine.topExercises(train, this.data.range, 5)
    });
  },

  switchRange(e) {
    this.setData({ range: Number(e.currentTarget.dataset.n) });
    this.refresh();
  },

  onInput(e) {
    this.setData({ q: e.detail.value });
  },

  useSuggest(e) {
    this.setData({ q: e.currentTarget.dataset.t });
    this.ask();
  },

  contextText() {
    const train = engine.ensureTrain(store.getTrain());
    const days = engine.lastNDays(train, this.data.range);
    const parts = engine.partStats(train, this.data.range);
    const tops = engine.topExercises(train, this.data.range, 5);
    const profile = store.getProfile() || {};
    return [
      '【个人】身高' + (profile.height || '-') + 'cm 体重' + (profile.weight || '-') + 'kg 目标' + (profile.goal || '-'),
      '【近' + this.data.range + '天】训练 ' + this.data.days + ' 天，总容量 ' + this.data.volume + 'kg',
      '【部位分布】' + parts.map(p => p.part + ' ' + p.volume + 'kg').join('，'),
      '【高频动作】' + tops.map(t => t.name + ' ' + t.sets + '组/' + t.volume + 'kg').join('，'),
      '【最近 7 天】' + days.slice(0, 7).map(d => d.date.slice(5) + ':' + d.done + '组/' + d.volume + 'kg').join(' ')
    ].join('\n');
  },

  ask() {
    const q = (this.data.q || '').trim();
    if (!q) return;
    if (!this.data.cloudReady) {
      wx.showModal({
        title: '云开发未配置',
        content: '把云开发环境 ID 填进 app.js 的 CLOUD_ENV，并部署 aiProxy 云函数后可用。',
        showCancel: false
      });
      return;
    }
    this.setData({ asking: true, answer: '' });
    wx.cloud.callFunction({
      name: 'aiProxy',
      data: {
        messages: [
          { role: 'system', content: '你是健身教练兼数据分析助手。依据用户记录回答，中文，简洁，给可执行建议，不超过 200 字。' },
          { role: 'user', content: this.contextText() + '\n\n问题：' + q }
        ]
      }
    }).then(r => {
      const res = (r && r.result) || {};
      this.setData({ asking: false, answer: res.ok ? (res.text || '（空回答）') : ('调用失败：' + (res.error || '未知')) });
    }).catch(err => {
      this.setData({ asking: false, answer: '调用失败：' + (err && err.errMsg ? err.errMsg : err) });
    });
  }
});
