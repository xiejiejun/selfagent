const store = require('../../libs/store/index');

Page({
  data: {
    title: '我的',
    sub: '设置 / 数据 / 同步',
    todo: '存储键迁移、云开发同步开关、订阅消息模板',
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
