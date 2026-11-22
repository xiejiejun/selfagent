const store = require('../../libs/store/index');

Page({
  data: {
    title: '记录',
    sub: '快记 + 时间线',
    todo: '时间线卡片与动作项增删改查在本页落地',
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
