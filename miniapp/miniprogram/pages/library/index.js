const data = require('../../libs/data/index');
const store = require('../../libs/store/index');
const actions = require('../../libs/actions');
const cloudurl = require('../../libs/cloudurl');
const CLIP_INDEX = require('../../libs/clip-index.js');
const ai = require('../../libs/ai');
const sanity = require('../../libs/sanity');
const usearch = require('../../libs/usearch.js');

const PAGE_SIZE = 40;
const COACH_KEY = 'selfagent_coach_lib_v1';

// AI 理解条上的条件文案：部位 · 器械 · 限制
function findLabel(slots) {
  if (!slots) return '';
  const t = [];
  if (slots.part) t.push(slots.part);
  if (slots.equips && slots.equips.length) t.push(slots.equips.slice(0, 2).join('/'));
  if (!t.length && slots.keywords && slots.keywords.length) t.push(slots.keywords.slice(0, 2).join('/'));
  if (slots.constraints && slots.constraints.length) t.push(slots.constraints[0]);
  return t.join(' · ');
}

Page({
  data: {
    q: '',
    part: '全部',
    autoFocus: true,
    equip: '全部',
    favOnly: false,
    parts: data.PARTS,
    equips: data.EQUIPS.map(e => e.k),
    list: [],
    total: 0,
    shown: 0,
    hasMore: false,
    noImg: 0,
    imgDone: 0,
    imgTotal: 0,
    cloudReady: false,
    detail: null,
    nameDraft: '',
    learn: false,      // 学习态：只逛不加
    coach: false,      // 一次性场景提示
    planDate: '',      // 从排期卡进来：选中动作落到该日计划
    planLabel: '',
    searching: false,
    // 统一检索
    src: 'kw',         // kw | ai | vision
    srcLabel: '',
    busy: false,
    busyText: '',
    aiChips: [],
    clar: [],
    clarQ: '',
    miss: [],
    aiErr: '',
    condKind: '',
    condTitle: '',
    condOpts: []
  },

  onLoad(opts) {
    const app = getApp();
    this.media = {};
    // 短片索引：发布期流水线生成的静态 JSON + 本机缓存兜底（运行时不查云端）
    this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    this.all = [];
    this.migRound = 0;
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady), total: data.total });
    // 来源：from=learn 是学习态（悬浮球 / 训练页「先逛逛」），其余为训练态
    const learn = !!(opts && opts.from === 'learn');
    let coach = false;
    if (learn) {
      try { coach = !wx.getStorageSync(COACH_KEY); } catch (e) { coach = true; }
    }
    this.setData({ learn, coach, autoFocus: !learn });
    // 从训练页空态「先记一条有氧」进来：预选部位
    const part = (opts && opts.part) ? decodeURIComponent(opts.part) : '';
    if (part && data.PARTS.indexOf(part) >= 0) this.setData({ part });
    // 从训练页 ＋ 的搜索框进来：直接落到搜索结果
    const kw = (opts && opts.q) ? decodeURIComponent(opts.q) : '';
    if (kw) this.setData({ q: kw, searching: true, autoFocus: false });
    // 从排期卡的「＋排」进来：这页选中的动作落在该日计划，而不是今天训练
    const pd = (opts && opts.plan) ? decodeURIComponent(opts.plan) : '';
    if (pd) this.setData({ planDate: pd, planLabel: pd.slice(5) });
    this.refresh();
    // 从训练页「详情」进来：带 id 就直接展开该动作的详情
    const want = (opts && opts.id) ? decodeURIComponent(opts.id) : '';
    if (want) setTimeout(() => this.openDetail({ currentTarget: { dataset: { id: want } } }), 80);
    // 统一相机页拍完回传：vision=1 + img，直接跑图片识别
    const img = (opts && opts.img) ? decodeURIComponent(opts.img) : '';
    if (img) setTimeout(() => this.runVision(img), 120);
  },

  onShow() {
    if (this.all && this.all.length) this.refresh();
  },

  byAny(id) {
    const ex = data.byId(id);
    if (ex) return ex;
    return actions.customList().find(x => x && x.id === id) || null;
  },

  refresh() {
    const q = this.data.q;
    const part = this.data.part;
    const equip = this.data.equip;
    const favs = (store.getTrain() || {}).favs || [];
    const names = actions.exNameMap();
    const kw = String(q || '').trim();

    let list = data.search(q, part, equip, 100000);

    const mineRaw = actions.customList().filter(function (e) {
      if (!e) return false;
      if (part !== '全部' && e.p !== part) return false;
      if (equip !== '全部' && e.e !== equip) return false;
      if (kw && String(e.n || '').indexOf(kw) < 0) return false;
      return true;
    });
    const mine = this.data.favOnly ? [] : mineRaw.map(function (e) {
      return Object.assign({}, e, { mine: true });
    });

    if (this.data.favOnly) list = list.filter(function (e) { return favs.indexOf(e.id) >= 0; });
    list = mine.concat(list);

    this.all = list;
    // migRound 只在页面生命周期内累计，不随每次 refresh 清零，避免无限循环抢渲染
    if (typeof this.migRound !== 'number') this.migRound = 0;
    const visible = list.slice(0, PAGE_SIZE).map(e => this.card(e, favs, names));
    this.setData({
      imgDone: Object.keys(this.media).length,
      imgTotal: list.length,
      list: visible,
      shown: visible.length,
      hasMore: list.length > visible.length,
      noImg: visible.filter(c => !c.fileID).length,
      src: 'kw',
      srcLabel: list.length ? '命中 ' + list.length + ' 个动作' : '',
      aiChips: [], clar: [], clarQ: '', miss: [], missText: '', aiErr: '',
      condKind: '', condOpts: []
    });
    this.fillImages(visible.filter(c => !c.fileID).map(c => c.id));
  },

  card(e, favs, names) {
    // 渲染层只认 http(s)：cloud:// 交给 placeholder，等 fillImages 换成临时链接再渲染
    const raw = this.media[e.id] || e.img || e.fileID || '';
    return {
      id: e.id,
      n: (names && names[e.id]) || e.n,
      alias: !!(names && names[e.id]),
      p: e.p,
      e: e.e,
      fileID: String(raw).indexOf('cloud://') === 0 ? '' : raw,
      fav: favs.indexOf(e.id) >= 0,
      mine: !!e.mine || String(e.id || '').indexOf('my') === 0,
      why: e.why || ''
    };
  },

  // 图卡：库动作先查 media_map（经云函数读，避开集合读权限），再换临时 https 链接；
  // 自定义动作不查映射表，直接用它在云存储里的图
  fillImages(ids) {
    if (!ids.length) return;
    const my = ids.filter(id => String(id).indexOf('my') === 0);
    my.forEach(id => this.resolveCustPoster(id));
    const rest = ids.filter(id => String(id).indexOf('my') !== 0);
    if (!rest.length || !this.data.cloudReady || !wx.cloud) return;
    const chunk = rest.slice(0, 20);
    this.mapIds(chunk).then(missing => {
      const more = rest.slice(20);
      if (more.length) this.fillImages(more);
      if (missing.length && !this.imgFillBusy) {
        this.imgFillBusy = true;
        wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'batchgen', ids: missing.slice(0, 20), budget: 12000 } })
          .then(r => {
            const map = ((r && r.result) || {}).map || {};
            if (Object.keys(map).length) this.applyMap(map);
            this.imgFillBusy = false;
            if (!more.length) this.migrateMissing();
          })
          .catch(() => { this.imgFillBusy = false; if (!rest.length) this.migrateMissing(); });
      } else if (!rest.length) {
        this.migrateMissing();
      }
    });
  },

  // 读映射 → 换临时链接 → 返回仍缺图的 id
  mapIds(ids) {
    return wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids } })
      .then(r => {
        const map = ((r && r.result) || {}).map || {};
        this.applyMap(map);
        return ids.filter(id => !map[id]);
      })
      .catch(err => {
        console.warn('[library] media_map', err);
        return [];
      });
  },

  applyMap(map) {
    const keys = Object.keys(map || {});
    if (!keys.length) return;
    cloudurl.resolve(keys.map(k => map[k]), (urls) => {
      if (!this.fids) this.fids = {};
      keys.forEach(k => {
        this.fids[k] = map[k];
        if (urls[map[k]]) this.media[k] = urls[map[k]];
      });
      this.repaint();
    });
  },

  repaint() {
    const favs = (store.getTrain() || {}).favs || [];
    const names = actions.exNameMap();
    const visible = this.all.slice(0, this.data.shown).map(e => this.card(e, favs, names));
    const patch = { list: visible, noImg: visible.filter(c => !c.fileID).length };
    const d = this.data.detail;
    if (d && !d.fileID && this.media[d.id]) patch.detail = Object.assign({}, d, { fileID: this.media[d.id] });
    this.setData(patch);
  },

  // 缩略图在真机上加载失败（多为临时链接过期 / 域名受限）：重取一次，仍不行就下到本地临时路径
  thumbErr(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    if (!this.thumbTry) this.thumbTry = {};
    const n = this.thumbTry[id] || 0;
    if (n >= 2) return;
    this.thumbTry[id] = n + 1;
    const fid = (this.fids || {})[id];
    if (!fid) { this.media[id] = ''; this.repaint(); return; }
    cloudurl.bust([fid]);
    cloudurl.resolve([fid], (urls) => {
      const u = urls[fid];
      if (u && u !== this.media[id]) { this.media[id] = u; this.repaint(); return; }
      // 同一链接仍失败：先试公共 CDN（白名单已放通时最快），再退到本地下载
      if (n === 0 && /^\d{4}$/.test(id)) {
        this.media[id] = 'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/' + id + '.webp';
        this.repaint();
        return;
      }
      if (!wx.cloud || !wx.cloud.downloadFile) { this.media[id] = ''; this.repaint(); return; }
      wx.cloud.downloadFile({ fileID: fid })
        .then(r => {
          if (r && r.tempFilePath) { this.media[id] = r.tempFilePath; this.repaint(); }
          else { this.media[id] = ''; this.repaint(); }
        })
        .catch(() => { this.media[id] = ''; this.repaint(); });
    });
  },

  // 图卡补全：对「全部动作」做断点续传（游标存本机），每次 6 张，页面在前台时持续跑
  // 云函数 gifMigrate 单次 3 秒硬上限，所以只能渐进补齐，不能一次全量
  migrateMissing() {
    if (!this.data.cloudReady || !wx.cloud) return;
    if (this.detailOpen) return;
    if (!this.all || !this.all.length) return;
    if (this.migRound >= 25) return;

    const total = this.all.length;
    let at = Number(wx.getStorageSync('selfagent_gifq_v1') || 0);
    if (at >= total) at = 0;
    let batch = [];
    let scan = 0;
    while (batch.length < 6 && scan < total) {
      const e = this.all[(at + scan) % total];
      if (e && e.id && !this.media[e.id] && String(e.id).indexOf('my') !== 0) batch.push(e.id);
      scan++;
    }
    this.setData({ imgDone: Object.keys(this.media).length, imgTotal: total });
    if (!batch.length) { wx.setStorageSync('selfagent_gifq_v1', 0); return; }

    this.migRound = (this.migRound || 0) + 1;
    wx.cloud.callFunction({ name: 'gifMigrate', data: { ids: batch } })
      .then(r => {
        const res = (r && r.result) || {};
        wx.setStorageSync('selfagent_gifq_v1', (at + scan) % total);
        if (res.migrated > 0) {
          wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: batch } })
            .then(q => {
              const map = ((q && q.result) || {}).map || {};
              const keys = Object.keys(map);
              cloudurl.resolve(keys.map(k => map[k]), (urls) => {
                keys.forEach(k => { this.media[k] = urls[map[k]] || ''; });
                this.repaint();
                this.setData({ imgDone: Object.keys(this.media).length, imgTotal: total });
                setTimeout(() => this.migrateMissing(), 400);
              });
            }).catch(() => setTimeout(() => this.migrateMissing(), 800));
          return;
        }
        setTimeout(() => this.migrateMissing(), 800);
      })
      .catch(err => { console.warn('[library] gifMigrate', err); setTimeout(() => this.migrateMissing(), 1500); });
  },

  onInput(e) {
    const v = e.detail.value;
    this.setData({ q: v });
    if (this._t) { clearTimeout(this._t); this._t = null; }
    const s = String(v || '').trim();
    if (!s) { this.setData({ src: 'kw', srcLabel: '', aiChips: [], clar: [], miss: [], busy: false }); this.refresh(); return; }

    // 短词先直出本地结果；长句/场景描述直接走 AI，不用等关键词
    const kind = usearch.route(s);
    if (kind === 'ai') {
      this._t = setTimeout(() => this.runAi(s), 800);
      return;
    }
    this.refresh();
    // 关键词一个都没命中：AI 兜底（用户已经描述了，只是用词不在词典里）
    this._t = setTimeout(() => {
      if (this.data.src !== 'kw') return;
      const hit = data.search(s, this.data.part, this.data.equip, 100000).length;
      if (!hit) this.runAi(s);
    }, 600);
  },

  noop() {},

  // 自然语言：AI 理解 + 重排，落同一个网格
  runAi(q) {
    const key = String(q || '').trim();
    if (!key) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ busy: true, busyText: 'AI 理解你的意图…', src: 'ai', aiErr: '' });
    usearch.aiSearch(key).then(r => {
      if (seq !== this._seq) return;
      if (!r || !r.list.length) {
        this.setData({
          busy: false, list: [], src: 'ai', srcLabel: '', aiChips: [], clar: [], miss: [], missText: '',
          aiErr: '这句没读出可用的动作，换个说法试试', shown: 0, total: 0, hasMore: false,
          imgTotal: 0, imgDone: 0, condKind: '', condOpts: [], noImg: 0
        });
        this.all = [];
        return;
      }
      const chips = usearch.slotsToChips(r.slots);
      const label = chips.length ? '✦ AI 理解' : ('✦ AI 理解：' + (findLabel(r.slots) || '按语义匹配'));
      this.applyUnified(r, label, chips, r.res || {});
    }).catch(() => {
      if (seq !== this._seq) return;
      this.setData({ busy: false, aiErr: 'AI 暂不可用' });
    });
  },

  // 图片：统一走 /pages/cam 全屏相机（src=equip），拍完回传本页 rather than 系统选择器
  takePhoto() {
    if (wx.navigateTo) {
      wx.navigateTo({ url: '/pages/cam/index?src=equip' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (f) this.runVision(f.tempFilePath);
      }
    });
  },

  // 以图搜动作：相机页回传、系统相册、都落到这里
  runVision(path) {
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ busy: true, busyText: 'AI 看图中…', src: 'vision', aiErr: '', list: [] });
    usearch.visionSearch(path).then(r => {
      if (seq !== this._seq) return;
      if (!r || !r.list.length) {
        this.setData({ busy: false, aiErr: '没认出可用动作，换个角度拍或直接描述你的场景' });
        return;
      }
      const parts = [];
      if (r.shot) parts.push(r.shot);
      if (r.rawText) parts.push(r.rawText);
      const label = '📷 识别到：' + (parts.join(' · ') || '健身场景');
      this.applyUnified(r, label, usearch.slotsToChips(r.slots), {});
    }).catch(() => {
      if (seq !== this._seq) return;
      this.setData({ busy: false, aiErr: '看图失败，换一张或直接描述场景' });
    });
  },

  // 统一渲染：AI / 拍照 / 条件修改都走这里
  applyUnified(r, label, chips, res) {
    const favs = (store.getTrain() || {}).favs || [];
    const names = actions.exNameMap();
    this.all = r.list || [];
    this._slots = r.slots || null;
    const list = this.all.map(e => this.card(e, favs, names));
    const cl = (res && res.clarify) || (r.slots && r.slots.clarify) || null;
    const miss = (res && res.notFound) || [];
    this.setData({
      busy: false, busyText: '',
      list, shown: list.length, hasMore: false, total: this.all.length,
      srcLabel: label || '',
      aiChips: chips || [],
      clar: cl && cl.options ? cl.options.slice(0, 4) : [],
      clarQ: (cl && cl.q) || '',
      miss,
      missText: miss.join('、'),
      aiErr: '',
      condKind: '', condOpts: [],
      imgDone: Object.keys(this.media).length, imgTotal: this.all.length,
      noImg: list.filter(c => !c.fileID).length
    });
    this.fillImages(list.filter(c => !c.fileID).map(c => c.id));
  },

  // 点 AI 理解条上的条件 → 就地改，改完本地重排（不再打 AI）
  editChip(e) {
    const k = e.currentTarget.dataset.k;
    if (!this._slots || !k) return;
    const titles = { part: '改部位', equip: '改器械', pattern: '改动作模式', cons: '伤病/限制' };
    let opts = [];
    if (k === 'part') opts = ['不限'].concat(data.PARTS);
    else if (k === 'equip') opts = ['不限', '哑铃', '杠铃', '绳索', '器械', '自重', '小器械'];
    else if (k === 'pattern') opts = ['不限', '水平推', '垂直推', '水平拉', '垂直拉', '蹲', '髋铰链', '弯举', '臂屈伸', '核心'];
    else opts = ['不限'];
    this.setData({ condKind: k, condTitle: titles[k] || '改条件', condOpts: opts });
  },

  pickCond(e) {
    const v = e.currentTarget.dataset.v;
    const k = this.data.condKind;
    if (!k || !this._slots) return;
    const slots = usearch.refineSlots(this._slots, k, v === '不限' ? '' : v);
    const r = usearch.localBySlots(slots);
    const chips = usearch.slotsToChips(slots);
    const label = '✦ AI 理解 · 已改条件';
    this.setData({ condKind: '', condOpts: [] });
    this.applyUnified(r, label, chips, {});
  },

  closeCond() { this.setData({ condKind: '', condOpts: [] }); },

  // 追问条：补一个条件再搜
  clarTap(e) {
    const o = e.currentTarget.dataset.o;
    if (!o) return;
    const q = (this.data.q + ' ' + o).trim();
    this.setData({ q, clar: [] });
    this.runAi(q);
  },

  // 空态：给个可点的例子，直接走 AI
  useExample(e) {
    const q = e.currentTarget.dataset.q;
    if (!q) return;
    this.setData({ q });
    this.runAi(q);
  },

  clearQ() {
    this.setData({ q: '', srcLabel: '', aiChips: [], clar: [], miss: [], aiErr: '', condKind: '', condOpts: [] });
    this.refresh();
  },

  onPart(e) {
    const p = e.currentTarget.dataset.p;
    this.setData({ part: p });
    // AI 结果里改部位：改条件重排，别把整句丢回关键词搜索
    if (this.data.src === 'ai' && this._slots) {
      const slots = usearch.refineSlots(this._slots, 'part', p === '全部' ? '' : p);
      const r = usearch.localBySlots(slots);
      this.applyUnified(r, '✦ AI 理解 · 已改条件', usearch.slotsToChips(slots), {});
      return;
    }
    this.refresh();
  },

  onEquip(e) {
    const eq = e.currentTarget.dataset.e;
    this.setData({ equip: eq });
    if (this.data.src === 'ai' && this._slots) {
      const slots = usearch.refineSlots(this._slots, 'equip', eq === '全部' ? '' : eq);
      const r = usearch.localBySlots(slots);
      this.applyUnified(r, '✦ AI 理解 · 已改条件', usearch.slotsToChips(slots), {});
      return;
    }
    this.refresh();
  },

  toggleFavView() {
    const on = !this.data.favOnly;
    this.setData({ favOnly: on });
    if (this.data.src !== 'kw' && this.all && this.all.length) {
      // AI/拍照结果直接在当前结果里过滤收藏，不重跑搜索
      const favs = (store.getTrain() || {}).favs || [];
      const names = actions.exNameMap();
      const src = this.all;
      const list = (on ? src.filter(e => favs.indexOf(e.id) >= 0) : src).map(e => this.card(e, favs, names));
      this.setData({ list, shown: list.length, hasMore: false, total: list.length });
      return;
    }
    this.refresh();
  },

  // 学习态一次性提示：看过就记下，不再出现
  dismissCoach() {
    this.setData({ coach: false });
    try { wx.setStorageSync(COACH_KEY, 1); } catch (e) {}
  },

  focusSearch() {
    this.setData({ searching: true, autoFocus: true });
    setTimeout(() => this.setData({ autoFocus: false }), 20);
  },

  toMylib() {
    wx.navigateTo({ url: '/pages/mylib/index' });
  },

  more() {
    const start = this.data.shown;
    const next = this.all.slice(start, start + PAGE_SIZE);
    if (!next.length) return;
    const favs = (store.getTrain() || {}).favs || [];
    const names = actions.exNameMap();
    const merged = this.data.list.concat(next.map(e => this.card(e, favs, names)));
    this.setData({
      list: merged, shown: merged.length, hasMore: this.all.length > merged.length,
      noImg: merged.filter(c => !c.fileID).length
    });
    this.fillImages(next.filter(e => !this.media[e.id]).map(e => e.id));
  },

  star(e) {
    const id = e.currentTarget.dataset.id;
    const on = actions.toggleFav(id);
    const list = this.data.list.map(c => (c.id === id ? Object.assign({}, c, { fav: on }) : c));
    const patch = { list };
    if (this.data.detail && this.data.detail.id === id) {
      patch.detail = Object.assign({}, this.data.detail, { fav: on });
    }
    this.setData(patch);
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
    if (this.data.favOnly && !on) this.refresh();
  },

  // 点卡片：弹动作详情（要领 / 名称编辑 / 收藏 / 加入训练）
  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const ex = this.byAny(id);
    if (!ex) return;
    const names = actions.exNameMap();
    const favs = (store.getTrain() || {}).favs || [];
    // 索引取值单独兜底：任何异常都不能挡住弹窗本身
    let cid = '';
    try { cid = (this.clip.url ? this.clip.url(ex.id) : '') || ''; } catch (err) { cid = ''; }
    const poster = this.media[ex.id] || ex.img || ex.fileID || '';
    const isCloud = String(poster).indexOf('cloud://') === 0;
    const isCloudClip = String(cid).indexOf('cloud://') === 0;
    this.setData({
      detail: {
        id: ex.id,
        n: names[ex.id] || ex.n,
        raw: ex.n,
        alias: !!names[ex.id],
        p: ex.p,
        e: ex.e,
        t: ex.t,
        mine: !!ex.mine || String(ex.id || '').indexOf('my') === 0,
        steps: (ex.s || '').split('\n').filter(x => x.trim()),
        // cloud:// 直接给 <image>/<video> 必挂（渲染层按相对路径请求），先空着，换到 https 再填
        fileID: isCloud ? '' : poster,
        clipID: isCloudClip ? '' : cid,
        fav: favs.indexOf(ex.id) >= 0
      },
      nameDraft: names[ex.id] || ex.n,
      clipReady: false
    });
    this.detailOpen = true;
    this.clipTempTried = false;
    if (this.data.learn) this.loadErrs(ex);
    if (isCloud) this.resolvePoster(ex.id, poster); else this.resolvePoster(ex.id, '');
    if (isCloudClip) {
      cloudurl.resolve([cid], (urls) => {
        const u = urls[cid];
        const d = this.data.detail;
        if (u && d && d.id === ex.id) this.setData({ detail: Object.assign({}, d, { clipID: u }) });
        else if (d && d.id === ex.id) this.setData({ clipReady: true });
      });
    }
    if (String(ex.id).indexOf('my') !== 0) {
      try { this.ensureClip(ex.id); } catch (e) { console.warn('[library] ensureClip', e && e.message); }
    }
  },

  // 学习态详情：AI 一句「常见错误」，只给 1-2 条，失败就不显示，不留空壳
  loadErrs(ex) {
    if (!this.errCache) this.errCache = {};
    const id = ex.id;
    if (this.errCache[id]) {
      const d0 = this.data.detail;
      if (d0 && d0.id === id) this.setData({ detail: Object.assign({}, d0, { errs: this.errCache[id], errsOn: true }) });
      return;
    }
    const d = this.data.detail;
    if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { errsOn: false }) });
    const prompt = '动作：' + (ex.n || '') + '；部位：' + (ex.p || '') + '；器械：' + (ex.e || '自重')
      + '。用中文列出这个动作最常见的 1-2 个错误，每条不超过 16 个字，只输出条目本身，每行一条，不要编号、不要解释、不要前后缀。';
    ai.ask({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.2
    }).then(r => {
      if (!r || !r.ok || !r.text) return;
      const lines = String(r.text).split('\n')
        .map(x => x.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim())
        .filter(x => x && x.length <= 40 && sanity.ok(x, { max: 40 }))
        .slice(0, 2);
      if (!lines.length) return;
      this.errCache[id] = lines;
      const cur = this.data.detail;
      if (cur && cur.id === id) this.setData({ detail: Object.assign({}, cur, { errs: lines, errsOn: true }) });
    }).catch(() => {});
  },

  // 自定义动作的图：存在云存储（cloud://）就换临时 https；本地临时图直接显示
  resolveCustPoster(id) {
    const ex = actions.customList().find(x => x && x.id === id);
    const raw = String((ex && (ex.img || ex.fileID)) || '');
    if (!raw) return;
    if (raw.indexOf('cloud://') !== 0) {
      if (this.media[id] !== raw) {
        this.media[id] = raw;
        this.repaintCard(id, raw);
      }
      return;
    }
    if (!this.custResolving) this.custResolving = {};
    if (this.custResolving[id] || !wx.cloud) return;
    this.custResolving[id] = 1;
    if (!this.custFid) this.custFid = {};
    this.custFid[id] = raw;
    cloudurl.resolve([raw], (urls) => {
      const u = (urls && urls[raw]) || '';
      this.custResolving[id] = '';
      if (!u) return;
      this.media[id] = u;
      this.repaintCard(id, u);
      const d = this.data.detail;
      if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { fileID: u }) });
    });
  },

  repaintCard(id, u) {
    const list = (this.data.list || []).map(c => (c.id === id ? Object.assign({}, c, { fileID: u }) : c));
    if (list.length) this.setData({ list });
  },

  // 详情海报兜底：进入时列表还没补到这张图（例如从训练页直接跳转），单独补一次
  fillDetailImage(id) {
    if (String(id).indexOf('my') === 0) { this.resolveCustPoster(id); return; }
    if (!wx.cloud || !this.data.cloudReady) return;
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'map', ids: [String(id)] } })
      .then(r => {
        const fid = (r && r.result && r.result.map && r.result.map[id]) || '';
        if (!fid) return;
        if (!this.fids) this.fids = {};
        this.fids[id] = fid;
        cloudurl.resolve([fid], (urls) => {
          const u = urls[fid];
          if (!u) return;
          this.media[id] = u;
          const d = this.data.detail;
          if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { fileID: u }) });
        });
      })
      .catch(() => {});
  },

  // 封面/海报：cloud:// 不能直接给 <image>，换成临时 https（只处理一次）
  resolvePoster(id, fid) {
    if (!fid || String(fid).indexOf('cloud://') !== 0 || !wx.cloud) { this.fillDetailImage(id); return; }
    if (!this.fids) this.fids = {};
    this.fids[id] = fid;
    cloudurl.resolve([fid], (urls) => {
      const u = urls[fid];
      if (!u) return;
      this.media[id] = u;
      const d = this.data.detail;
      if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { fileID: u }) });
    });
  },

  // 短片：索引命中就直接流式播放（走 CDN，不落本地、不占内存）。
  // 索引未命中：后台补产一次，成功后写入内存索引，本次不阻塞。
  ensureClip(id) {
    if (!id || typeof this.clip.has !== 'function' || this.clip.has(id)) return;
    if (!wx.cloud || !this.data.cloudReady) return;
    if (!this.clipPending) this.clipPending = {};
    if (this.clipPending[id]) return;
    this.clipPending[id] = 1;
    wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'batchgen', clip: true, ids: [String(id)], budget: 12000 } })
      .then(r => {
        const map = ((r && r.result) || {}).map || {};
        if (!map[id]) return;
        this.clip.ids[String(id).padStart(4, '0')] = 1;
        const d = this.data.detail;
        if (d && d.id === id) this.setData({ detail: Object.assign({}, d, { clipID: this.clip.url(id) }) });
      })
      .catch(() => {})
      .then(() => { delete this.clipPending[id]; });
  },

  onClipErr() {
    const d = this.data.detail;
    if (!d) return;
    // cloud:// 在部分渲染环境播不了：降级成临时 https 再试一次，仍失败才撤掉视频
    if (String(d.clipID).indexOf('cloud://') === 0 && wx.cloud && !this.clipTempTried) {
      this.clipTempTried = true;
      cloudurl.resolve([d.clipID], (urls) => {
        const u = urls[d.clipID];
        const cur = this.data.detail;
        if (u && cur && cur.id === d.id) this.setData({ detail: Object.assign({}, cur, { clipID: u }) });
        else this.setData({ detail: Object.assign({}, cur, { clipID: '' }), clipReady: true });
      });
      return;
    }
    this.clipTempTried = false;
    this.setData({ detail: Object.assign({}, d, { clipID: '' }), clipReady: true });
  },

  onClipReady() {
    if (!this.data.clipReady) this.setData({ clipReady: true });
  },

  closeDetail() {
    this.detailOpen = false;
    try {
      const ctx = wx.createVideoContext('dvideo', this);
      if (ctx) ctx.stop();
    } catch (e) {}
    this.setData({ detail: null, nameDraft: '' });
  },

  // 自定义动作：从详情直接去「我的动作库」编辑内容/要领/换图
  editCustom() {
    const d = this.data.detail;
    if (!d || !d.id) return;
    this.closeDetail();
    wx.navigateTo({ url: '/pages/mylib/index?edit=' + encodeURIComponent(d.id) });
  },

  onNameInput(e) {
    this.setData({ nameDraft: e.detail.value });
  },

  saveName() {
    const d = this.data.detail;
    if (!d) return;
    const v = (this.data.nameDraft || '').trim();
    if (!v) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
    actions.setExName(d.id, v === d.raw ? '' : v);
    this.setData({ detail: Object.assign({}, d, { n: v, alias: v !== d.raw }) });
    this.refresh();
    wx.showToast({ title: v === d.raw ? '已恢复原名' : '已改名', icon: 'none' });
  },

  resetName() {
    const d = this.data.detail;
    if (!d) return;
    actions.setExName(d.id, '');
    this.setData({ detail: Object.assign({}, d, { n: d.raw, alias: false }), nameDraft: d.raw });
    this.refresh();
  },

  // 加入今天训练：回传给打开动作库的页面（训练页 / 记录页）
  pickNow() {
    const d = this.data.detail;
    if (!d) return;
    const ex = this.byAny(d.id) || { id: d.id, n: d.n, p: d.p, e: d.e, t: d.t };
    const payload = { id: ex.id, n: d.n, p: ex.p, e: ex.e, t: ex.t, s: ex.s };
    // 只有训练态（opener 挂了 pick 回调）才走事件通道；学习态根本没有监听者，
    // getOpenerEventChannel() 照样返回带 emit 的对象，emit 出去等于石沉大海
    if (!this.data.learn) {
      const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (ch && ch.emit) { ch.emit('pick', payload); wx.navigateBack(); return; }
    }
    // 学习态没有 pick 通道（从悬浮球/任意页进来）：交给训练页 onShow 取走
    try { wx.setStorageSync('selfagent_lib_pick_v1', payload); } catch (e) {}
    wx.switchTab({ url: '/pages/train/index' });
  },

  pick(e) {
    const id = e.currentTarget.dataset.id;
    const ex = this.byAny(id);
    if (!ex) return;
    const names = actions.exNameMap();
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) ch.emit('pick', { id: ex.id, n: names[id] || ex.n, p: ex.p, e: ex.e, t: ex.t, s: ex.s });
    wx.navigateBack();
  },

  // 次级入口：一句话找动作 / 拍照识别（低频方式住在这里，不当主路径）
  openAiFind() { this.openSub('/pages/aifind/index'); },
  openScan() { this.openSub('/pages/scan/index'); },

  openSub(url) {
    wx.navigateTo({
      url,
      events: {
        pick: (ex) => {
          if (!ex) return;
          const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
          if (ch && ch.emit) ch.emit('pick', { id: ex.id, n: ex.n, p: ex.p, e: ex.e, t: ex.t, s: ex.s });
          // 子页 → 动作库 → 训练页：一次退两级
          wx.navigateBack({ delta: 2 });
        }
      }
    });
  },

  noop() {}
});
