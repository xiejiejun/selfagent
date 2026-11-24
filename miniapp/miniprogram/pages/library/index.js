const data = require('../../libs/data/index');
const store = require('../../libs/store/index');
const actions = require('../../libs/actions');
const cloudurl = require('../../libs/cloudurl');
const CLIP_INDEX = require('../../libs/clip-index.js');

const PAGE_SIZE = 40;

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
    nameDraft: ''
  },

  onLoad(opts) {
    const app = getApp();
    this.media = {};
    // 短片索引：发布期流水线生成的静态 JSON + 本机缓存兜底（运行时不查云端）
    this.clip = (CLIP_INDEX && CLIP_INDEX.ids) ? CLIP_INDEX : { ids: {}, url: () => '', has: () => false };
    this.all = [];
    this.migRound = 0;
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady), total: data.total });
    // 从训练页空态「先记一条有氧」进来：预选部位
    const part = (opts && opts.part) ? decodeURIComponent(opts.part) : '';
    if (part && data.PARTS.indexOf(part) >= 0) this.setData({ part });
    this.refresh();
    // 从训练页「详情」进来：带 id 就直接展开该动作的详情
    const want = (opts && opts.id) ? decodeURIComponent(opts.id) : '';
    if (want) setTimeout(() => this.openDetail({ currentTarget: { dataset: { id: want } } }), 80);
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
      noImg: visible.filter(c => !c.fileID).length
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
      mine: !!e.mine || String(e.id || '').indexOf('my') === 0
    };
  },

  // 图卡：先查 media_map（经云函数读，避开集合读权限），再换临时 https 链接（渲染层不认 cloud://）
  // 有缺失时顺手补产一次（batchgen），让首屏 40 张尽快出图，而不是干等后台游标
  fillImages(ids) {
    if (!ids.length || !this.data.cloudReady || !wx.cloud) return;
    const chunk = ids.slice(0, 20);
    this.mapIds(chunk).then(missing => {
      const rest = ids.slice(20);
      if (rest.length) this.fillImages(rest);
      if (missing.length && !this.imgFillBusy) {
        this.imgFillBusy = true;
        wx.cloud.callFunction({ name: 'gifMigrate', data: { action: 'batchgen', ids: missing.slice(0, 20), budget: 12000 } })
          .then(r => {
            const map = ((r && r.result) || {}).map || {};
            if (Object.keys(map).length) this.applyMap(map);
            this.imgFillBusy = false;
            if (!rest.length) this.migrateMissing();
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
    this.setData({ q: e.detail.value });
    this.refresh();
  },

  onPart(e) {
    this.setData({ part: e.currentTarget.dataset.p });
    this.refresh();
  },

  onEquip(e) {
    this.setData({ equip: e.currentTarget.dataset.e });
    this.refresh();
  },

  toggleFavView() {
    this.setData({ favOnly: !this.data.favOnly });
    this.refresh();
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
    if (isCloud) this.resolvePoster(ex.id, poster); else this.resolvePoster(ex.id, '');
    if (isCloudClip) {
      cloudurl.resolve([cid], (urls) => {
        const u = urls[cid];
        const d = this.data.detail;
        if (u && d && d.id === ex.id) this.setData({ detail: Object.assign({}, d, { clipID: u }) });
        else if (d && d.id === ex.id) this.setData({ clipReady: true });
      });
    }
    try { this.ensureClip(ex.id); } catch (e) { console.warn('[library] ensureClip', e && e.message); }
  },

  // 详情海报兜底：进入时列表还没补到这张图（例如从训练页直接跳转），单独补一次
  fillDetailImage(id) {
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
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) ch.emit('pick', payload);
    wx.navigateBack();
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
