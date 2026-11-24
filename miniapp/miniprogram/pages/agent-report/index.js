const store = require('../../libs/store/index');
const engine = require('../../libs/engine/index');
const agent = require('../../libs/agent');

Page({
  data: {
    seg: 'persona',
    report: null,
    hasLogs: false
  },

  onLoad() {
    const train = engine.ensureTrain(store.getTrain());
    const logs = store.getLogs() || [];
    const report = agent.buildReport(logs, train);
    this.setData({ report, hasLogs: report.count > 0 });
  },

  switchSeg(e) {
    this.setData({ seg: e.currentTarget.dataset.t });
  }
});
