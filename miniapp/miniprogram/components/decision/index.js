// 决策卡：一个问题 + 若干个可直接执行的选项 + 可展开的数据依据
Component({
  properties: {
    title: { type: String, value: '今日简报' },
    question: { type: String, value: '' },
    reason: { type: String, value: '' },
    options: { type: Array, value: [] },
    evidence: { type: Array, value: [] },
    note: { type: String, value: '' },
    meta: { type: String, value: '' }
  },
  data: { evOpen: false, sel: -1 },
  methods: {
    pick(e) {
      const i = Number(e.currentTarget.dataset.i);
      const opt = (this.data.options || [])[i];
      if (!opt) return;
      this.setData({ sel: i });
      this.triggerEvent('pick', { key: opt.key, index: i, option: opt });
    },
    toggle() { this.setData({ evOpen: !this.data.evOpen }); }
  }
});
