const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const ai = require('../../libs/ai');
const ask = require('../../libs/ask');
const settings = require('../../libs/settings');
const progress = require('../../libs/progress');
const polish = require('../../libs/aipolish');

const MOOD_WORD = ['很糟', '低落', '一般', '不错', '很好'];
function moodLabel(v) { return MOOD_WORD[Math.max(0, Math.min(4, Math.round(v) - 1))]; }

const SUGGEST = ['本周练了几次', '本周容量多少', '状态最差的一天', '最久没练的部位'];
const REST_SLOTS = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
const REST_ROWS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function deltaText(cur, prev) {
  if (prev == null || !isFinite(prev) || prev === 0) return { d: cur > 0 ? '新增' : '—', tone: cur > 0 ? 'up' : 'flat' };
  const diff = cur - prev;
  if (!diff) return { d: '持平', tone: 'flat' };
  const pct = Math.round(Math.abs(diff) / Math.abs(prev) * 100);
  return { d: (diff > 0 ? '↑' : '↓') + (pct || 1) + '%', tone: diff > 0 ? 'up' : 'down' };
}

function avgOf(list) {
  const a = (list || []).filter(x => typeof x === 'number' && x > 0);
  if (!a.length) return null;
  return Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
}

// 模型回答里常带 Markdown 标记和分片解码残留的替换符，纯文本展示前先清洗
function cleanMd(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
    kl: { train: '训练', energy: '精力', mood: '情绪', part: '部位', gap: '补短板', note: '记录', fill: '待补', rest: '进步' },
    bins: [],
    barLabels: [],
    barVals: [],
    barOK: false,
    lineLabels: [],
    lineSeries: [],
    lineOK: false,
    openIns: -1,
    askOpen: false,
    insights: [],
    heat: [],
    heatMax: 0,
    restNotes: [],
    hasData: false,
    hasNotes: false,
    q: '',
    asking: false,
    answer: '',
    local: null,
    suggest: SUGGEST,
    cloudReady: false,
    // 进步 tab
    prog: null,
    curve: null,
    curveSel: 0,
    aiPure: false,
    aiPush: '',
    aiTrend: '',
    aiTomorrow: '',
    // 多轮问 AI
    chat: [],
    thinking: false
  },

  onShow() {
    const app = getApp();
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
    this.refresh();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.t;
    this.setData({ tab }, () => {
      if (tab === 'progress') {
        setTimeout(() => this.drawProgress(), 120);
      }
    });
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

    // 环比：同长度上一个时间窗
    const prevDays = engine.lastNDays(train, this.data.range * 2).slice(this.data.range);
    const prevTrained = prevDays.filter(d => d.volume > 0 || d.cardioMin > 0).length;
    const prevVolume = prevDays.reduce((a, d) => a + d.volume, 0);
    const cardioMin = days.reduce((a, d) => a + (d.cardioMin || 0), 0);
    const prevCardio = prevDays.reduce((a, d) => a + (d.cardioMin || 0), 0);
    const prevWeek = engine.lastNDays(train, 14).slice(7);
    const prevWeekSets = prevWeek.reduce((a, d) => a + d.done, 0);
    const dv1 = deltaText(trained, prevTrained);
    const dv2 = deltaText(weekSets, prevWeekSets);
    const dv3 = deltaText(totalVolume, prevVolume);
    const dv4 = deltaText(cardioMin, prevCardio);

    const kpis = [
      { v: trained, l: '训练天数', d: dv1.d, tone: dv1.tone, n: '近 ' + this.data.range + ' 天' },
      { v: weekSets, l: '本周组数', d: dv2.d, tone: dv2.tone, n: weekDays.length + ' 天' },
      { v: totalVolume, l: '总容量', d: dv3.d, tone: dv3.tone, n: trained ? '日均 ' + Math.round(totalVolume / trained) + ' kg' : '' },
      { v: cardioMin, l: '有氧分钟', d: dv4.d, tone: dv4.tone, n: cardioMin ? '近 ' + this.data.range + ' 天' : '还没记有氧' }
    ];

    // 图表数据：近 7 天容量（时间正序）+ 精力/情绪双线
    const weekAsc = engine.lastNDays(train, 7).reverse();
    const bins = weekAsc.map(d => ({ label: engine.shortDate(d.date), v: d.volume }));
    const barLabels = bins.map(b => b.label);
    const barVals = bins.map(b => b.v);
    const barOK = barVals.some(v => v > 0);
    const recentAsc = notes
      .filter(l => l && l.date && (Number(l.score) > 0 || Number(l.mood) > 0))
      .sort((a, b) => String(a.time || a.date).localeCompare(String(b.time || b.date)))
      .slice(-7);
    const lineLabels = recentAsc.map(l => String(l.date).slice(5));
    const lineSeries = [
      { color: '#12A594', data: recentAsc.map(l => Number(l.score) > 0 ? Number(l.score) : null) },
      { color: '#E3B341', data: recentAsc.map(l => Number(l.mood) > 0 ? Number(l.mood) : null) }
    ];
    const lineOK = recentAsc.filter(l => Number(l.score) > 0 && Number(l.mood) > 0).length >= 3;

    // 依据 chips：每张洞察卡都能点开看证据，再跳记录页
    const evParts = parts.slice(0, 3).map(p => ({ t: p.part, v: p.volume.toLocaleString() + ' kg' }));
    const evTrainDays = days.filter(d => d.volume > 0 || d.cardioMin > 0).slice(0, 3).map(d => {
      const it = d.items && d.items[0];
      return { t: engine.shortDate(d.date) + (it && it.part ? ' · ' + it.part : ''), v: d.done + '组 · ' + d.volume + 'kg' };
    });
    const evNotes = recent.slice(0, 3).map(l => ({
      t: engine.shortDate(l.date),
      v: (Number(l.score) > 0 ? '精力 ' + Number(l.score) : '') + (Number(l.mood) > 0 ? ' 情绪 ' + moodLabel(Number(l.mood)) : '')
    }));

    const insights = [];
    const hasVol = parts.some(p => p.volume > 0);
    if (parts.length && hasVol) {
      const top = parts[0];
      const least = parts.length > 1 ? parts[parts.length - 1] : null;
      const topPct = Math.round(top.volume / maxPart * 100);
      const leastPct = least ? Math.round(least.volume / maxPart * 100) : 0;
      if (least && leastPct < 15) {
        insights.push({
          k: 'gap',
          t: least.part + ' 只占容量 ' + leastPct + '%',
          v: least.volume + ' kg',
          sub: '下次训练可以补一组 ' + least.part,
          ev: evParts
        });
      }
      insights.push({
        k: 'part',
        t: top.part + ' 是这段时间的主力',
        v: topPct + '%',
        sub: '占容量 ' + top.volume + ' kg' + (least ? ' · 最少是 ' + least.part : ''),
        ev: evParts
      });
    }
    insights.push({
      k: 'train',
      t: weekDays.length ? '本周已经练了 ' + weekDays.length + ' 天' : '本周还没有训练',
      v: weekDays.length ? weekSets + ' 组' : '0 组',
      sub: weekDays.length ? (weekVolume > 0 ? weekVolume.toLocaleString() + ' kg 总容量' : '有训练，但容量还没数') : '从动作库挑一个开始',
      ev: evTrainDays
    });
    if (energy !== null) {
      insights.push({ k: 'energy', t: '精力均值 ' + energy.toFixed(1), v: energy.toFixed(1) + '/5', sub: '近 7 条记录的均值', ev: evNotes });
    }
    if (mood !== null) {
      insights.push({ k: 'mood', t: '情绪落在「' + moodLabel(mood) + '」', v: mood.toFixed(1) + '/5', sub: '近 7 条记录的均值', ev: evNotes });
    }
    if (energy === null || mood === null) {
      insights.push({
        k: 'fill',
        t: '补两笔就能看精力与情绪趋势',
        v: '待补数据',
        sub: '随手记里滑动打分，记录时也可以选档位',
        ev: []
      });
    }

    // 置信度点：依据越多越实
    insights.forEach(it => {
      const n = (it.ev || []).length;
      it.conf = n >= 3 ? '●●●' : n === 2 ? '●●○' : n === 1 ? '●○○' : '';
    });

    const heat = this.buildHeat(notes);
    this.setData({
      volume: totalVolume,
      days: trained,
      avgVolume: trained ? Math.round(totalVolume / trained) : 0,
      parts: parts.slice(0, 6).map(p => ({ part: p.part, volume: p.volume, w: Math.max(8, Math.round(p.volume / maxPart * 100)) })),
      tops,
      kpis,
      bins,
      barLabels,
      barVals,
      barOK,
      lineLabels,
      lineSeries,
      lineOK,
      insights,
      heat: heat.rows,
      heatMax: heat.max,
      restNotes: heat.notes,
      hasData: trained > 0,
      hasNotes: notes.length > 0,
      unlocked: trained >= 3
    });
    this.aiInsights(insights);
    this.buildProgress(train);
  },

  /* ---------- 进步 tab ---------- */
  buildProgress(train) {
    const p = progress.build(train, this.data.range);
    const curve = p.curves[this.data.curveSel] || p.curves[0] || null;
    this.setData({
      prog: p,
      curve,
      curveSel: p.curves.indexOf(curve) >= 0 ? p.curves.indexOf(curve) : 0,
      aiPure: !polish.enabled()
    }, () => {
      if (this.data.tab === 'progress') this.drawProgress();
    });
    this.aiProgress(p);
  },

  drawProgress() {
    const p = this.data.prog || {};
    this.drawRadar(p.radar || []);
    this.drawCurve(this.data.curve);
  },

  // 六边形雷达（周容量分布）
  drawRadar(rows) {
    if (!rows.length) return;
    const ctx = wx.createCanvasContext('radar', this);
    const w = 300, h = 300, cx = w / 2, cy = h / 2 + 6, R = 100;
    const n = rows.length;
    const max = Math.max(1, ...rows.map(r => r.volume));
    ctx.setLineWidth(1);
    // 网格 3 圈
    for (let ring = 1; ring <= 3; ring++) {
      ctx.setStrokeStyle(ring === 3 ? '#D7E2DE' : '#EDF3F1');
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
        const rr = R * ring / 3;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 轴线
    ctx.setStrokeStyle('#EDF3F1');
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
    // 数据面
    ctx.beginPath();
    rows.forEach((r, i) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      const rr = R * Math.max(0.06, r.volume / max);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.setFillStyle('rgba(18,165,148,0.16)');
    ctx.fill();
    ctx.setStrokeStyle('#12A594');
    ctx.setLineWidth(2);
    ctx.stroke();
    // 顶点与标签
    rows.forEach((r, i) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      const rr = R * Math.max(0.06, r.volume / max);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      ctx.beginPath(); ctx.setFillStyle('#12A594'); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      const lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 18) + 5;
      ctx.setFillStyle(r.volume ? '#14181A' : '#B6BEBB');
      ctx.setFontSize(12);
      ctx.setTextAlign('center');
      ctx.fillText(r.label, lx, ly);
    });
    ctx.draw();
  },

  // e1RM 折线（单动作）
  drawCurve(c) {
    if (!c || !c.points || !c.points.length) {
      const ctx = wx.createCanvasContext('curve', this);
      ctx.setFillStyle('#A6AFAB'); ctx.setFontSize(13); ctx.setTextAlign('center');
      ctx.fillText('这个动作还不足两次重量记录', 150, 90);
      ctx.draw();
      return;
    }
    const ctx = wx.createCanvasContext('curve', this);
    const w = 300, h = 150, padL = 16, padR = 16, padT = 20, padB = 22;
    const pts = c.points;
    const ys = pts.map(p => p.e);
    const min = Math.min(...ys), max = Math.max(...ys);
    const span = Math.max(1, max - min);
    const px = i => padL + (pts.length === 1 ? (w - padL - padR) / 2 : (w - padL - padR) * i / (pts.length - 1));
    const py = v => padT + (h - padT - padB) * (1 - (v - min) / span);
    // 底线
    ctx.setStrokeStyle('#EDF3F1'); ctx.setLineWidth(1);
    ctx.beginPath(); ctx.moveTo(padL, h - padB); ctx.lineTo(w - padR, h - padB); ctx.stroke();
    // 主线
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(px(i), py(p.e)); else ctx.lineTo(px(i), py(p.e)); });
    ctx.setStrokeStyle('#12A594'); ctx.setLineWidth(2); ctx.stroke();
    // 点与数值
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.setFillStyle(i === pts.length - 1 ? '#12A594' : '#9FD8CE');
      ctx.arc(px(i), py(p.e), i === pts.length - 1 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.setFillStyle('#8A9490'); ctx.setFontSize(10); ctx.setTextAlign('left');
    ctx.fillText(pts[0].date.slice(5), padL, h - 8);
    ctx.setTextAlign('right');
    ctx.fillText(pts[pts.length - 1].date.slice(5), w - padR, h - 8);
    ctx.setTextAlign('left');
    ctx.setFillStyle('#14181A'); ctx.setFontSize(12);
    ctx.fillText(Math.round(pts[pts.length - 1].e) + 'kg', padL, 14);
    ctx.draw();
  },

  selCurve(e) {
    const i = Number(e.currentTarget.dataset.i);
    const c = (this.data.prog && this.data.prog.curves[i]) || null;
    this.setData({ curveSel: i, curve: c }, () => this.drawCurve(c));
  },

  // 进步 tab 三条 AI 洞察：规则数字已在本地算好，AI 只做一句话表达
  aiProgress(p) {
    if (!p || !this.data.cloudReady || !polish.enabled()) return;
    polish.polish('pushpull', p.pushPull, '一句话指出推拉是否均衡，给一个补的动作方向')
      .then(r => { if (r.ok) this.setData({ aiPush: r.text }); });
    if (p.forecast) {
      polish.polish('forecast', p.forecast, '一句话说明当前趋势和达成时间，别重复数字堆砌')
        .then(r => { if (r.ok) this.setData({ aiTrend: r.text }); });
    }
    polish.polish('tomorrow', p.tomorrow, '一句话说明明天该练哪个部位，理由简短')
      .then(r => { if (r.ok) this.setData({ aiTomorrow: r.text }); });
  },

  // 洞察卡 AI 扩写（同 facts 命中缓存）
  aiInsights(insights) {
    if (!this.data.cloudReady || !polish.enabled()) return;
    const list = insights.slice(0, 3);
    list.forEach((it, i) => {
      polish.polish('ins:' + i + ':' + it.k, { t: it.t, v: it.v, sub: it.sub },
        '用一句人话点评这张洞察卡，别加建议清单')
        .then(r => {
          if (!r.ok) return;
          const cur = this.data.insights || [];
          const idx = cur.findIndex(x => x.t === it.t && x.k === it.k);
          if (idx >= 0) this.setData({ ['insights[' + idx + '].ai']: r.text });
        });
    });
  },

  togglePure() {
    const next = !polish.enabled() ? false : true;
    polish.setPureData(next);
    this.setData({ aiPure: next, aiPush: '', aiTrend: '', aiTomorrow: '' });
    if (!next) this.aiProgress(this.data.prog);
    wx.showToast({ title: next ? '纯数据模式：AI 扩写已关' : 'AI 扩写已开', icon: 'none' });
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

  // 洞察卡展开依据 / 收起（同一条目点击切换）
  toggleIns(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ openIns: this.data.openIns === i ? -1 : i });
  },

  // 问 AI 收敛为一处：顶部胶囊 → 半屏 sheet
  openAsk() { this.setData({ askOpen: true }); },
  closeAsk() { this.setData({ askOpen: false }); },
  noop() {},

  goEv() { this.goLog(); },

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
    if (!q || this.data.asking) return;
    // 先给本地规则结论（不联网也能答）
    const local = ask.answer(q, engine.ensureTrain(store.getTrain()), store.getLogs() || []);

    const custom = ai.cfg();
    if (!this.data.cloudReady && !(custom.baseUrl && custom.apiKey)) {
      this.setData({ local, asking: false });
      if (!local) {
        wx.showModal({ title: 'AI 未连接', content: '配置自定义 Agent API，或部署 aiProxy 云函数后可用。', showCancel: false });
      }
      return;
    }
    // 多轮：把之前的对话一起带上，追问能承接上下文
    const chat = (this.data.chat || []).concat([{ r: 'u', t: q }]).slice(-12);
    const history = chat.slice(-7, -1).map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
    this.setData({ asking: true, q: '', local, chat });
    ai.ask({
      messages: [
        { role: 'system', content: '你是健身教练兼数据分析助手。依据用户记录回答，中文，简洁，给可执行建议，不超过 200 字。追问时承接上文，不要重复已经说过的结论。' },
        ...history,
        { role: 'user', content: this.contextText() + '\n\n问题：' + q }
      ],
      max_tokens: 400,
      temperature: 0.4
    }).then(res => {
      const t = res.ok ? cleanMd(res.text || '（空回答）') : ('调用失败：' + (res.error || '未知'));
      this.setData({ asking: false, chat: chat.concat([{ r: 'a', t }]) });
    }).catch(err => {
      this.setData({ asking: false, chat: chat.concat([{ r: 'a', t: '调用失败：' + (err && err.errMsg ? err.errMsg : err) }]) });
    });
  },

  clearChat() {
    this.setData({ chat: [], local: null, answer: '' });
  },

  goLog() {
    wx.switchTab({ url: '/pages/log/index' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/agent-report/index' });
  },

  goTrain() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  orbFocus() {
    wx.navigateTo({ url: '/pages/focus/index' });
  },

  orbNoted() {
    this.refresh();
  }
});
