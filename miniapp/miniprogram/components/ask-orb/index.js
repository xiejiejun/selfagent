// 问 AI 泡：单一功能（点开半屏问 AI 面板），长按归位。
// 与 float-orb（记/练两挡）互不干扰：位置独立存储，不读挡位与打卡状态。
const CFG_KEY = 'selfagent_askorb_v1';
const SIZE_RPX = 96;       // 容器直径，rpx
const MARGIN_RPX = 20;     // 贴边留白，rpx
const SAFE_TOP = 96;       // 顶部安全距离，px

Component({
  properties: {
    bottom: { type: Number, value: 190 },  // 距屏幕底部，rpx（页面按底栏高度给）
    unread: { type: Boolean, value: false }
  },

  data: {
    left: 0,
    top: 0,
    mvX: 0,
    mvY: 0,
    sizeRpx: SIZE_RPX,
    pressing: false
  },

  lifetimes: {
    attached() {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this._win = { w: sys.windowWidth, h: sys.windowHeight };
      this._px = this._win.w / 750;
      this.readCfg();
      this.place();
    }
  },

  pageLifetimes: {
    show() { this.readCfg(); this.place(); }
  },

  methods: {
    readCfg() {
      let cfg = {};
      try { cfg = wx.getStorageSync(CFG_KEY) || {}; } catch (e) { cfg = {}; }
      this._cfg = {
        bottom: typeof cfg.bottom === 'number' ? cfg.bottom : this.data.bottom,
        leftRpx: typeof cfg.leftRpx === 'number' ? cfg.leftRpx : null,
        topRpx: typeof cfg.topRpx === 'number' ? cfg.topRpx : null
      };
    },

    sizePx() { return SIZE_RPX * this._px; },

    place() {
      const size = this.sizePx();
      const margin = MARGIN_RPX * this._px;
      const w = this._win.w;
      const h = this._win.h;
      let left = this._cfg.leftRpx != null ? this._cfg.leftRpx * this._px : w - size - margin;
      left = Math.max(0, Math.min(w - size, left));
      let top = this._cfg.topRpx != null ? this._cfg.topRpx * this._px : h - size - this._cfg.bottom * this._px;
      top = Math.max(SAFE_TOP, Math.min(h - size - 12, top));
      this.setData({ left: Math.round(left), top: Math.round(top), mvX: Math.round(left), mvY: Math.round(top) });
    },

    onMvChange(e) {
      if (e.detail.source === 'touch') {
        this.setData({ left: e.detail.x, top: e.detail.y });
        this.persist();
      }
    },

    persist() {
      const size = this.sizePx();
      const cfg = {
        bottom: Math.round((this._win.h - this.data.top - size) / this._px),
        leftRpx: Math.round(this.data.left / this._px),
        topRpx: Math.round(this.data.top / this._px)
      };
      this._cfg = Object.assign({}, this._cfg, cfg);
      try { wx.setStorageSync(CFG_KEY, cfg); } catch (e) {}
    },

    onStart(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      this._drag = { x: t.clientX, y: t.clientY, left: this.data.left, top: this.data.top, moved: false };
      this._suppressTap = false;
      this.setData({ pressing: true });
    },

    onMove(e) {
      if (!this._drag) return;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const dx = t.clientX - this._drag.x;
      const dy = t.clientY - this._drag.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this._drag.moved = true;
      if (!this._drag.moved) return;
      const size = this.sizePx();
      const left = Math.max(0, Math.min(this._win.w - size, this._drag.left + dx));
      const top = Math.max(SAFE_TOP, Math.min(this._win.h - size - 12, this._drag.top + dy));
      this.setData({ left: Math.round(left), top: Math.round(top) });
    },

    onEnd() {
      const moved = !!(this._drag && this._drag.moved);
      this._lastMoved = moved;
      this.setData({ pressing: false });
      if (moved) this.persist();
      this._drag = null;
      if (moved) setTimeout(() => { this._lastMoved = false; }, 260);
    },

    // 长按 = 归位：拖丢了找不回的兜底
    onLong() {
      this._suppressTap = true;
      wx.vibrateShort({ type: 'medium' });
      try { wx.removeStorageSync(CFG_KEY); } catch (e) {}
      this._cfg = { bottom: this.data.bottom, leftRpx: null, topRpx: null };
      this.place();
      wx.showToast({ title: '已归位到右下角', icon: 'none' });
      setTimeout(() => { this._suppressTap = false; }, 600);
    },

    onTap() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      if (this._lastMoved) return;
      this.triggerEvent('open');
    }
  }
});
