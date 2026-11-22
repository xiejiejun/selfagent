const store = require('../../libs/store/index');

Page({
  data: {
    title: '分析',
    sub: '画像 / 问答 / 计划',
    todo: 'AI 走云函数 aiProxy，图表用 echarts-for-weixin',
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
