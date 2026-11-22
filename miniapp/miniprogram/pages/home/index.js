const store = require('../../libs/store/index');

Page({
  data: {
    title: '今天',
    sub: '每日概览：KPIs、训练环、悬浮球',
    todo: '首页大圆按钮（orb）与 KPI 条（kpi-strip）在这里接入',
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
