Page({
  data: { ok: true, flash: 'off', src: 'food', tip: '', fbT: '', hasText: true },

  onLoad(q) {
    const src = q && q.src === 'equip' ? 'equip' : 'food';
    this.src = src;
    // 模拟器/无摄像头设备：camera 会报错，直接降级成相册 + 打字
    this.setData({
      src,
      ok: !!wx.createCameraContext,
      tip: src === 'equip' ? '对准器械或训练场地，AI 帮你找动作' : '对准整盘，AI 自动识别',
      fbT: src === 'equip' ? '用相册选一张，或直接打字找动作' : '用相册选一张，或直接打字记',
      hasText: src === 'food'
    });
  },

  onErr() {
    this.setData({ ok: false });
    wx.showToast({ title: '相机不可用，用相册或打字', icon: 'none' });
  },

  close() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/log/index' }) });
  },

  shot() {
    try {
      const ctx = wx.createCameraContext();
      ctx.takePhoto({
        quality: 'high',
        success: (r) => this.go(r.tempImagePath),
        fail: () => wx.showToast({ title: '没拍成，再试一次', icon: 'none' })
      });
    } catch (e) {
      wx.showToast({ title: '相机不可用，用相册', icon: 'none' });
    }
  },

  album() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (f) this.go(f.tempFilePath);
      }
    });
  },

  // 拍完按来源路由：食物 → 热量识别；器械/场地 → 动作库的以图搜动作
  go(path) {
    if (this.src === 'equip') {
      wx.navigateTo({ url: '/pages/library/index?img=' + encodeURIComponent(path) + '&vision=1' });
      return;
    }
    wx.navigateTo({ url: '/pages/meal/index?src=' + encodeURIComponent(path) + '&auto=1' });
  },

  toText() {
    if (this.src === 'equip') { this.close(); return; }
    wx.navigateTo({ url: '/pages/meal/index?mode=text' });
  }
});
