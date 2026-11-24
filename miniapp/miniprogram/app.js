const CLOUD_ENV = 'cloud1-d2g3r78mffbe3ca36'; // 云开发环境 ID

App({
  globalData: {
    cloudReady: false,
    theme: 'light',
    syncReady: false
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
    this.cleanLegacyClipCache();
    // 登录即同步：云开发自带 openid，无需用户绑定账号
    this.autoSync(true);
  },

  onShow() {
    this.autoSync(false);
  },

  // 进前台 / 换设备后拉一次云端增量，再把本机改过的实体推上去
  autoSync(first) {
    if (!this.globalData.cloudReady) return;
    try {
      const sync = require('./libs/sync/index');
      sync.boot(first)
        .then(r => {
          this.globalData.syncReady = !!(r && r.ok);
          this.globalData.lastSync = r;
          if (!(r && r.ok)) console.warn('[sync] not ok', JSON.stringify(r || {}).slice(0, 300));
        })
        .catch(e => console.warn('[sync] auto', e));
    } catch (e) {
      console.warn('[sync] require failed', e);
    }
  },

  // 一次性清理旧版「视频落盘」缓存（vclip LRU），短片已改为纯 CDN 流式播放
  cleanLegacyClipCache() {
    try { wx.removeStorageSync('selfagent_vclip_lru_v1'); } catch (e) {}
    const dir = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/vclip';
    try {
      const fs = wx.getFileSystemManager();
      fs.readdir({
        dirPath: dir,
        success: (res) => {
          (res.files || []).forEach((name) => {
            try { fs.unlinkSync(dir + '/' + name); } catch (e) {}
          });
          try { fs.rmdirSync(dir, false); } catch (e) {}
        },
        fail: () => {}
      });
    } catch (e) {}
  }
});
