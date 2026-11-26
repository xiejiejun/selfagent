const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const ai = require('../../libs/ai');
const ask = require('../../libs/ask');
const settings = require('../../libs/settings');
const progress = require('../../libs/progress');
const polish = require('../../libs/aipolish');
const sanity = require('../../libs/sanity');
const food = require('../../libs/food');

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

// ---- AI 扩写质量门：必须“数字对比 + 原因 + 行动”，且不许复读卡片标题 ----
const ACTION_RE = /(加|减|补|安排|换|降|提前|练|吃|睡|休息|调整|走|跑|多|少|控制|拆分|延长)/;
function bigrams(s) {
  const t = String(s || '').replace(/[\s，。、·：:；;！!？?（）()「」“”"'—\-]/g, '');
  const out = {};
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out[g] = (out[g] || 0) + 1;
  }
  return out;
}
function similar(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  Object.keys(A).forEach(k => { total += A[k]; });
  Object.keys(B).forEach(k => { total += B[k]; if (A[k]) inter += Math.min(A[k], B[k]); });
  if (!total) return 1;
  return (2 * inter) / total;
}
// ctx: 该卡片的标题 + 主数值，用来判“是否在复读”
function aiGood(text, ctx) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length < 10 || t.length > 90) return false;
  if (!/\d/.test(t)) return false;                       // 至少一个数字对比
  if (!ACTION_RE.test(t)) return false;                  // 至少一个行动
  const ref = ((ctx && ctx.t) || '') + ' ' + ((ctx && ctx.sub) || '');
  if (similar(t, ref) > 0.6) return false;               // 复读标题/副标题
  return true;
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
    // 组数口径：自重动作容量恒为 0，只看容量会把「悬垂卷腹」这类判成没练
    const setParts = parts.slice().sort((a, b) => (b.sets - a.sets) || (b.volume - a.volume));
    const totalSets = setParts.reduce((a, p) => a + p.sets, 0);
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

    // 训练 tab：容量 + 有氧双柱（时间正序，最多 14 天，柱才不会细成头发丝）
    const crossAsc = days.slice().reverse().slice(-14);
    const crossLabels = crossAsc.map(d => engine.shortDate(d.date));
    const crossVol = crossAsc.map(d => d.volume || 0);
    const crossCd = crossAsc.map(d => d.cardioMin || 0);
    const crossOK = crossVol.some(v => v > 0) || crossCd.some(v => v > 0);
    const crossVolSum = crossVol.reduce((a, v) => a + v, 0);
    const crossCdSum = crossCd.reduce((a, v) => a + v, 0);
    // 有氧构成：按项目汇总分钟
    const cdMap = {};
    days.forEach(d => (d.items || []).forEach(it => {
      if (it.type !== 'cardio' || it.skipped) return;
      cdMap[it.name] = (cdMap[it.name] || 0) + (it.min || 0);
    }));
    const cdList = Object.keys(cdMap).map(k => ({ name: k, min: cdMap[k] })).sort((a, b) => b.min - a.min);
    const cdTotal = cdList.reduce((a, x) => a + x.min, 0);
    const cdComp = cdList.slice(0, 5).map(x => ({
      name: x.name, min: x.min, pct: cdTotal ? Math.round(x.min / cdTotal * 100) : 0
    }));

    // 依据 chips：每张洞察卡都能点开看证据，再跳记录页
    const evParts = setParts.slice(0, 3).map(p => ({ t: p.part, v: p.sets + ' 组 · ' + p.volume.toLocaleString() + ' kg' }));
    const evTrainDays = days.filter(d => d.volume > 0 || d.cardioMin > 0).slice(0, 3).map(d => {
      const it = d.items && d.items[0];
      return { t: engine.shortDate(d.date) + (it && it.part ? ' · ' + it.part : ''), v: d.done + '组 · ' + d.volume + 'kg' };
    });
    const evNotes = recent.slice(0, 3).map(l => ({
      t: engine.shortDate(l.date),
      v: (Number(l.score) > 0 ? '精力 ' + Number(l.score) : '') + (Number(l.mood) > 0 ? ' 情绪 ' + moodLabel(Number(l.mood)) : '')
    }));

    // 近 7 条 vs 上一个 7 条：高亮卡的对比箭头
    const noteDesc = notes.filter(l => Number(l.score) > 0 || Number(l.mood) > 0)
      .sort((a, b) => String(b.time || b.date).localeCompare(String(a.time || a.date)));
    const lastSeven = noteDesc.slice(0, 7);
    const prevSeven = noteDesc.slice(7, 14);
    const ePrev = avgOf(prevSeven.map(l => Number(l.score)));
    const mPrev = avgOf(prevSeven.map(l => Number(l.mood)));
    const darrow = (cur, prev) => {
      if (cur == null) return '';
      if (prev == null) return ' 新增';
      const d = Math.round((cur - prev) * 10) / 10;
      if (!d) return ' → 持平';
      return ' ' + (d > 0 ? '↑' : '↓') + Math.abs(d);
    };
    const lowE = lastSeven.filter(l => Number(l.score) > 0 && Number(l.score) <= 2).length;
    const weekCardio = week.reduce((a, d) => a + (d.cardioMin || 0), 0);
    const poolParts = setParts.filter(p => p.part !== '其他');
    const leastSet = poolParts.length ? poolParts[poolParts.length - 1] : null;

    const insights = [];

    // 高亮卡 1：精力与情绪（折线 + 数字对比 + 一句话）
    insights.push({
      hi: true, chart: 'line', k: 'energy', t: '精力与情绪',
      v: energy == null ? '—' : energy.toFixed(1),
      stat: energy == null
        ? '还没有精力/情绪打分'
        : '精力 ' + energy.toFixed(1) + darrow(energy, ePrev) + ' · 情绪 ' + (mood == null ? '—' : mood.toFixed(1) + darrow(mood, mPrev)),
      sub: '近 ' + recent.length + ' 条记录 · ' + (lineOK ? '7 日双线' : '不足 3 条，先看示意'),
      fb: energy == null
        ? '先记满 3 条精力打分，这里才出可比曲线；单看一天的数字判断不了状态。'
        : '精力均值 ' + energy.toFixed(1) + '，最近 7 条里 ' + lowE + ' 条低于 3；连着低就先降一组重量再练。',
      ev: evNotes
    });

    // 高亮卡 2：训练容量（周柱 + 数字对比 + 一句话）
    insights.push({
      hi: true, chart: 'bar', k: 'train', t: '训练容量',
      v: weekVolume > 9999 ? (Math.round(weekVolume / 100) / 10) + 't' : String(weekVolume),
      stat: '本周 ' + weekDays.length + ' 天 · ' + weekSets + ' 组 · 有氧 ' + weekCardio + '′',
      sub: '近 7 天容量 · 环比 ' + dv3.d,
      fb: weekDays.length
        ? '本周 ' + weekSets + ' 组 / ' + weekVolume + 'kg，容量环比 ' + dv3.d + '；下次给' + (leastSet ? leastSet.part : '最弱部位') + '加 1 组。'
        : '本周 0 组，曲线还没有起点；今天做完第一个动作的 3 组，就有第一根柱。',
      ev: evTrainDays
    });

    const hasVol = parts.some(p => p.volume > 0 || p.sets > 0);
    if (parts.length && hasVol) {
      const top = setParts[0];
      const least = poolParts.length > 1 ? poolParts[poolParts.length - 1] : null;
      const topPct = totalSets ? Math.round(top.sets / totalSets * 100) : 0;
      const leastPct = least && totalSets ? Math.round(least.sets / totalSets * 100) : 0;
      if (least && leastPct < 15) {
        insights.push({
          k: 'gap',
          t: least.part + ' 只占 ' + leastPct + '% 组数',
          v: least.sets + ' 组',
          sub: least.sets
            ? '容量 ' + least.volume + ' kg，下次可以补一组 ' + least.part
            : '这段时间零组，下次可以补一组 ' + least.part,
          fb: least.part + ' 只有 ' + least.sets + ' 组，占总组数 ' + leastPct + '%；下一场先做它，放在最前面才不会省掉。',
          ev: evParts
        });
      }
      insights.push({
        k: 'part',
        t: top.part + ' 是这段时间的主力',
        v: topPct + '%',
        sub: top.sets + ' 组 · 容量 ' + top.volume + ' kg' + (least ? ' · 最少是 ' + least.part : ''),
        fb: top.part + ' 占 ' + topPct + '% 组数，容量 ' + top.volume + 'kg；比最少部位多 ' + Math.max(0, top.sets - (least ? least.sets : 0)) + ' 组，下周把比例往回匀一点。',
        ev: evParts
      });
    }
    // 饮食 vs 训练联动：训练日/休息日摄入对比（估算，只看趋势）
    const mtr = food.trend(store.getLogs(), this.data.range, train);
    if (mtr.dayCount >= 2) {
      const gap = mtr.trainAvg && mtr.restAvg ? (mtr.trainAvg - mtr.restAvg) : 0;
      insights.push({
        k: 'meal',
        t: gap > 100 ? '训练日吃得更够' : (gap < -100 ? '训练日反而吃得少' : '摄入基本持平'),
        v: mtr.avg + ' kcal',
        sub: '记录日均 · ' + mtr.text + (gap < -100 ? ' · 练完那顿可以补点蛋白' : ''),
        fb: gap < -100
          ? '训练日比休息日少 ' + Math.abs(gap) + 'kcal，练完那顿补 20g 蛋白更划算。'
          : '日均 ' + mtr.avg + 'kcal，训练日与休息日差 ' + Math.abs(gap) + 'kcal；先不调总量，把碳水上到练前那顿。',
        ev: [{ t: '记录', v: mtr.dayCount + ' 天' }, { t: '训练日', v: (mtr.trainAvg || 0) + ' kcal' }]
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
      parts: setParts.slice(0, 6).map(p => ({ part: p.part, volume: p.volume, sets: p.sets, w: Math.max(8, Math.round(p.sets / Math.max(1, setParts[0] && setParts[0].sets) * 100)) })),
      tops,
      kpis,
      bins,
      barLabels,
      barVals,
      barOK,
      lineLabels,
      lineSeries,
      lineOK,
      crossLabels,
      crossVol,
      crossCd,
      crossOK,
      crossVolSum,
      crossCdSum,
      cdComp,
      cdTotal,
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

  // 洞察卡 AI 扩写：过质量门（数字对比+原因+行动、不复读），不合格就退回本地模板
  aiInsights(insights) {
    const list = (insights || []).slice(0, 3);
    // 纯数据模式 / 未连接：直接用本地模板，卡片不留空
    if (!this.data.cloudReady || !polish.enabled()) {
      const patch = {};
      list.forEach((it, i) => { if (it.fb) patch['insights[' + i + '].ai'] = it.fb; });
      if (Object.keys(patch).length) this.setData(patch);
      return;
    }
    list.forEach((it, i) => {
      polish.polish('ins:' + it.k + ':' + i, { t: it.t, v: it.v, stat: it.stat, sub: it.sub },
        '一句话写法：给一个数字对比，点一个可能原因，再给今天能做的动作；40 字内，别复述卡片标题，别列清单')
        .then(r => {
          const txt = r.ok ? String(r.text || '').trim() : '';
          const ok = r.ok && aiGood(txt, { t: it.t, sub: it.sub });
          const out = ok ? txt : (it.fb || '');
          if (!out) return;
          const cur = this.data.insights || [];
          const idx = cur.findIndex(x => x.k === it.k && x.t === it.t);
          if (idx >= 0) this.setData({ ['insights[' + idx + '].ai']: out });
        });
    });
  },

  togglePure() {
    const next = !polish.enabled() ? false : true;
    polish.setPureData(next);
    this.setData({ aiPure: next, aiPush: '', aiTrend: '', aiTomorrow: '' });
    if (next) {
      // 切纯数据：AI 句退回本地模板，卡片不空
      const patch = {};
      (this.data.insights || []).slice(0, 3).forEach((it, i) => { if (it.fb) patch['insights[' + i + '].ai'] = it.fb; });
      this.setData(patch);
    } else {
      this.aiInsights(this.data.insights);
      this.aiProgress(this.data.prog);
    }
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
    const setParts = parts.slice().sort((a, b) => (b.sets - a.sets) || (b.volume - a.volume));
    const tops = engine.topExercises(train, this.data.range, 5);
    const profile = store.getProfile() || {};
    // 动作明细按组数排：自重动作容量 0，不列出来模型就以为没练
    const exMap = {};
    const cdMap = {};
    days.forEach(d => (d.items || []).forEach(it => {
      if (it.type === 'cardio') {
        if (!it.skipped) cdMap[it.name] = (cdMap[it.name] || 0) + (it.min || 0);
        return;
      }
      if (!it.done) return;
      exMap[it.name] = (exMap[it.name] || 0) + it.done;
    }));
    const exList = Object.keys(exMap).map(k => ({ k, v: exMap[k] })).sort((a, b) => b.v - a.v);
    const cdList = Object.keys(cdMap).map(k => k + ' ' + cdMap[k] + '分');
    // 逐日明细：问「今天/昨天/某天」时必须有当天动作，否则模型只能拿 30 天汇总答
    const todayKey = engine.dayKey(new Date());
    const t0 = days.find(d => d.date === todayKey) || engine.dayStat(train, todayKey) || {};
    const dayLine = d => {
      if (!d || !d.items || !d.items.length) return '无记录';
      const ex = d.items.filter(it => it.type !== 'cardio' && it.done)
        .sort((a, b) => (b.done || 0) - (a.done || 0))
        .slice(0, 8)
        .map(it => it.name + ' ' + it.done + '组' + (it.weight ? '/' + it.weight + 'kg' : ''));
      const cd = d.items.filter(it => it.type === 'cardio').map(it => it.name + ' ' + (it.min || 0) + '分');
      return ex.concat(cd).join('，');
    };
    // 饮食：今天各餐热量 + 近 7 天训练日/休息日对比
    const mToday = food.mealLogs(store.getLogs(), todayKey)
      .map(l => ((l.meta || {}).meal || '一餐') + ' ' + ((l.meta || {}).totalKcal || 0) + 'kcal')
      .join('，');
    const mTrend = food.trend(store.getLogs(), 7, train);
    return [
      '【个人】身高' + (profile.height || '-') + 'cm 体重' + (profile.weight || '-') + 'kg 目标' + (profile.goal || '-'),
      '【今天 ' + todayKey.slice(5) + '】' + dayLine(t0) + ' · 共 ' + (t0.done || 0) + ' 组 / ' + (t0.volume || 0) + 'kg',
      '【每日明细·近 7 天】' + days.slice(0, 7).map(d => d.date.slice(5) + ' ' + dayLine(d)).join('；'),
      '【近' + this.data.range + '天汇总·只作趋势】训练 ' + this.data.days + ' 天，总容量 ' + this.data.volume + 'kg',
      '【近' + this.data.range + '天部位分布（组数/容量）】' + setParts.map(p => p.part + ' ' + p.sets + '组/' + p.volume + 'kg').join('，'),
      '【近' + this.data.range + '天动作明细（按组数）】' + (exList.length ? exList.slice(0, 14).map(x => x.k + ' ' + x.v + '组').join('，') : '无'),
      cdList.length ? '【近' + this.data.range + '天有氧】' + cdList.slice(0, 5).join('，') : '',
      '【高频动作】' + tops.map(t => t.name + ' ' + t.sets + '组/' + t.volume + 'kg').join('，'),
      '【今天饮食】' + (mToday || '还没记') + (food.kcalOfDay(store.getLogs(), todayKey) ? '，共 ' + food.kcalOfDay(store.getLogs(), todayKey) + 'kcal' : ''),
      mTrend.dayCount ? '【近 7 天饮食·估算】记录' + mTrend.dayCount + '天，日均' + mTrend.avg + 'kcal' + (mTrend.trainAvg ? '，训练日' + mTrend.trainAvg + 'kcal' : '') + (mTrend.restAvg ? '，休息日' + mTrend.restAvg + 'kcal' : '') : ''
    ].filter(Boolean).join('\n');
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
        { role: 'system', content: '你是健身教练兼数据分析助手。依据用户记录回答，中文，简洁，给可执行建议，不超过 200 字。追问时承接上文，不要重复已经说过的结论。注意：自重动作（如卷腹、平板支撑、引体）容量记 0，判断某个部位练没练要看组数和【动作明细】，容量 0 不等于没练。时间范围必须按用户问的来：问「今天」只用【今天】那一行，问「昨天/某天」只用【每日明细】里对应那天，问「最近一周」才用近 7 天，【近 30 天汇总】只用于趋势；回答开头写清用的是哪天的数据，不要拿汇总当某一天。饮食热量是按餐具份量估的（误差 ±20-40%），提到饮食只讲趋势和大致量，不要精确到个位、不要照抄单餐明细当结论。' },
        ...history,
        { role: 'user', content: this.contextText() + '\n\n问题：' + q }
      ],
      max_tokens: 400,
      temperature: 0.4
    }).then(res => {
      const raw = res.ok ? cleanMd(res.text || '') : '';
      // 质量门：不合格就用本地规则结论，别把半句乱码丢给用户
      const t = res.ok
        ? sanity.check(raw, local || '这次 AI 没把话说清，先看上面的数据。', { max: 400, minCjk: 0.3 })
        : ('调用失败：' + (res.error || '未知'));
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

  goReviewHub() {
    wx.navigateTo({ url: '/pages/reviewhub/index' });
  },

  goTrain() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  orbFocus() {
    wx.navigateTo({ url: '/pages/focus/index' });
  },

  orbSummary() {
    wx.switchTab({ url: '/pages/train/index' });
  },

  orbNoted() {
    this.refresh();
  }
});
