const data = require('../../libs/data/index');
const store = require('../../libs/store/index');
const actions = require('../../libs/actions');

const PAGE_SIZE = 40;

Page({
  data: {
    q: '',
    part: '',
    favOnly: false,
    parts: ['', '胸', '背', '肩', '上臂', '前臂', '腰腹', '上腿', '小腿', '全身', '有氧'],
    list: [],
    total: 0,
    shown: 0,
    hasMore: false,
    noImg: 0,
    cloudReady: false
  },

  onLoad() {
    const app = getApp();
    this.media = {};
    this.all = [];
    this.setData({ cloudReady: !!(app && app.globalData && app.globalData.cloudReady), total: data.total });
    this.refresh();
  },

  refresh() {
    const q = this.data.q;
    const part = this.data.part;
    const favs = (store.getTrain() || {}).favs || [];
    let list = data.search(q, part, 100000);
    if (this.data.favOnly) list = list.filter(e => favs.indexOf(e.id) >= 0);
    this.all = list;
    const visible = list.slice(0, PAGE_SIZE).map(e => this.card(e, favs));
    this.setData({ list: visible, shown: visible.length, hasMore: list.length > visible.length, noImg: visible.filter(c => !c.fileID).length });
    this.fillImages(visible.filter(c => !c.fileID).map(c => c.id));
  },

  card(e, favs) {
    return {
      id: e.id,
      n: e.n,
      p: e.p,
      fileID: this.media[e.id] || '',
      fav: favs.indexOf(e.id) >= 0
    };
  },

  // 图卡：先查 media_map（云存储 fileID），没有就显示文字占位
  fillImages(ids) {
    if (!ids.length || !this.data.cloudReady || !wx.cloud) return;
    const db = wx.cloud.database();
    const chunk = ids.slice(0, 20);
    db.collection('media_map').where({ _id: db.command.in(chunk) }).limit(20).get()
      .then(r => {
        (r.data || []).forEach(d => { if (d && d.fileID) this.media[d._id] = d.fileID; });
        if (Object.keys(this.media).length) {
          const favs = (store.getTrain() || {}).favs || [];
          const visible = this.all.slice(0, this.data.shown).map(e => this.card(e, favs));
          this.setData({ list: visible, noImg: visible.filter(c => !c.fileID).length });
        }
        const rest = ids.slice(20);
        if (rest.length) this.fillImages(rest);
      })
      .catch(err => console.warn('[library] media_map', err));
  },

  onInput(e) {
    this.setData({ q: e.detail.value });
    this.refresh();
  },

  onPart(e) {
    this.setData({ part: e.currentTarget.dataset.p });
    this.refresh();
  },

  toggleFavView() {
    this.setData({ favOnly: !this.data.favOnly });
    this.refresh();
  },

  more() {
    const start = this.data.shown;
    const next = this.all.slice(start, start + PAGE_SIZE);
    if (!next.length) return;
    const favs = (store.getTrain() || {}).favs || [];
    const merged = this.data.list.concat(next.map(e => this.card(e, favs)));
    this.setData({ list: merged, shown: merged.length, hasMore: this.all.length > merged.length, noImg: merged.filter(c => !c.fileID).length });
    this.fillImages(next.filter(e => !this.media[e.id]).map(e => e.id));
  },

  star(e) {
    const id = e.currentTarget.dataset.id;
    const on = actions.toggleFav(id);
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
    const favs = (store.getTrain() || {}).favs || [];
    const list = this.data.list.map(c => (c.id === id ? Object.assign({}, c, { fav: on }) : c));
    this.setData({ list });
    if (this.data.favOnly && !on) this.refresh();
  },

  pick(e) {
    const id = e.currentTarget.dataset.id;
    const ex = data.byId(id);
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) ch.emit('pick', ex);
    wx.navigateBack();
  }
});
