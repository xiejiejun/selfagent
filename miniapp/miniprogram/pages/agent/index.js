const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');

const SUGGEST = ['这周训练量够吗？', '哪个部位练得最少？', '给我的下周排个计划'];
const REST_SLOTS = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
const REST_ROWS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function avgOf(list) {
  const a = (list || []).filter(x => typeof x === 'number' && x > 0);
  if (!a.length) return null;
  return Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
}

Page({
  data: {
    tab: 'overview',
    range: 30,
    volume: 0,
    days: 0,
    avgVolume: 0,
    parts: [],
    tops: [],
    kpis: [],
    insights: [],
    heat: [],
    heatMax: 0,
    restNotes: [],
    hasData: false,
    hasNotes: false,
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

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t });
  },

  refresh() {
    const train = engine.ensureTrain(store.getTrain());
    const logs = store.getLogs() || [];
    const days = engine.lastNDays(train, this.data.range);
    const trained = days.filter(d => d.volume > 0 || d.cardioMin > 0).length;
    const totalVolume = days.reduce((a, d) => a + d.volume, 0);
    const parts = engine.partStats(train, this.data.range);
    const tops = engine.topExercises(train, this.data.range, 5);
    const maxPart = parts.reduce((a, p) => Math.max(a, p.volume), 1);
    const week = engine.lastNDays(train, 7);
    const weekDays = week.filter(d => d.volume > 0 || d.cardioMin > 0);
    const weekSets = week.reduce((a, d) => a + d.done, 0);
    const weekVolume = week.reduce((a, d) => a + d.volume, 0);
    const notes = logs.filter(l => l.kind !== 'train');
    const recent = notes.slice().sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).slice(0, 7);
    const energy = avgOf(recent.map(l => Number(l.score)));
    const mood = avgOf(recent.map(l => Number(l.mood)));

    const trainDays = trained;
    const kpis = [
      { v: trainDays, l: '训练天数', n: trainDays ? '近 ' + this.data.range + ' 天' : '先去练一次' },
      { v: totalVolume, l: '总容量 kg', n: trainDays ? '日均 ' + Math.round(totalVolume / trainDays) + ' kg' : '' },
      { v: trainDays ? Math.round(totalVolume / trainDays) : 0, l: '日均 kg', n: trainDays < 3 ? '满 3 天可看部位分布' : '' }
    ];

    const insights = [];
    insights.push({
      k: 'train',
      t: '本周训练',
      v: weekDays.length ? weekDays.length + ' 天' : '还没开始',
      sub: weekDays.length ? (weekSets + ' 组 · ' + weekVolume.toLocaleString() + ' kg') : '本周还没有训练记录'
    });
    insights.push({
      k: 'energy',
      t: '精力',
      v: energy === null ? '—' : energy.toFixed(1),
      sub: energy === null ? '随手记里打精力分，就能看趋势' : '近 7 条记录均值'
    });
    insights.push({
      k: 'mood',
      t: '情绪',
      v: mood === null ? '—' : mood.toFixed(1),
      sub: mood === null ? '记录时选个心情，攒出情绪曲线' : '近 7 条记录均值'
    });
    if (parts.length) {
      const top = parts[0];
      insights.push({ k: 'part', t: '练得最多', v: top.part, sub: '占容量 ' + Math.round(top.volume / maxPart * 100) + '% · ' + top.volume + ' kg' });
      if (parts.length > 1) {
        const least = parts[parts.length - 1];
        insights.push({ k: 'gap', t: '练得最少', v: least.part, sub: '只有 ' + least.volume + ' kg，下次可以补一组' });
      }
    }
    if (notes.length) {
      const last = notes.slice().sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))[0];
      insights.push({
        k: 'note',
        t: '最近一条记录',
        v: engine.fmtTime(last.time),
        sub: (last.content || '').slice(0, 40)
      });
    }

    const heat = this.buildHeat(notes);
    this.setData({
      volume: totalVolume,
      days: trained,
      avgVolume: trained ? Math.round(totalVolume / trained) : 0,
      parts: parts.slice(0, 6).map(p => ({ part: p.part, volume: p.volume, w: Math.max(8, Math.round(p.volume / maxPart * 100)) })),
      tops,
      kpis,
      insights,
      heat: heat.rows,
      heatMax: heat.max,
      restNotes: heat.notes,
      hasData: trained > 0,
      hasNotes: notes.length > 0
    });
  },

  // 星期×时段热力：只看记录发生的时间，不猜作息
  buildHeat(notes) {
    const counts = [];
    for (let r = 0; r < 7; r++) counts.push([0, 0, 0, 0, 0, 0]);
    let max = 0;
    const slotCount = [0, 0, 0, 0, 0, 0];
    let lastMin = -1;
    let sleep = 0;
    notes.forEach(l => {
      const d = new Date(l.time || '');
      if (isNaN(d.getTime())) return;
      const wd = (d.getDay() + 6) % 7;
      const si = Math.min(5, Math.floor(d.getHours() / 4));
      counts[wd][si]++;
      slotCount[si]++;
      const mins = d.getHours() * 60 + d.getMinutes();
      if (mins > lastMin) lastMin = mins;
      const txt = (l.content || '') + (l.tags || '');
      if (/睡|失眠|熬夜|早醒|困/.test(txt)) sleep++;
    });
    counts.forEach(row => row.forEach(n => { if (n > max) max = n; }));
    const rows = counts.map((row, i) => ({
      label: REST_ROWS[i],
      cells: row.map(n => ({ n, w: n ? 1 + Math.round((n / max) * 2) : 0 }))
    }));
    const topSlot = slotCount.indexOf(Math.max.apply(null, slotCount));
    const notesOut = [];
    if (notes.length) {
      notesOut.push({ t: '最常记录', v: REST_SLOTS[topSlot] + ' 点段', sub: slotCount[topSlot] + ' 条记录落在这个时段' });
      notesOut.push({ t: '最晚一条', v: engine.fmtTime(new Date(2000, 0, 1, Math.floor(lastMin / 60), lastMin % 60).toISOString()), sub: '晚睡的日子会被这里盯上' });
      notesOut.push({ t: '睡眠相关', v: sleep + ' 条', sub: sleep ? '含「睡/熬夜/失眠」的记录' : '还没有睡眠类记录' });
    }
    return { rows, max, notes: notesOut };
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
        title: 'AI 未连接',
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
  },

  goLog() {
    wx.switchTab({ url: '/pages/log/index' });
  },

  orbFocus() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  orbNoted() {
    this.refresh();
  }
});
