// 训练页内嵌「计划」分段：原 pages/plan 的内容抽成组件，页内切换不再跳页
const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const actions = require('../../libs/actions');
const recommend = require('../../libs/recommend');
const ai = require('../../libs/ai');
const sanity = require('../../libs/sanity');
const cardioLib = require('../../libs/cardio');

const TMPL = 'whCghbXJjZbMzZACF7k5lhLSPynVFAUPzFvf7gXrWqM';

// 计划条目右侧参数列：有氧 20′ / 3×30（可带 km），力量 自重 3×12
function lineOf(i) {
  if (!i) return '';
  const isCd = i.mode === 'sets' || i.mode === 'timer' || !!i.dur;
  if (isCd) return cardioLib.cardioLine(i);
  return (i.weight > 0 ? engine.wText(i.weight, engine.isUniName(i.name)) + ' ' : '自重 ') + (i.sets || 0) + '×' + (i.reps || 0);
}

function isCdItem(i) { return !!i && (i.mode === 'sets' || i.mode === 'timer' || !!i.dur); }

Component({
  properties: {
    // 顶部日期导航选中的日期：计划预览与「加入训练」都跟着这一天走
    date: { type: String, value: '' },
    dateLabel: { type: String, value: '' }
  },

  data: {
    days: 3,
    setsPerDay: 12,
    remind: '20:00',
    week: [],
    weekDone: 0,
    planText: '',
    rec: null,
    recAuto: true,          // ★AI 推荐（false = 用户自选部位）
    recReason: '',
    askingWhy: false,
    partOpen: false,        // 部位选择 Sheet
    parts: [],
    pending: null,          // Sheet 里选中的部位
    regenerating: false,
    recEdited: false,       // 手改过条目（换部位前要确认替换）
    todayMark: '',
    sub: false,
    subTs: '',
    asking: false,
    cloudReady: false,
    importLabel: '加入今日训练'
  },

  observers: {
    date() { this.load(); }
  },

  lifetimes: {
    attached() {
      this.partPick = '';
      this.aiPart = '';
      this.load();
    }
  },

  methods: {
    targetDate() { return this.data.date || engine.dayKey(); },

    // ---- 部位选择 Sheet（推荐是默认值，不是强制项）----
    openPart() {
      const train = engine.ensureTrain(store.getTrain());
      const parts = recommend.partStates(train, this.aiPart || '');
      const cur = (this.data.rec && this.data.rec.part) || '';
      this.setData({ partOpen: true, parts, pending: parts.find(p => p.key === cur) || parts[0] });
    },

    closePart() { this.setData({ partOpen: false, pending: null }); },

    pickPartTile(e) {
      const k = e.currentTarget.dataset.k;
      const p = (this.data.parts || []).find(x => x.key === k);
      if (p) this.setData({ pending: p });
    },

    // 确认部位：恢复中的部位不阻拦，只二次确认；随后即时重生成
    confirmPart() {
      const p = this.data.pending;
      if (!p) return;
      if (!p.warn) { this.applyPart(p.key); return; }
      wx.showModal({
        title: p.view + ' ' + (p.h < 999 ? p.h + 'h' : '') + ' 恢复中',
        content: '练了可能影响恢复质量。仍要练' + p.view + '？',
        confirmText: '仍要练', cancelText: '换个部位',
        success: (m) => { if (m.confirm) this.applyPart(p.key); }
      });
    },

    // 手改过的计划被替换前确认（延续 web 版护栏）
    applyPart(part) {
      if (this.data.recEdited) {
        wx.showModal({
          title: '替换已调整的计划',
          content: '当前计划有手动调整的动作，换成「' + (recommend.PART_LIST.indexOf(part) >= 0 ? part : part) + '」会覆盖这些调整。',
          confirmText: '替换', cancelText: '保留',
          success: (m) => { if (m.confirm) this.doApplyPart(part); }
        });
        return;
      }
      this.doApplyPart(part);
    },

    doApplyPart(part) {
      const date = this.targetDate();
      this.partPick = part;
      this.setData({ partOpen: false, pending: null, regenerating: true, recReason: '', askingWhy: false });
      const train = engine.ensureTrain(store.getTrain());
      const custom = actions.customList();
      setTimeout(() => {
        const rec = this.buildRec(train, custom, date);
        this.setData({
          rec, recAuto: false, recEdited: false, regenerating: false
        }, () => {
          this.setData({
            parts: recommend.partStates(train, this.aiPart || ''),
            todayMark: date === engine.dayKey() ? rec.view : ''
          });
        });
        wx.showToast({ title: '已生成' + rec.view + '日计划', icon: 'none' });
      }, 500);
    },

    // 单条动作手改：换同部位另一个 / 删除
    itemMenu(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rec = this.data.rec;
      if (!rec || !rec.items[i]) return;
      const cur = rec.items[i];
      wx.showActionSheet({
        itemList: ['换一个同部位动作', '删除这个动作'],
        success: (r) => {
          const items = rec.items.slice();
          if (r.tapIndex === 0) {
            const t = engine.ensureTrain(store.getTrain());
            const ids = items.map(x => x.exId);
            const nx = recommend.nextItem(rec.part, ids, t, actions.customList());
            if (!nx) { wx.showToast({ title: '没有更多同部位动作', icon: 'none' }); return; }
            const joined = cur.joined;
            items[i] = Object.assign({}, nx, { joined, cd: isCdItem(nx), line: lineOf(nx) });
          } else {
            if (items.length <= 1) { wx.showToast({ title: '至少留一个动作', icon: 'none' }); return; }
            items.splice(i, 1);
          }
          this.setData({ 'rec.items': items, recEdited: true });
          wx.showToast({ title: r.tapIndex === 0 ? '已换动作' : '已删除', icon: 'none' });
        }
      });
    },

    noop() {},

    load() {
      const app = getApp();
      const s = store.getSettings() || {};
      const plan = s.plan || {};
      const sub = s.sub || {};
      const train = engine.ensureTrain(store.getTrain());
      const custom = actions.customList();
      const week = engine.lastNDays(train, 7).reverse();
      const target = plan.setsPerDay || this.data.setsPerDay;
      const date = this.targetDate();

      const rec = this.buildRec(train, custom, date);
      if (!this.aiPart) this.aiPart = recommend.pickPart(train).part;
      const isToday = date === engine.dayKey();
      this.setData({
        cloudReady: !!(app && app.globalData && app.globalData.cloudReady),
        days: plan.days || this.data.days,
        setsPerDay: target,
        remind: plan.remind || this.data.remind,
        planText: plan.text || '',
        rec,
        recAuto: !this.partPick,
        recEdited: false,
        parts: recommend.partStates(train, rec.part),
        pending: null,
        todayMark: isToday ? rec.view : '',
        sub: !!sub.enabled,
        subTs: sub.tmplId ? '模板已绑定' : '',
        importLabel: isToday ? '加入今日训练' : '加入 ' + engine.shortDate(date) + ' 的训练',
        week: week.map(d => ({
          label: engine.shortDate(d.date),
          done: d.done,
          h: Math.max(6, Math.round(Math.min(1, d.done / Math.max(1, target)) * 100)),
          ok: d.done >= target,
          today: d.date === engine.dayKey()
        })),
        weekDone: week.reduce((a, d) => a + d.done, 0)
      });
    },

    // 组装推荐卡：AI 结论或用户自选部位；条目一律过部位校验
    buildRec(train, custom, date) {
      const r = this.partPick
        ? recommend.recommendFor(train, custom, this.partPick)
        : recommend.recommend(train, custom);
      const joinedIds = (train.records || []).filter(x => x && x.date === date).map(x => x.exId);
      r.items = recommend.validateItems(r.part, r.items).map(i => Object.assign({}, i, {
        joined: joinedIds.indexOf(i.exId) >= 0,
        cd: isCdItem(i),
        line: lineOf(i)
      }));
      return r;
    },

    pickDays(e) {
      const n = Number(e.currentTarget.dataset.n);
      if (n >= 1 && n <= 7) this.setData({ days: n });
    },
    onSets(e) { this.setData({ setsPerDay: Math.max(1, parseInt(e.detail.value, 10) || 12) }); },
    onRemind(e) { this.setData({ remind: e.detail.value }); },

    save() {
      const s = store.getSettings() || {};
      s.plan = Object.assign({}, s.plan, {
        days: this.data.days, setsPerDay: this.data.setsPerDay,
        remind: this.data.remind, text: this.data.planText
      });
      store.setSettings(s);
      this.load();
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
          { role: 'system', content: '健身教练。只输出 JSON，不要解释、不要代码块标记。格式：{"days":[{"day":"周一","part":"胸","items":["动作名","动作名"]}],"note":"一句话注意点"}。part 只能是 肩/胸/背/腰腹/上臂/上腿 之一；items 必须是该部位动作，名称取自常见动作库。' },
          { role: 'user', content: '目标：每周 ' + this.data.days + ' 天、每天 ' + this.data.setsPerDay + ' 组。\n近30天部位容量：' + parts.map(p => p.part + p.volume + 'kg').join('，') + '\n高频动作：' + tops.map(t => t.name).join('、') }
        ],
        max_tokens: 320,
        temperature: 0.3
      }).then(res => {
        if (!res.ok || !res.text) { this.fallbackPlan(parts, tops, res.error || ''); return; }
        const obj = recommend.parseAiPlan(res.text);
        const built = obj ? recommend.buildAiPlan(obj, train, actions.customList()) : null;
        if (!built || !built.days.length) { this.fallbackPlan(parts, tops, 'AI 输出无法解析'); return; }
        const s = store.getSettings() || {};
        s.plan = Object.assign({}, s.plan, { text: built.text, aiDays: built.days });
        store.setSettings(s);
        this.setData({ asking: false, planText: built.text });
        if (built.fixed) wx.showToast({ title: '已按部位校正 ' + built.fixed + ' 个动作', icon: 'none' });
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
      this.setData({ asking: false, planText: head + lines.join('；') + '。' + tail });
      wx.showToast({ title: 'AI 超时，已用本地计划', icon: 'none' });
    },

    importToday() {
      if (!this.data.rec || !this.data.rec.items.length) return;
      const date = this.targetDate();
      const train = store.getTrain();
      let added = 0;
      this.data.rec.items.forEach(i => {
        const inStrength = (train.records || []).some(r => r && r.date === date && r.exId === i.exId);
        const inCardio = (train.cardio || []).some(c => c && c.date === date && (c.exId === i.exId || (!i.exId && c.name === i.name)));
        if (i.cd) {
          if (inCardio || inStrength) return;
          if (i.mode === 'sets') {
            const groups = [];
            for (let g = 0; g < (i.sets || 3); g++) groups.push({ no: g + 1, reps: i.reps || 0, weight: i.weight || 0, done: false, rpe: 0 });
            actions.saveCardio({ date, modal: i.name, name: i.name, exId: i.exId, part: '有氧', mode: 'sets', groups, done: false, dist: i.dist || 0 });
          } else {
            actions.saveCardio({ date, modal: i.name, name: i.name, exId: i.exId, part: '有氧', mode: 'timer', min: i.dur || 20, dur: i.dur || 20, done: false, dist: i.dist || 0 });
          }
          added++;
          return;
        }
        if (inStrength) return;
        const groups = [];
        for (let g = 0; g < i.sets; g++) groups.push({ no: g + 1, reps: i.reps, weight: i.weight || 0, done: false, warmup: false, rpe: 0, sec: 0 });
        actions.saveStrength({ date, exId: i.exId, name: i.name, part: i.part, sets: i.sets, reps: i.reps, weight: i.weight || 0, groups });
        added++;
      });
      this.load();
      this.triggerEvent('changed', { date });
      if (!added) { wx.showToast({ title: '今天的训练里已有这些动作', icon: 'none' }); return; }
      wx.showModal({
        title: '已加入 ' + engine.shortDate(date),
        content: '新增 ' + added + ' 个动作，现在开始专注训练？',
        confirmText: '开始训练',
        cancelText: '稍后',
        confirmColor: '#12A594',
        success: r => {
          if (r.confirm) wx.navigateTo({ url: '/pages/focus/index?date=' + date });
        }
      });
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
  }
});
