const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');
const stats = require('../../libs/stats');
const journal = require('../../libs/journal');
const polish = require('../../libs/aipolish');

function pct(cur, prev) {
  if (!prev) return cur > 0 ? '+∞' : '—';
  const d = (cur - prev) / prev * 100;
  return (d >= 0 ? '+' : '') + Math.round(d) + '%';
}

Page({
  data: {
    offset: 0,
    title: '本周',
    rangeText: '',
    cur: null,
    prev: null,
    days: [],
    parts: [],
    tops: [],
    prs: [],
    conclusions: [],
    moodText: '',
    sleepText: '',
    delta: {},
    aiWeekly: [],
    aiLoading: false
  },

  onLoad() { this.load(0); },

  load(offset) {
    const train = engine.ensureTrain(store.getTrain());
    const cur = stats.weekStat(train, offset);
    const prev = stats.weekStat(train, offset + 1);
    const maxVol = Math.max(1, ...cur.days.map(d => d.volume));
    const parts = engine.partStats(train, 7);
    const maxPart = Math.max(1, ...parts.map(p => p.volume));
    const cks = journal.recentCheckins(7);
    const moodAvg = cks.length ? Math.round(cks.reduce((a, c) => a + (c.mood || 0), 0) / cks.length * 10) / 10 : 0;
    const sleepAvg = cks.filter(c => c.sleepH).length
      ? Math.round(cks.filter(c => c.sleepH).reduce((a, c) => a + c.sleepH, 0) / cks.filter(c => c.sleepH).length * 10) / 10 : 0;

    const concl = [];
    if (!cur.trained) concl.push('这一周还没有训练记录，从今天挑一个动作开始。');
    else {
      concl.push('这周练了 ' + cur.trained + ' 天、' + cur.sets + ' 组，总容量 ' + cur.volume.toLocaleString() + ' kg。');
      if (prev.trained) {
        const d = cur.trained - prev.trained;
        concl.push(d > 0 ? '比上周多练 ' + d + ' 天。' : (d < 0 ? '比上周少练 ' + (-d) + ' 天，注意别中断节奏。' : '训练天数和上周持平。'));
        if (prev.volume) {
          concl.push('容量比上周 ' + pct(cur.volume, prev.volume) + '。');
        }
      }
      if (!cur.cardioMin) concl.push('本周没有有氧，建议补 1–2 次 20′ 以上，恢复会更快。');
      else concl.push('有氧共 ' + cur.cardioMin + '′。');
      if (parts.length) concl.push('练得最多的是「' + parts[0].part + '」，容量 ' + parts[0].volume.toLocaleString() + ' kg。');
      if (cur.trained < 2) concl.push('一周不足 2 天，先把频次拉到 3 天再谈强度。');
    }

    this.setData({
      offset,
      title: offset === 0 ? '本周' : offset + ' 周前',
      rangeText: cur.range.start + ' ~ ' + cur.range.end,
      cur,
      prev,
      days: cur.days.map(d => Object.assign({}, d, { h: Math.round(d.volume / maxVol * 100) })),
      parts: parts.map(p => Object.assign({}, p, { h: Math.round(p.volume / maxPart * 100) })),
      tops: cur.top,
      prs: cur.prs,
      conclusions: concl,
      moodText: moodAvg ? moodAvg + '/5' : '—',
      sleepText: sleepAvg ? sleepAvg + ' h' : '—',
      delta: {
        trained: pct(cur.trained, prev.trained),
        volume: pct(cur.volume, prev.volume),
        sets: pct(cur.sets, prev.sets),
        cardio: pct(cur.cardioMin, prev.cardioMin)
      }
    });
    this.aiWeekly(cur, prev, parts, offset);
  },

  // AI 周报：训练量 / 均衡 / 进步 三段，规则数字喂给 AI 只做表达
  aiWeekly(cur, prev, parts, offset) {
    const facts = {
      week: cur.range.start + '~' + cur.range.end,
      trained: cur.trained, sets: cur.sets, volume: cur.volume, cardioMin: cur.cardioMin,
      prevTrained: prev.trained, prevVolume: prev.volume,
      parts: parts.slice(0, 4).map(p => p.part + p.volume + 'kg').join(','),
      prs: (cur.prs || []).map(p => p.name + (p.bestW || 0) + 'kg').join(','),
      top: (cur.top || []).slice(0, 2).map(t => t.name + t.sets + '组').join(',')
    };
    this.setData({ aiWeekly: [], aiLoading: true });
    polish.polish('weekly:' + offset, facts,
      '输出三行：第一行以【训练量】开头，第二行【均衡】，第三行【进步】；每行一句话，不重复数字罗列，第 3 行给一句下周具体动作',
      { max: 90, tokens: 260 })
      .then(r => {
        if (!r.ok) { this.setData({ aiLoading: false }); return; }
        const found = [];
        const re = /【(训练量|均衡|进步)】(.*?)(?=【|$)/g;
        let m;
        while ((m = re.exec(r.text))) found.push({ k: m[1], v: m[2].trim() });
        this.setData({ aiWeekly: found, aiLoading: false });
      })
      .catch(() => this.setData({ aiLoading: false }));
  },

  prevWeek() { this.load(this.data.offset + 1); },
  nextWeek() {
    if (this.data.offset <= 0) return;
    this.load(this.data.offset - 1);
  }
});
