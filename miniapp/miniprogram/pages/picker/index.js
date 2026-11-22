const data = require('../../libs/data/index');

Page({
  data: {
    q: '',
    part: '',
    parts: ['', '胸', '背', '肩', '上臂', '前臂', '腰腹', '上腿', '小腿', '全身', '有氧'],
    list: [],
    total: 0
  },

  onLoad() {
    this.setData({ total: data.total });
    this.refresh('');
  },

  onInput(e) {
    const q = e.detail.value;
    this.setData({ q });
    this.refresh(q, this.data.part);
  },

  onPart(e) {
    const part = e.currentTarget.dataset.p;
    this.setData({ part });
    this.refresh(this.data.q, part);
  },

  refresh(q, part) {
    const list = data.search(q, part, 60);
    this.setData({ list });
  },

  pick(e) {
    const id = e.currentTarget.dataset.id;
    const ex = data.byId(id);
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) ch.emit('pick', ex);
    wx.navigateBack();
  }
});
