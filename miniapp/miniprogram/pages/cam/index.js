Page({
  data: { ok: true, flash: 'off' },

  onLoad() {
    // 模拟器/无摄像头设备：camera 会报错，直接降级成相册 + 打字
    if (!wx.createCameraContext) this.setData({ ok: false });
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

  go(path) {
    wx.navigateTo({ url: '/pages/meal/index?src=' + encodeURIComponent(path) + '&auto=1' });
  },

  toText() {
    wx.navigateTo({ url: '/pages/meal/index?mode=text' });
  }
});
