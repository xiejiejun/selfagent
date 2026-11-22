const store = require('../../libs/store/index');

Page({
  data: {
    title: '训练',
    sub: '今日训练 + 专注模式',
    todo: '动作库网格、组行编辑、三环计时（ring-set）、专注分幕（focus-view）',
    count: 0
  },

  onLoad() {
    this.refresh();
  },

  refresh() {
    const logs = store.getLogs() || [];
    this.setData({ count: Array.isArray(logs) ? logs.length : 0 });
  }
});
