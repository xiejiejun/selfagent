const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const settings = require('../../libs/settings');
const stats = require('../../libs/stats');
const data = require('../../libs/data/index');
const ui = require('../../libs/ui');
const food = require('../../libs/food');
const ai = require('../../libs/ai');
const sanity = require('../../libs/sanity');

let openMap = {};

const INFER_KW = {
  work: ['加班', '代码', '开会', '会议', '需求', '汇报', '项目', '文档', '上线', 'bug', '方案', '评审', '客户', '甲方', 'debug'],
  fit: ['跑步', '跑了', '公里', '深蹲', '卧推', '硬拉', '引体', '练了', '练完', '游泳', '瑜伽', '骑行', '打球', '撸铁', '举铁', '有氧', '锻炼', '健身', 'km'],
  life: ['睡了', '没睡好', '熬夜', '熬到', '失眠', '起床', '起不来', '早餐', '午餐', '午饭', '晚饭', '刷手机', '焦虑', '累', '烦躁', '情绪', '作息', '喝水', '散步']
};
const TAG_HINT = [
  { tag: '跑步', re: /跑|公里|km/i }, { tag: '力量', re: /深蹲|卧推|硬拉|引体|撸铁|举铁/ },
  { tag: '瑜伽', re: /瑜伽/ }, { tag: '游泳', re: /游泳/ },
  { tag: '加班', re: /加班/ }, { tag: '代码', re: /代码|bug|debug|写代码/ },
  { tag: '会议', re: /开会|会议/ }, { tag: '需求', re: /需求|方案|评审/ },
  { tag: '作息', re: /睡|起床|起不来|熬夜|熬到|失眠/ }, { tag: '饮食', re: /早餐|午饭|晚饭|吃/ },
  { tag: '情绪', re: /焦虑|烦躁|压力|情绪/ }
];

function inferOf(text) {
  const t = (' ' + (text || '') + ' ').toLowerCase();
  if (!t.trim()) return null;
  let best = { key: (settings.types()[0] || {}).key, sc: 0, tags: [] };
  settings.types().forEach(ty => {
    let sc = 0;
    const hit = [];
    (ty.tags || []).forEach(tag => { if (tag && t.indexOf(String(tag).toLowerCase()) >= 0) { sc += 2; hit.push(tag); } });
    if (t.indexOf(String(ty.label || '').toLowerCase()) >= 0) sc += 3;
    (INFER_KW[ty.key] || []).forEach(w => { if (t.indexOf(w) >= 0) sc += 3; });
    if (sc > best.sc) best = { key: ty.key, sc, tags: hit.slice(0, 2) };
  });
  const hint = TAG_HINT.filter(h => h.re.test(text) && (settings.tagsOf(best.key) || []).indexOf(h.tag) >= 0).map(h => h.tag);
  if (hint.length) best.tags = hint.slice(0, 2);
  if (!best.sc) return null;
  return best;
}

function buildTimeline() {
  const logs = (store.getLogs() || []).slice();
  logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')));
  const names = actions.exNameMap();

  const groups = [];
  logs.forEach(l => {
    const dk = l.date || engine.dayKey(l.time);
    let g = groups[groups.length - 1];
    if (!g || g.date !== dk) { g = { date: dk, label: engine.dateLabel(dk), logs: [] }; groups.push(g); }

    if (l.kind === 'train') {
      const items = (l.meta && l.meta.items) || [];
      const rows = items.map(it => {
        if (it.type === 'cardio') {
          const gs = it.groups || [];
          const isSets = it.mode === 'sets';
          return {
            uid: it.uid || '', isCardio: true, cdMode: it.mode || 'timer', name: it.name,
            line: (isSets ? ((gs.length ? engine.groupLine(gs, it.uni) : (it.sets || 0) + ' 组')) : ((it.min || 0) + ' 分钟')) + (it.dist ? ' · ' + it.dist + 'km' : ''),
            done: !!it.done,
            doneN: isSets ? (it.doneN || 0) : (it.done ? 1 : 0),
            totalN: isSets ? (it.totalN || gs.length) : 1,
            open: !!openMap[l.id + ':' + (it.uid || it.name)],
            key: l.id + ':' + (it.uid || it.name),
            groups: gs.map(g => ({ no: g.warmup ? 'W' : g.no, txt: engine.wText(g.weight, it.uni) + ' × ' + g.reps, sec: engine.fmtSec(g.sec), done: !!g.done }))
          };
        }
        const gs = it.groups || [];
        const uni = engine.isUniName(it.name);
        return {
          uid: it.uid || '', isCardio: false, name: names[it.exId] || it.name,
          line: engine.groupLine(gs, uni),
          doneN: gs.filter(x => x.done).length,
          totalN: gs.length || it.sets || 0,
          open: !!openMap[l.id + ':' + (it.uid || it.name)],
          key: l.id + ':' + (it.uid || it.name),
          groups: gs.map(g => ({ no: g.warmup ? 'W' : g.no, txt: engine.wText(g.weight, uni) + ' × ' + g.reps, sec: engine.fmtSec(g.sec), done: !!g.done }))
        };
      });
      g.logs.push({ id: l.id, kind: 'train', isTrain: true, timeText: engine.fmtTime(l.time), summary: engine.summaryText(items), rows });
      return;
    }

    if (l.kind === 'meal') {
      const m = l.meta || {};
      const items = (m.items || []).map(x => ({
        name: String(x.name || ''),
        portion: String(x.portion || ''),
        kcal: Number(x.kcal) || 0,
        low: x.confidence != null && Number(x.confidence) < 0.6
      }));
      g.logs.push({
        id: l.id, kind: 'meal', isMeal: true, isTrain: false, timeText: engine.fmtTime(l.time),
        meal: String(m.meal || ''),
        kcal: Number(m.totalKcal) || 0,
        items,
        text: items.length ? items.map(x => x.name + (x.portion ? ' ' + x.portion : '')).join(' · ') : (l.content || ''),
        pic: String(m.image || ''),
        tags: l.tags || '饮食',
        type: l.type || 'life',
        typeLabel: '饮食',
        typeColor: '#C08A12',
        score: 0, mood: 0, moodText: ''
      });
      return;
    }

    g.logs.push({
      id: l.id, kind: l.kind || 'note', isTrain: false, timeText: engine.fmtTime(l.time),
      text: l.content || '', tags: l.tags || '',
      type: l.type || '',
      typeLabel: settings.typeLabel(l.type),
      typeColor: settings.colorFor(l.type),
      score: typeof l.score === 'number' ? l.score : 0,
      mood: typeof l.mood === 'number' ? l.mood : 0,
      moodText: settings.moodText(l.mood)
    });
  });
  return groups;
}

Page({
  data: {
    tab: 'log',
    groups: [],
    quickText: '',
    quickEnergy: 0,
    quickMood: 0,
    editorVisible: false,
    payload: null,
    todayCount: 0,
    types: [],
    typeKey: '',
    typeTags: [],
    pickedTags: [],
    yesterday: false,
    infer: null,
    parseHint: null,
    stats: null,
    mealTrend: null,
    mealAi: '',
    todayKcal: 0,
    range: 30,
    cStart: '',
    cEnd: '',
    energyLabels: ['没劲', '偏低', '一般', '不错', '充沛'],
    moodLabels: ['很糟', '低落', '一般', '不错', '很好']
  },

  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },

  buildStats() {
    return stats.rangeStats(store.getTrain(), store.getLogs(), this.data.range, { start: this.data.cStart, end: this.data.cEnd });
  },

  refresh() {
    const groups = buildTimeline();
    const today = engine.dayKey();
    const t = groups.find(g => g.date === today);
    const types = settings.types().map(x => ({ key: x.key, label: x.label, color: settings.colorFor(x.key) }));
    const typeKey = this.data.typeKey || (types[0] || {}).key || 'life';
    const logs = store.getLogs();
    this.setData({
      groups, todayCount: t ? t.logs.length : 0,
      types, typeKey,
      typeTags: settings.tagsOf(typeKey),
      todayKcal: food.kcalOfDay(logs, today),
      stats: this.data.tab === 'stats' ? this.buildStats() : null
    });
    if (this.data.tab === 'stats') this.buildMealTrend();
  },

  goCam() { wx.navigateTo({ url: '/pages/cam/index' }); },

  // 周热量趋势：规则句先上屏，AI 一句话过质量门再补
  buildMealTrend() {
    const tr = food.trend(store.getLogs(), 7, store.getTrain());
    this.setData({ mealTrend: tr });
    if (!tr.dayCount) return;
    const key = 'selfagent_meal_ai_v1';
    const sig = tr.dayCount + ':' + tr.avg + ':' + tr.trainAvg + ':' + tr.restAvg + ':' + engine.dayKey();
    let seen = '';
    try { seen = wx.getStorageSync(key) || ''; } catch (e) {}
    if (seen === sig) return;
    if (this.mealAiAsked) return;
    this.mealAiAsked = true;
    const fb = tr.text + '，趋势够用就行。';
    this.setData({ mealAi: fb });
    setTimeout(() => {
      ai.ask({
        messages: [
          { role: 'system', content: '你是训练与饮食教练。只输出一句 40 字内中文，说饮食和训练的配合，带数字，不加引号，不评判。' },
          { role: 'user', content: '近7天饮食：记录' + tr.dayCount + '天，日均' + tr.avg + 'kcal；训练日' + (tr.trainAvg || '—') + 'kcal，休息日' + (tr.restAvg || '—') + 'kcal。' }
        ],
        max_tokens: 80,
        temperature: 0.4
      }).then(r => {
        if (!r.ok) return;
        const raw = String(r.text || '').replace(/["“”']/g, '').replace(/\s+/g, ' ').trim();
        const t = sanity.check(raw, fb, { max: 60, minCjk: 0.3 });
        this.setData({ mealAi: t });
        try { wx.setStorageSync(key, sig); } catch (e) {}
      });
    }, 800);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'stats') { this.setData({ stats: this.buildStats() }); this.buildMealTrend(); }
  },

  setRange(e) {
    const r = e.currentTarget.dataset.r;
    if (r === 'custom') {
      const today = engine.dayKey();
      const cs = this.data.cStart || stats.shiftDay(today, -29);
      const ce = this.data.cEnd || today;
      this.setData({
        range: 'custom', cStart: cs, cEnd: ce,
        stats: stats.rangeStats(store.getTrain(), store.getLogs(), 'custom', { start: cs, end: ce })
      });
      return;
    }
    const range = Number(r);
    this.setData({ range, stats: stats.rangeStats(store.getTrain(), store.getLogs(), range) });
  },

  onCStart(e) {
    const v = e.detail.value;
    this.setData({ cStart: v, stats: stats.rangeStats(store.getTrain(), store.getLogs(), 'custom', { start: v, end: this.data.cEnd || engine.dayKey() }) });
  },

  onCEnd(e) {
    const v = e.detail.value;
    this.setData({ cEnd: v, stats: stats.rangeStats(store.getTrain(), store.getLogs(), 'custom', { start: this.data.cStart || stats.shiftDay(engine.dayKey(), -29), end: v }) });
  },

  onQuickInput(e) {
    const v = e.detail.value;
    const infer = inferOf(v);
    const parseHint = this.parseTrain(v);
    this.setData({ quickText: v, infer, parseHint });
  },

  // "12×4 22.5kg 深蹲" → 提示可转成训练
  parseTrain(txt) {
    const s = String(txt || '').trim();
    // 支持 "4×12 20kg 卧推" 与 "卧推 20公斤 3组5次"
    const m = s.match(/(\d+)\s*[x×*]\s*(\d+)/i) || s.match(/(\d+)\s*组\s*[×x]?\s*(\d+)\s*次/);
    if (!m) return null;
    const sets = Math.max(1, Math.min(20, +m[1]));
    const reps = Math.max(1, Math.min(100, +m[2]));
    let rest = s.replace(m[0], ' ');
    let weight = 0;
    // 重量可能写在动作名前面："20kg 卧推" / "卧推 20 公斤"
    const wm = rest.match(/(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/i);
    if (wm) { weight = parseFloat(wm[1]) || 0; rest = rest.replace(wm[0], ' '); }
    const name = rest.replace(/[，,。;；:：]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    const list = data.search(name, '全部', '全部', 20);
    const exact = data.matchByName(name);
    const cand = exact && exact.n === name ? exact
      : (list.length ? list.slice().sort((a, b) => a.n.length - b.n.length)[0] : exact);
    return { name: cand ? cand.n : name, part: cand ? cand.p : '其他', exId: cand ? cand.id : '', sets, reps, weight };
  },

  // 把这句话转成今日训练卡
  convertTrain() {
    const p = this.data.parseHint;
    if (!p) return;
    const today = this.data.yesterday ? stats.shiftDay(engine.dayKey(), -1) : engine.dayKey();
    this.setData({
      editorVisible: true,
      payload: {
        mode: 'strength', isNew: true, name: p.name, part: p.part, exId: p.exId, date: today,
        groups: Array.from({ length: p.sets }, () => ({ no: 1, reps: p.reps, weight: p.weight, done: false }))
      }
    });
  },

  pickType(e) {
    const key = e.currentTarget.dataset.k;
    this.setData({ typeKey: key, typeTags: settings.tagsOf(key), pickedTags: [] });
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const arr = this.data.pickedTags.slice();
    const i = arr.indexOf(tag);
    if (i >= 0) arr.splice(i, 1); else arr.push(tag);
    this.setData({ pickedTags: arr });
  },

  applyInfer() {
    const inf = this.data.infer;
    if (!inf) return;
    this.setData({ typeKey: inf.key, typeTags: settings.tagsOf(inf.key), pickedTags: (inf.tags || []).slice() });
  },

  toggleYesterday() { this.setData({ yesterday: !this.data.yesterday }); },

  loadDemo() {
    this.setData({
      quickText: '加班到十点，有点焦虑，晚饭吃得很赶',
      quickEnergy: 2,
      quickMood: 2
    }, () => {
      const inf = inferOf(this.data.quickText);
      this.setData({ infer: inf });
      if (inf) this.setData({ typeKey: inf.key, typeTags: settings.tagsOf(inf.key), pickedTags: (inf.tags || []).slice() });
    });
  },

  goSetting() { wx.switchTab({ url: '/pages/setting/index' }); },

  pickScore(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: Number(e.currentTarget.dataset.v) });
  },

  onScoreSlide(e) {
    const k = e.currentTarget.dataset.k;
    ui.light();
    this.setData({ [k]: Number(e.detail.value) });
  },

  openLogMenu(e) {
    const id = e.currentTarget.dataset.id;
    ui.light();
    wx.showActionSheet({
      itemList: ['删除这条记录'],
      itemColor: '#E06E78',
      success: (r) => {
        if (r.tapIndex === 0) this.delLog({ currentTarget: { dataset: { id } } });
      }
    });
  },

  saveQuick() {
    const txt = (this.data.quickText || '').trim();
    if (!txt) return;
    const date = this.data.yesterday ? stats.shiftDay(engine.dayKey(), -1) : engine.dayKey();
    actions.addNote(txt, {
      score: this.data.quickEnergy || null,
      mood: this.data.quickMood || null,
      type: this.data.typeKey || 'life',
      tags: this.data.pickedTags.join(','),
      date
    });
    this.setData({ quickText: '', quickEnergy: 0, quickMood: 0, pickedTags: [], infer: null, parseHint: null, yesterday: false });
    ui.ok();
    this.refresh();
    wx.showToast({ title: '已记录', icon: 'none' });
    if ((store.getLogs() || []).filter(l => l.kind !== 'train').length === 3) {
      wx.showToast({ title: '已积累 3 条，去分析看看', icon: 'none' });
    }
  },

  toggleRow(e) {
    const key = e.currentTarget.dataset.key;
    openMap[key] = !openMap[key];
    this.refresh();
  },

  editRow(e) {
    const uid = e.currentTarget.dataset.uid;
    const cardio = e.currentTarget.dataset.cardio;
    const date = e.currentTarget.dataset.date;
    const train = engine.ensureTrain(store.getTrain());
    if (cardio) {
      const c = (train.cardio || []).find(x => x && x.uid === uid);
      if (!c) return;
      this.setData({ editorVisible: true, payload: { mode: 'cardio', uid: c.uid, name: c.modal || c.name, min: c.min || 30, done: !!c.done, date } });
      return;
    }
    const r = (train.records || []).find(x => x && x.uid === uid);
    if (!r) return;
    this.setData({ editorVisible: true, payload: { mode: 'strength', uid: r.uid, name: r.name, part: r.part, exId: r.exId, date, groups: engine.ensureGroups(r) } });
  },

  addToDay(e) {
    const date = e.currentTarget.dataset.date;
    wx.navigateTo({
      url: '/pages/library/index',
      events: {
        pick: (ex) => {
          if (!ex) return;
          this.setData({
            editorVisible: true,
            payload: { mode: 'strength', isNew: true, name: ex.n, part: ex.p, exId: ex.id, date, groups: [{ no: 1, reps: 10, weight: 0, done: false }] }
          });
        }
      }
    });
  },

  // 饮食卡：点某一行就地改份量（少半份 / 标准 / 多一倍），总热量与日志文案同步重算
  fixMeal(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    const idx = Number(ds.i);
    const logs = store.getLogs() || [];
    const l = logs.find(x => x && x.id === id);
    if (!l || !l.meta || !(l.meta.items || [])[idx]) return;
    const it = l.meta.items[idx];
    const factor = [0.5, 1, 2];
    wx.showActionSheet({
      itemList: ['少半份', '标准', '多一倍'],
      success: (r) => {
        const f = factor[r.tapIndex];
        const base = Number(it.baseKcal) || Number(it.kcal) || 0;
        const baseP = String(it.basePortion || it.portion || '1 份');
        const scaled = food.rescale({ name: it.name, portion: baseP, kcal: base, baseKcal: base, factor: 1, confidence: it.confidence }, f);
        it.baseKcal = base;
        it.basePortion = baseP;
        it.factor = f;
        it.portion = scaled.portion;
        it.kcal = scaled.kcal;
        l.meta.totalKcal = food.totalOf(l.meta.items);
        l.content = (l.meta.meal || '一餐') + ' · 约 ' + l.meta.totalKcal + ' kcal';
        l.ts = Date.now();
        store.setLogs(engine.dedupeLogs(logs));
        store.markDirty('logs', l.id);
        this.refresh();
        wx.showToast({ title: '已改为 ' + scaled.portion, icon: 'none' });
      },
      fail: () => {}
    });
  },

  delLog(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录',
      content: '只删这条日志；训练数据仍在训练页，可去「训练」删动作。',
      confirmText: '删除', confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        actions.removeLog(id);
        this.refresh();
      }
    });
  },

  goStats() {
    this.setData({ tab: 'stats', stats: this.buildStats() });
  },

  goPR() { wx.navigateTo({ url: '/pages/pr/index' }); },

  onEditorClose() { this.setData({ editorVisible: false, payload: null }); },

  onEditorConfirm(e) {
    const d = e.detail;
    const cur = this.data.payload || {};
    const date = cur.date || (d.record && d.record.date) || engine.dayKey();
    const rec = Object.assign({}, d.record, { date });
    if (d.mode === 'cardio') actions.saveCardio(rec);
    else actions.saveStrength(rec);
    this.setData({ editorVisible: false, payload: null, quickText: '', parseHint: null });
    this.refresh();
    wx.showToast({ title: d.isNew ? '已添加' : '已保存', icon: 'none' });
  },

  onEditorDelete(e) {
    const d = e.detail;
    const date = (this.data.payload && this.data.payload.date) || engine.dayKey();
    if (d.mode === 'cardio') actions.deleteCardio(d.uid, date);
    else actions.deleteStrength(d.uid, date);
    this.setData({ editorVisible: false, payload: null });
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  orbFocus() { wx.navigateTo({ url: '/pages/focus/index?date=' + engine.dayKey() }); },

  orbSummary() { wx.switchTab({ url: '/pages/train/index' }); },

  afterOrbNote() { this.refresh(); }
});
