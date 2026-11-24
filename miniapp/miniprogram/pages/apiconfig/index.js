const ai = require('../../libs/ai');

Page({
  data: {
    baseUrl: '',
    apiKey: '',
    model: '',
    usingCustom: false,
    testing: false,
    testResult: '',
    anon: true,
    usage: '',
    preview: '',
    showPreview: false
  },

  onLoad() {
    this.refresh();
  },

  refresh() {
    const c = ai.cfg();
    this.setData({
      baseUrl: c.baseUrl || '',
      apiKey: c.apiKey || '',
      model: c.model || '',
      usingCustom: !!(c.baseUrl && c.apiKey),
      anon: c.anon !== false,
      usage: ai.usageText(),
      preview: ai.lastRequest(),
      testResult: ''
    });
  },

  onF(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  save() {
    const baseUrl = (this.data.baseUrl || '').trim();
    const apiKey = (this.data.apiKey || '').trim();
    const model = (this.data.model || '').trim();
    if ((baseUrl || apiKey) && (!baseUrl || !apiKey)) {
      wx.showToast({ title: 'baseUrl 和 Key 需一起填', icon: 'none' });
      return;
    }
    ai.saveCfg(baseUrl && apiKey ? { baseUrl, apiKey, model } : {});
    wx.showToast({ title: this.data.baseUrl ? '已用自定义 Agent' : '已切回云函数代理', icon: 'none' });
    this.refresh();
  },

  clear() {
    ai.saveCfg({});
    wx.showToast({ title: '已清空，回退云函数代理', icon: 'none' });
    this.refresh();
  },

  toggleAnon(e) {
    const v = !!e.detail.value;
    ai.saveCfg({ anon: v });
    this.setData({ anon: v });
  },

  togglePreview() {
    this.setData({ showPreview: !this.data.showPreview });
    if (!this.data.preview) wx.showToast({ title: '还没有发送记录', icon: 'none' });
  },

  test() {
    this.setData({ testing: true, testResult: '' });
    ai.ask({
      messages: [{ role: 'user', content: '用一句话回复「连接正常」' }],
      max_tokens: 40,
      temperature: 0.2
    }).then(r => {
      this.setData({ testing: false, testResult: r.ok ? '连接正常：' + (r.text || '').slice(0, 60) : '失败：' + (r.error || '未知') });
    });
  },

  // 识图连通测试：1×1 红色 PNG，能答「红色」说明模型与图片块都通了
  testVision() {
    if (!this.data.usingCustom) {
      wx.showToast({ title: '先保存自定义 API 再测识图', icon: 'none' });
      return;
    }
    this.setData({ testing: true, testResult: '' });
    const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    ai.ask({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这张图是什么颜色？只回复颜色词' },
          { type: 'image_url', image_url: { url: red } }
        ]
      }],
      max_tokens: 30,
      temperature: 0.1
    }).then(r => {
      this.setData({
        testing: false,
        testResult: r.ok ? '识图正常（模型回复「' + String(r.text || '').trim().slice(0, 20) + '」）' : '识图失败：' + (r.error || '未知')
      });
    });
  }
});
