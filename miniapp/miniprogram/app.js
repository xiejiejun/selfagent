const CLOUD_ENV = 'cloud1-d2g3r78mffbe3ca36'; // 云开发环境 ID

App({
  globalData: {
    cloudReady: false,
    theme: 'light'
  },

  onLaunch() {
    if (wx.cloud && CLOUD_ENV) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
      } catch (e) {
        console.warn('[cloud] init failed', e);
      }
    }
    this.globalData.theme = wx.getStorageSync('selfagent_theme_v1') || 'light';
  }
});
