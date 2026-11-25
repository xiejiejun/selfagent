// 本地规则问答（对应网页版 answerAsk）：不联网，只按训练与日志统计回答。
const engine = require('./engine/index');
const settings = require('./settings');

function dk(d) { return engine.dayKey(d); }
function dayShort(d) { const p = String(d || '').split('-'); return (+p[1]) + '/' + (+p[2]); }
function num(n) { return Math.round(n).toLocaleString(); }

function windowOf(q) {
  const now = new Date();
  const back = n => {
    const s = new Date(now);
    s.setDate(s.getDate() - n);
    return [dk(s), dk(now), '近' + (n + 1) + '天'];
  };
  if (/今天|今日/.test(q)) return [dk(now), dk(now), '今天'];
  if (/昨天/.test(q)) { const y = new Date(now); y.setDate(y.getDate() - 1); return [dk(y), dk(y), '昨天']; }
  if (/本周|这周|这星期|这一周/.test(q)) { const s = new Date(now); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return [dk(s), dk(now), '本周']; }
  if (/上周/.test(q)) {
    const e = new Date(now); e.setDate(e.getDate() - ((e.getDay() + 6) % 7) - 1);
    const s = new Date(e); s.setDate(s.getDate() - 6);
    return [dk(s), dk(e), '上周'];
  }
  if (/本月|这个月/.test(q)) return [dk(new Date(now.getFullYear(), now.getMonth(), 1)), dk(now), '本月'];
  if (/上月|上个月/.test(q)) return [dk(new Date(now.getFullYear(), now.getMonth() - 1, 1)), dk(new Date(now.getFullYear(), now.getMonth(), 0)), '上月'];
  if (/近30|一个月|30天/.test(q)) return back(29);
  if (/近14|两周/.test(q)) return back(13);
  if (/全部|所有|一直|总共|累计/.test(q)) return ['0000-00-00', dk(now), '全部'];
  return back(6);
}

const PART_RE = /背|胸|腿|臀|肩|臂|腹|腰腹|小腿|前臂|颈|有氧/;

function scopeOf(train, logs, a, b) {
  const win = d => (d || '') >= a && (d || '') <= b;
  return {
    win,
    lg: (logs || []).filter(l => l && l.kind !== 'train' && win(l.date)),
    tr: (logs || []).filter(l => l && l.kind === 'train' && win(l.date)),
    recs: ((train && train.records) || []).filter(r => r && win(r.date))
  };
}

function evOf(l) {
  return { id: l.id, label: dayShort(l.date) + ' ' + (l.kind === 'train' ? '训练 · ' : '') + String(l.content || '').slice(0, 14) };
}

function answer(q, train, logs) {
  q = String(q || '').trim();
  if (!q) return null;
  const [a, b, rangeLabel] = windowOf(q);
  const sc = scopeOf(train, logs, a, b);
  const esc = s => String(s == null ? '' : s);

  // 1) 加班 × 次日精力
  if (/(加班|工作|压力).*(睡|精力|状态|情绪)|(睡|精力|状态|情绪).*(加班|工作)/.test(q)) {
    const over = (logs || []).filter(l => l && l.kind !== 'train' && /加班|熬夜|熬到/.test((l.content || '') + ' ' + (l.tags || '')));
    const next = {};
    over.forEach(l => { const d = new Date((l.date || '') + 'T00:00:00'); d.setDate(d.getDate() + 1); next[dk(d)] = true; });
    const after = (logs || []).filter(l => l && l.kind !== 'train' && next[l.date || '']);
    const calm = (logs || []).filter(l => l && l.kind !== 'train' && !next[l.date || '']);
    const avg = arr => {
      const v = arr.filter(l => typeof l.score === 'number' && l.score > 0).map(l => l.score);
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    };
    const A = avg(after), C = avg(calm);
    if (A == null || C == null || over.length < 2) {
      return { title: '还不知道', main: '加班记录或次日精力样本不足（至少 2 次加班 + 有次日记录）。', sub: '多记几天再问，我不猜。', refs: over.map(evOf) };
    }
    const diff = A - C;
    const verdict = Math.abs(diff) < 0.3 ? '几乎没差别' : (diff < 0 ? '明显更低' : '反而更高');
    return {
      title: '加班 × 次日精力', range: rangeLabel,
      main: '加班后的第二天精力平均 ' + A.toFixed(1) + '，其它日子 ' + C.toFixed(1) + '，' + verdict + '（差 ' + Math.abs(diff).toFixed(1) + '）。',
      sub: '加班 ' + over.length + ' 次 · 有次日记录的 ' + after.length + ' 天。基于你范围内的 ' + sc.lg.length + ' 条日志，样本不大时只作参考。',
      refs: over.map(evOf).concat(after.map(evOf)).slice(0, 8)
    };
  }

  // 2) 最久没练
  if (/最久|多久没|没练/.test(q)) {
    const parts = ['胸', '背', '腿', '肩', '臂', '腰腹', '有氧'];
    const last = {};
    ((train && train.records) || []).forEach(r => {
      const m = String(engine.partForName(train, r.name, r.part) || '').match(PART_RE);
      if (m) { const k = m[0]; if (!last[k] || r.date > last[k]) last[k] = r.date; }
    });
    const rows = parts.map(p => ({ p, d: last[p] || '' })).filter(r => r.d).sort((x, y) => (x.d < y.d ? -1 : 1));
    if (!rows.length) return { title: '最久未练部位', range: '全部记录', main: '还没有带部位的训练记录，先练一次我就能算了。', sub: '', refs: [] };
    const top = rows[0];
    const days = Math.round((Date.now() - new Date(top.d + 'T00:00:00').getTime()) / 864e5);
    return {
      title: '最久未练部位', range: '全部记录',
      main: top.p + ' 已经 ' + days + ' 天没练（上次 ' + top.d + '）。',
      sub: rows.map(r => r.p + ' · ' + dayShort(r.d) + '（' + Math.round((Date.now() - new Date(r.d + 'T00:00:00').getTime()) / 864e5) + ' 天前）').join(' ／ '),
      refs: []
    };
  }

  // 3) 训练次数/组数/容量
  if (/练了几次|训练几次|练了[几多]|几次训练|训练了|练了多少|几次/.test(q) || /(组|容量|总重|强度)/.test(q)) {
    const part = (q.match(PART_RE) || [])[0] || '';
    const recs = part ? sc.recs.filter(r => (engine.partForName(train, r.name, r.part) || '').indexOf(part) >= 0) : sc.recs;
    if (!recs.length) return { title: '范围内没有训练', range: rangeLabel, main: rangeLabel + '没有' + (part ? '练' + part + '的' : '') + '训练记录。', sub: '去训练页排个计划，练完自动记账。', refs: [] };
    const days = {};
    recs.forEach(r => { days[r.date] = true; });
    let sets = 0, vol = 0, done = 0;
    recs.forEach(r => {
      const gs = (r.groups && r.groups.length) ? r.groups : engine.ensureGroups(r);
      sets += gs.length || r.sets || 0;
      gs.forEach(g => { if (g.done) { done++; if (!g.warmup) vol += (g.reps || 0) * (g.weight || 0); } });
    });
    const partCnt = {};
    recs.forEach(r => { const k = engine.partForName(train, r.name, r.part) || '其他'; partCnt[k] = (partCnt[k] || 0) + 1; });
    const topPart = Object.keys(partCnt).sort((x, y) => partCnt[y] - partCnt[x])[0];
    const dayN = Object.keys(days).length;
    if (/(容量|总重|强度|公斤|kg)/.test(q)) {
      return {
        title: '训练容量', range: rangeLabel,
        main: rangeLabel + '完成 ' + done + ' 组，总容量 ' + num(vol) + ' kg' + (part ? '（只看' + part + '）' : '') + '。',
        sub: dayN + ' 个训练日 · ' + recs.length + ' 个动作 · 平均每次 ' + num(vol / Math.max(1, dayN)) + ' kg',
        refs: sc.tr.map(evOf)
      };
    }
    if (/组/.test(q)) {
      return {
        title: '训练组数', range: rangeLabel,
        main: rangeLabel + '计划 ' + sets + ' 组，完成 ' + done + ' 组' + (part ? '（' + part + '）' : '') + '。',
        sub: '完成率 ' + (sets ? Math.round(done / sets * 100) : 0) + '% · ' + dayN + ' 个训练日',
        refs: sc.tr.map(evOf)
      };
    }
    return {
      title: '训练次数', range: rangeLabel,
      main: rangeLabel + '练了 ' + dayN + ' 天，共 ' + recs.length + ' 个动作' + (part ? '（' + part + '）' : '') + '。',
      sub: '最常练：' + topPart + '（' + partCnt[topPart] + ' 次） · 完成 ' + done + ' 组 · 容量 ' + num(vol) + ' kg',
      refs: sc.tr.map(evOf)
    };
  }

  // 4) 精力/情绪极值
  if (/状态|精力|情绪|心情|感觉/.test(q)) {
    const good = /最好|最高|最棒|最佳|巅峰|精力好|状态好/.test(q);
    const pool = sc.lg.filter(l => typeof l.score === 'number' && l.score > 0);
    const moodPool = sc.lg.filter(l => typeof l.mood === 'number' && l.mood > 0);
    if (!pool.length && !moodPool.length) {
      return { title: '没有可比的记录', range: rangeLabel, main: rangeLabel + '还没有带精力/情绪的记录。', sub: '写日志时选一下精力与情绪，我就能做极值对比。', refs: [] };
    }
    const useMood = /情绪|心情/.test(q);
    const valOf = l => (useMood ? settings.moodNorm(l.mood) : l.score);
    const arr = (useMood ? moodPool : pool).slice().sort((x, y) => valOf(x) - valOf(y));
    const pick = good ? arr[arr.length - 1] : arr[0];
    const avgv = arr.reduce((s, l) => s + valOf(l), 0) / arr.length;
    return {
      title: rangeLabel + (good ? '状态最好' : '状态最差') + '的一天', range: rangeLabel,
      main: pick.date + '（' + (pick.date === dk(new Date()) ? '今天' : dayShort(pick.date)) + '）' + (useMood ? '情绪' : '精力') + ' ' + (useMood ? settings.moodNorm(pick.mood) : pick.score) + '/5，' + (good ? '高于' : '低于') + '平均 ' + avgv.toFixed(1) + '。',
      sub: esc(String(pick.content || '').slice(0, 60)) || '（这条没有正文）',
      refs: [evOf(pick)]
    };
  }

  // 5) 睡眠
  if (/睡|作息|熬夜/.test(q)) {
    const hits = sc.lg.filter(l => /睡|熬夜|作息/.test((l.content || '') + ' ' + (l.tags || '')));
    if (!hits.length) return { title: '睡眠记录还没有', range: rangeLabel, main: rangeLabel + '没有提到睡眠的记录。', sub: '写一条“昨晚一点才睡”，我就能开始看你的作息。', refs: [] };
    const v = hits.filter(l => l.score > 0).map(l => l.score);
    const mean = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    return {
      title: '作息记录', range: rangeLabel,
      main: rangeLabel + '提到睡眠 ' + hits.length + ' 次' + (mean ? '，这些日子平均精力 ' + mean.toFixed(1) : '') + '。',
      sub: '想更准，可以连着记几天同一时间的入睡状态。',
      refs: hits.map(evOf)
    };
  }

  // 6) 高频词
  if (/最常|高频|关键词|频繁|最多/.test(q)) {
    const cnt = {};
    sc.lg.forEach(l => {
      String(l.tags || '').split(/[,、，]/).filter(Boolean).forEach(t => { cnt[t] = (cnt[t] || 0) + 1; });
      String(l.content || '').replace(/[，,。、\s]+/g, ' ').split(' ').filter(w => w.length >= 2).slice(0, 8).forEach(w => { cnt[w] = (cnt[w] || 0) + 1; });
    });
    const top = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]).slice(0, 6);
    if (!top.length) return { title: '关键词还不够', range: rangeLabel, main: '范围内记录太少，看不出高频词。', sub: '多记几条再问。', refs: [] };
    return { title: '高频词', range: rangeLabel, main: top.map(k => k + '（' + cnt[k] + '）').join(' · '), sub: '基于 ' + sc.lg.length + ' 条日志', refs: [] };
  }

  // 7) 记录条数
  if (/几条|多少条|记录数|记了多少/.test(q)) {
    return { title: '记录量', range: rangeLabel, main: rangeLabel + '写了 ' + sc.lg.length + ' 条日志、' + sc.tr.length + ' 张训练卡。', sub: '日志与训练分开统计，都按记录日归档。', refs: [] };
  }

  const dayCnt = {};
  sc.lg.forEach(l => { dayCnt[l.date] = true; });
  const mv = sc.lg.filter(l => l.mood > 0).map(l => settings.moodNorm(l.mood));
  const moodAvg = mv.length ? (mv.reduce((x, y) => x + y, 0) / mv.length).toFixed(1) : '—';
  return {
    title: rangeLabel + ' 概况', range: rangeLabel,
    main: sc.lg.length + ' 条日志 · ' + Object.keys(dayCnt).length + ' 个记录日 · 平均情绪 ' + moodAvg + ' · ' + sc.recs.length + ' 个训练动作。',
    sub: '可以继续问：训练次数 / 组数 / 容量 / 状态最差的一天 / 加班和睡眠 / 最久没练的部位。',
    refs: sc.lg.slice(0, 4).map(evOf)
  };
}

const PRESETS = [
  '本周练了几次',
  '本周容量多少',
  '状态最差的一天',
  '最久没练的部位'
];

module.exports = { answer, windowOf, PRESETS };
