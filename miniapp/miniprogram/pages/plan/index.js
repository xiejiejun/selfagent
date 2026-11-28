// 训练计划页只做壳：业务逻辑全在 components/train-plan，整页与训练页 📅 弹层共用一份
const engine = require('../../libs/engine/index');

Page({
  data: { today: '', part: '' },

  onLoad(q) {
    this.setData({
      today: engine.dayKey(),
      part: (q && q.part) || ''
    });
  },

  onShow() { this.setData({ today: engine.dayKey() }); },

  // 组件里「加入今日训练」后可继续留在计划页；页面无需额外处理
  onChanged() {}
});
