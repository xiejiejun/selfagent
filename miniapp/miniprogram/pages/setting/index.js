const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const sync = require('../../libs/sync/index');
const settings = require('../../libs/settings');
const ui = require('../../libs/ui');
const polish = require('../../libs/aipolish');
const decision = require('../../libs/decision');
const LIB = require('../../libs/data/lib');

const PANEL_TITLE = { profile: '个人档案', prefs: '记录偏好', train: '训练设置', ai: '动作与 AI', data: '数据', about: '关于' };

Page({
  data: {
    height: '', weight: '', goal: '',
    logsCount: 0, recordsCount: 0, cardioCount: 0,
    syncText: '未同步', syncOn: false, syncAuto: true, cloudReady: false, busy: false,
    typesView: [],
    newTag: '', newType: '',
    restSec: 90, autoNext: false, wStep: 2.5, pureData: false, agentAuto: false,
    memList: [],
    opList: [],
    activeType: '',
    panel: '', panelTitle: '', advOpen: false,
    version: 'v0.9',
    sum: { profile: '', prefs: '', train: '', ai: '', data: '', about: '' }
  },

  onShow() {
    this.refresh();
    const app = getApp();
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
  },

  openPanel(e) {
    const p = e.currentTarget.dataset.p;
    if (!p) return;
    ui.light();
    this.setData({ panel: p, panelTitle: PANEL_TITLE[p] || '' });
  },

  closePanel() {
    this.setData({ panel: '', advOpen: false });
  },

  toggleAdv() {
    ui.light();
    this.setData({ advOpen: !this.data.advOpen });
  },

  refresh() {
    const p = store.getProfile() || {};
    const train = engine.ensureTrain(store.getTrain());
    const w = sync.watermark();
    const ts = ['logs', 'train', 'profile', 'settings', 'trainmeta'].reduce((a, k) => Math.max(a, Number(w[k]) || 0), 0);
    const pendN = sync.status().pending;
    const last = pendN
      ? ((ts ? '已同步 · ' + engine.fmtTime(new Date(ts).toISOString()) : '未同步') + ' · 待推 ' + pendN)
      : (ts ? '已同步 · ' + engine.fmtTime(new Date(ts).toISOString()) : '未同步');
    const cfg = settings.trainCfg();
    const typesView = settings.types().map(t => ({ key: t.key, label: t.label, color: settings.colorFor(t.key), tags: t.tags || [] }));
    const tagCount = typesView.reduce((n, t) => n + t.tags.length, 0);
    const logsCount = (store.getLogs() || []).length;
    const recordsCount = (train.records || []).length;
    const cardioCount = (train.cardio || []).length;
    const memList = settings.mem();
    const opList = decision.ops().slice(0, 8).map(o => ({
      id: o.id, title: o.title, desc: o.desc, auto: !!o.auto, undone: !!o.undone,
      at: engine.shortDate(engine.dayKey(new Date(o.at))) + ' ' + engine.fmtTime(new Date(o.at).toISOString())
    }));
    let ver = '';
    try {
      const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
      ver = (info.miniProgram && info.miniProgram.version) || '';
    } catch (e) {}
    const version = ver ? 'v' + ver : this.data.version;

    const active = this.data.activeType && typesView.some(t => t.key === this.data.activeType)
      ? this.data.activeType
      : (typesView[0] ? typesView[0].key : '');

    this.setData({
      height: p.height || '',
      weight: p.weight || '',
      goal: p.goal || '',
      logsCount,
      recordsCount,
      cardioCount,
      syncText: last,
      syncOn: !!ts,
      syncAuto: (store.getSettings() || {}).syncAuto !== false,
      typesView,
      restSec: cfg.rest || 90,
      autoNext: cfg.autoNext,
      wStep: cfg.step,
      pureData: !polish.enabled(),
      agentAuto: decision.autoOn(),
      memList,
      opList,
      activeType: active,
      version,
      sum: {
        profile: (p.height || p.weight) ? ((p.height || '—') + ' cm · ' + (p.weight || '—') + ' kg') : '还没填',
        prefs: typesView.length + ' 类型 · ' + tagCount + ' 标签',
        train: '休息 ' + (cfg.rest || 90) + 's · 自动下一组' + (cfg.autoNext ? '开' : '关'),
        ai: (LIB && LIB.length ? LIB.length : '—') + ' 动作 · AI' + (this.data.cloudReady ? '已连接' : '未连接'),
        data: logsCount + ' 日志 · ' + recordsCount + ' 力量 · ' + cardioCount + ' 有氧',
        about: version + ' · 新手引导'
      }
    });
    if (!this.data.cloudReady) {
      const app = getApp();
      this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady) });
    }
    this.setData({ 'sum.ai': (LIB && LIB.length ? LIB.length : '—') + ' 动作 · AI' + (this.data.cloudReady ? '已连接' : '未连接') });
  },

  onField(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  saveProfile() {
    const p = store.getProfile() || {};
    p.height = this.data.height;
    p.weight = this.data.weight;
    p.goal = this.data.goal;
    store.setProfile(p);
    ui.ok();
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  /* ---------- 记录偏好：类型与标签 ---------- */
  onNewTag(e) { this.setData({ newTag: e.detail.value }); },
  onNewType(e) { this.setData({ newType: e.detail.value }); },

  pickActive(e) { ui.light(); this.setData({ activeType: e.currentTarget.dataset.k }); },

  addTag() {
    const t = (this.data.newTag || '').trim();
    const key = this.data.activeType;
    if (!key) { wx.showToast({ title: '先点一个类型', icon: 'none' }); return; }
    if (!t) { wx.showToast({ title: '写个标签名', icon: 'none' }); return; }
    settings.addTag(key, t);
    ui.ok();
    this.setData({ newTag: '' });
    this.refresh();
    wx.showToast({ title: '已加标签', icon: 'none' });
  },

  delTag(e) {
    const ds = e.currentTarget.dataset;
    wx.showModal({
      title: '删除标签',
      content: '「' + ds.tag + '」会从 ' + settings.typeLabel(ds.k) + ' 里移除，历史记录里的标签不动。',
      confirmText: '删除', confirmColor: '#D9534F',
      success: (r) => {
        if (!r.confirm) return;
        settings.delTag(ds.k, ds.tag);
        this.refresh();
      }
    });
  },

  addType() {
    const t = (this.data.newType || '').trim();
    if (!t) return;
    const rec = settings.addType(t);
    if (!rec) { wx.showToast({ title: '这个名字已存在', icon: 'none' }); return; }
    ui.ok();
    this.setData({ newType: '', activeType: rec.key });
    this.refresh();
    wx.showToast({ title: '已加类型', icon: 'none' });
  },

  delType(e) {
    const key = e.currentTarget.dataset.k;
    const tv = this.data.typesView.find(x => x.key === key);
    if (!tv) return;
    wx.showModal({
      title: '删除类型',
      content: '删掉「' + tv.label + '」以及它下面的标签。已有记录保留原来的类型键。',
      confirmText: '删除', confirmColor: '#D9534F',
      success: (r) => {
        if (!r.confirm) return;
        settings.delType(key);
        if (this.data.activeType === key) this.setData({ activeType: '' });
        this.refresh();
      }
    });
  },

  /* ---------- 训练设置 ---------- */
  onRest(e) {
    const v = Number(e.detail.value) || 0;
    this.setData({ restSec: v });
    settings.setTrainCfg({ rest: v });
  },

  onStep(e) {
    const v = Number(e.detail.value) || 2.5;
    this.setData({ wStep: v });
    settings.setTrainCfg({ step: v });
  },

  toggleAuto(e) {
    const v = !!e.detail.value;
    this.setData({ autoNext: v });
    settings.setTrainCfg({ autoNext: v });
  },

  togglePure(e) {
    const v = !!e.detail.value;
    polish.setPureData(v);
    this.setData({ pureData: v });
    if (v) polish.clearCache();
  },

  // L3 授权：AI 直接调整计划（默认关）。开着时建议自动执行，改动都进操作日志
  toggleAgentAuto(e) {
    const v = !!e.detail.value;
    decision.setAuto(v);
    this.setData({ agentAuto: v });
    wx.showToast({ title: v ? '授权 AI 直接调整计划' : '已收回授权', icon: 'none' });
  },

  undoOp(e) {
    const id = e.currentTarget.dataset.id;
    const r = decision.undo(id);
    if (r && r.ok) {
      this.refresh();
      wx.showToast({ title: '已撤销 · ' + (r.tip || ''), icon: 'none' });
    } else {
      wx.showToast({ title: '这条撤销不了', icon: 'none' });
    }
  },

  clearOps() {
    decision.clearOps();
    this.refresh();
    wx.showToast({ title: '日志已清空', icon: 'none' });
  },

  /* ---------- Agent 记忆 ---------- */
  clearMem() {
    wx.showModal({
      title: '清除 Agent 记忆',
      content: '会清掉分析时累积的偏好与结论记忆，不影响日志与训练数据。',
      confirmText: '清除', confirmColor: '#D9534F',
      success: (r) => {
        if (!r.confirm) return;
        settings.setMem([]);
        this.refresh();
        wx.showToast({ title: '已清除', icon: 'none' });
      }
    });
  },

  /* ---------- 新手引导 / 关于 ---------- */
  replayGuide() {
    wx.showModal({
      title: 'SelfAgent · 三步开始',
      content: '1) 记录：一句话写下今天，精力与情绪各点一下\n2) 训练：从动作库挑动作，逐组打点或进专注模式\n3) 分析：攒够几条记录后看画像、规划与推演',
      confirmText: '去记录', cancelText: '知道了',
      success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/log/index' }); }
    });
  },

  about() {
    let ui = '';
    try {
      const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
      ui = (info.miniProgram && info.miniProgram.version) || '';
    } catch (e) {}
    wx.showModal({
      title: '关于 SelfAgent 小程序',
      content: '本地优先：日志、训练、设置都存在手机本地，云端只在点「上传」时同步。\n功能：逐组训练 / 专注计时 / AI 画像与报告 / 统计与周回顾。\n版本 ' + (ui || '本地开发版'),
      showCancel: false, confirmText: '知道了'
    });
  },

  exportData() {
    const dump = { logs: store.getLogs(), train: store.getTrain(), profile: store.getProfile(), settings: store.getSettings(), tomb: store.getTomb() };
    wx.setClipboardData({ data: JSON.stringify(dump), success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' }) });
  },

  importData() {
    wx.getClipboardData({
      success: (r) => {
        let obj = null;
        try { obj = JSON.parse(r.data); } catch (e) { obj = null; }
        if (!obj || (!obj.logs && !obj.train)) { wx.showToast({ title: '剪贴板不是有效数据', icon: 'none' }); return; }
        wx.showModal({
          title: '覆盖导入',
          content: '会用剪贴板数据覆盖本机的记录与训练数据，确定继续？',
          confirmText: '导入',
          success: (m) => {
            if (!m.confirm) return;
            if (obj.logs) store.setLogs(obj.logs);
            if (obj.train) store.setTrain(obj.train);
            if (obj.profile) store.setProfile(obj.profile);
            if (obj.settings) store.setSettings(obj.settings);
            if (obj.tomb) store.setTomb(obj.tomb);
            (obj.logs || []).forEach(l => { if (l && l.id) store.markDirty('logs', l.id); });
            ((obj.train || {}).records || []).forEach(r => { if (r && r.uid) store.markDirty('train', r.uid); });
            ((obj.train || {}).cardio || []).forEach(r => { if (r && r.uid) store.markDirty('train', r.uid); });
            store.markDirty('snap', 'trainmeta');
            sync.flush();
            this.refresh();
            wx.showToast({ title: '已导入', icon: 'none' });
          }
        });
      }
    });
  },

  toggleSyncAuto(e) {
    const cfg = store.getSettings() || {};
    cfg.syncAuto = !!e.detail.value;
    store.setSettings(cfg);
    this.setData({ syncAuto: cfg.syncAuto });
    if (cfg.syncAuto) sync.boot(true).then(() => this.refresh());
    wx.showToast({ title: cfg.syncAuto ? '自动同步已开' : '自动同步已关', icon: 'none' });
  },
  pushCloud() {
    if (!this.data.cloudReady) { wx.showModal({ title: '云开发未配置', content: '先在 app.js 填 CLOUD_ENV 并部署云函数。', showCancel: false }); return; }
    if (this.data.busy) return;
    this.setData({ busy: true });
    sync.pushAll()
      .then(r => {
        this.setData({ busy: false });
        if (!r || !r.ok) {
          wx.showModal({ title: '上传失败', content: String((r && r.error) || '云函数未返回成功（检查 syncPush 是否已部署）'), showCancel: false });
        } else {
          const left = Number(r.remaining) || 0;
          wx.showToast({ title: left ? ('已上传 · 待推 ' + left) : ('已上传' + (r.batches ? ' · ' + r.batches + ' 包' : '')), icon: 'none' });
        }
        this.refresh();
      })
      .catch(err => {
        this.setData({ busy: false });
        wx.showModal({ title: '上传失败', content: String((err && (err.errMsg || err.message)) || err), showCancel: false });
        console.warn('[sync] push', err);
      });
  },

  pullCloud() {
    if (!this.data.cloudReady) { wx.showModal({ title: '云开发未配置', content: '先在 app.js 填 CLOUD_ENV 并部署云函数。', showCancel: false }); return; }
    this.setData({ busy: true });
    sync.boot(true)
      .then(r => { this.setData({ busy: false }); this.refresh(); wx.showToast({ title: r && r.ok ? '已合并并上传' : '同步失败', icon: 'none' }); })
      .catch(err => { this.setData({ busy: false }); wx.showToast({ title: '拉取失败', icon: 'none' }); console.warn('[sync] pull', err); });
  },

  goPlan() { wx.navigateTo({ url: '/pages/plan/index' }); },
  goLibrary() { wx.navigateTo({ url: '/pages/library/index' }); },
  goImport() { wx.navigateTo({ url: '/pages/import/index' }); },
  goPage(e) { const url = e.currentTarget.dataset.url; if (url) wx.navigateTo({ url }); },
  goScan() { wx.navigateTo({ url: '/pages/scan/index' }); },
  goAifind() { wx.navigateTo({ url: '/pages/aifind/index' }); },

  clearAll() {
    wx.showModal({
      title: '清空本机数据',
      content: '会删掉本机所有记录与训练数据（云端不动），确定？',
      confirmText: '清空', confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        // 清空要留下墓碑，否则下次同步会把云端数据又拉回来
        const train = store.getTrain() || {};
        const tomb = (store.getTomb() || []).slice();
        (train.records || []).forEach(x => { if (x && x.uid) tomb.push({ k: 'train', u: x.uid, at: Date.now() }); });
        (train.cardio || []).forEach(x => { if (x && x.uid) tomb.push({ k: 'cardio', u: x.uid, at: Date.now() }); });
        (store.getLogs() || []).forEach(x => { if (x && x.id) tomb.push({ k: 'log', u: x.id, at: Date.now() }); });
        store.setLogs([]);
        store.setTrain({});
        store.setTomb(tomb);
        store.markDirty('snap', 'trainmeta');
        sync.flush();
        ui.warn();
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  }
});
