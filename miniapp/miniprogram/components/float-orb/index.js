const actions = require('../../libs/actions');
const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');

const CFG_KEY = 'selfagent_orb_v1';
const SIZE_RPX = 104;      // 容器直径，rpx
const MARGIN_RPX = 20;     // 贴边留白，rpx
const SAFE_TOP = 96;       // 顶部安全距离，px

Component({
  properties: {
    bottom: { type: Number, value: 190 }   // 距屏幕底部，rpx（页面自己按底栏高度给）
  },

  data: {
    mode: 'record',
    left: 0,
    top: 0,
    sizeRpx: SIZE_RPX,
    menuOn: false,
    pressing: false,
    noteOn: false,
    noteText: '',
    countText: ''
  },

  lifetimes: {
    attached() {
      let cfg = {};
      try { cfg = wx.getStorageSync(CFG_KEY) || {}; } catch (e) { cfg = {}; }
      this._cfg = {
        mode: cfg.mode === 'focus' ? 'focus' : 'record',
        side: cfg.side === 'left' ? 'left' : 'right',
        bottom: typeof cfg.bottom === 'number' ? cfg.bottom : this.data.bottom
      };
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this._win = { w: sys.windowWidth, h: sys.windowHeight };
      this._px = this._win.w / 750;
      this.setData({ mode: this._cfg.mode });
      this.place();
      this.refreshCount();
    }
  },

  pageLifetimes: {
    show() { this.refreshCount(); }
  },

  methods: {
    noop() {},

    sizePx() { return SIZE_RPX * this._px; },

    place() {
      const size = this.sizePx();
      const margin = MARGIN_RPX * this._px;
      const bottom = this._cfg.bottom * this._px;
      const w = this._win.w;
      const h = this._win.h;
      let left = this._cfg.side === 'left' ? margin : w - size - margin;
      left = Math.max(0, Math.min(w - size, left));
      let top = h - size - bottom;
      top = Math.max(SAFE_TOP, Math.min(h - size - 12, top));
      this.setData({ left: Math.round(left), top: Math.round(top) });
    },

    persist() {
      const size = this.sizePx();
      const cfg = {
        mode: this._cfg.mode,
        side: this.data.left + size / 2 < this._win.w / 2 ? 'left' : 'right',
        bottom: Math.round((this._win.h - this.data.top - size) / this._px)
      };
      this._cfg = Object.assign({}, this._cfg, cfg);
      try { wx.setStorageSync(CFG_KEY, cfg); } catch (e) {}
    },

    // 专注模式下显示今天完成组数
    refreshCount() {
      if (this.data.mode !== 'focus') { this.setData({ countText: '' }); return; }
      try {
        const train = engine.ensureTrain(store.getTrain());
        const s = engine.dayStat(train, engine.dayKey());
        const txt = s.total ? s.done + '/' + s.total : '';
        if (txt !== this.data.countText) this.setData({ countText: txt });
      } catch (e) {}
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
      this.setData({ left: Math.round(left), top: Math.round(top), menuOn: false });
    },

    onEnd() {
      const moved = !!(this._drag && this._drag.moved);
      this._lastMoved = moved;
      this.setData({ pressing: false });
      if (moved) this.persist();
      this._drag = null;
      if (moved) setTimeout(() => { this._lastMoved = false; }, 260);
    },

    onLong() {
      this._suppressTap = true;
      wx.vibrateShort({ type: 'medium' });
      this.setData({ menuOn: !this.data.menuOn });
    },

    onTap() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      if (this._lastMoved) return;
      if (this.data.menuOn) { this.setData({ menuOn: false }); return; }
      if (this.data.mode === 'focus') { this.triggerEvent('focus'); return; }
      this.setData({ noteOn: true, noteText: '' });
    },

    pickRecord() {
      this._cfg.mode = 'record';
      this.setData({ mode: 'record', menuOn: false, countText: '' });
      this.persist();
      wx.showToast({ title: '已切到随手记', icon: 'none' });
    },

    pickFocus() {
      this._cfg.mode = 'focus';
      this.setData({ mode: 'focus', menuOn: false });
      this.persist();
      this.refreshCount();
      wx.showToast({ title: '已切到专注模式', icon: 'none' });
    },

    onNoteInput(e) {
      this.setData({ noteText: e.detail.value });
    },

    closeNote() {
      this.setData({ noteOn: false, noteText: '' });
    },

    saveNote() {
      const txt = (this.data.noteText || '').trim();
      if (!txt) { wx.showToast({ title: '先写点什么', icon: 'none' }); return; }
      actions.addNote(txt);
      this.setData({ noteOn: false, noteText: '' });
      wx.showToast({ title: '已记录', icon: 'none' });
      this.triggerEvent('noted', { text: txt });
    }
  }
});
