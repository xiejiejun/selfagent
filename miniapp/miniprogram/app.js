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
    this.touchSub();
  },

  // 订阅消息心跳：把「最近训练日 + 当前连续天数」同步给云端，
  // 云端才知道今晚该不该发断签召回（本地数据不完全在云端，只能客户端上报）
  touchSub() {
    if (!this.globalData.cloudReady) return;
    let sub = null;
    try { sub = (wx.getStorageSync('selfagent_settings_v1') || {}).sub; } catch (e) {}
    if (!sub || !sub.enabled || !sub.tmplId) return;
    const now = Date.now();
    let last = 0;
    try { last = Number(wx.getStorageSync('selfagent_sub_touch_v1') || 0); } catch (e) {}
    if (now - last < 30 * 60 * 1000) return;   // 半小时内不重复上报
    let info = { streak: 0, lastDay: '' };
    try {
      const engine = require('./libs/engine/index');
      const store = require('./libs/store/index');
      const train = engine.ensureTrain(store.getTrain());
      info.streak = engine.streakDays(train);
      info.lastDay = (engine.lastNDays(train, 30) || []).filter(d => d && d.done > 0)[0];
      info.lastDay = info.lastDay ? info.lastDay.date : '';
    } catch (e) {}
    const p = wx.cloud.callFunction({
      name: 'notify',
      data: { action: 'touch', streak: info.streak, lastDay: info.lastDay, time: sub.remind || '20:00' }
    });
    if (p && p.then) {
      // 成功与否都记时间戳：失败也别每次进前台重刷，30 分钟后再试
      p.then(() => { try { wx.setStorageSync('selfagent_sub_touch_v1', now); } catch (e) {} })
        .catch(err => {
          try { wx.setStorageSync('selfagent_sub_touch_v1', now); } catch (e) {}
          console.warn('[notify] touch 上报失败', err && (err.errMsg || err.message));
        });
    }
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
