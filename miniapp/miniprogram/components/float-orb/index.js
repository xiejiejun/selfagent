const actions = require('../../libs/actions');
const engine = require('../../libs/engine/index');
const store = require('../../libs/store/index');
const mdimport = require('../../libs/mdimport');

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
    mvX: 0,
    mvY: 0,
    sizeRpx: SIZE_RPX,
    menuOn: false,
    pressing: false,
    noteOn: false,
    noteText: '',
    notePrev: '',
    sheetDy: 0,
    noteEnergy: 0,
    noteMood: 0,
    energyLabels: ['很低', '偏低', '一般', '不错', '充沛'],
    moodLabels: ['很糟', '低落', '一般', '不错', '很好'],
    countText: ''
  },

  lifetimes: {
    attached() {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this._win = { w: sys.windowWidth, h: sys.windowHeight };
      this._px = this._win.w / 750;
      this.readCfg();
      this.place();
      this.refreshCount();
    }
  },

  pageLifetimes: {
    show() {
      // 切回页面时重新读全局位置：其他页面拖动后，本页实例不能保留旧坐标
      this.readCfg();
      this.place();
      this.refreshCount();
    }
  },

  methods: {
    noop() {},

    readCfg() {
      let cfg = {};
      try { cfg = wx.getStorageSync(CFG_KEY) || {}; } catch (e) { cfg = {}; }
      this._cfg = {
        mode: cfg.mode === 'focus' ? 'focus' : 'record',
        side: cfg.side === 'left' ? 'left' : 'right',
        bottom: typeof cfg.bottom === 'number' ? cfg.bottom : this.data.bottom,
        leftRpx: typeof cfg.leftRpx === 'number' ? cfg.leftRpx : null,
        topRpx: typeof cfg.topRpx === 'number' ? cfg.topRpx : null
      };
      this.setData({ mode: this._cfg.mode });
    },

    sizePx() { return SIZE_RPX * this._px; },

    place() {
      const size = this.sizePx();
      const margin = MARGIN_RPX * this._px;
      const w = this._win.w;
      const h = this._win.h;
      let left = this._cfg.leftRpx != null ? this._cfg.leftRpx * this._px
        : (this._cfg.side === 'left' ? margin : w - size - margin);
      left = Math.max(0, Math.min(w - size, left));
      let top = this._cfg.topRpx != null ? this._cfg.topRpx * this._px
        : h - size - this._cfg.bottom * this._px;
      top = Math.max(SAFE_TOP, Math.min(h - size - 12, top));
      this.setData({ left: Math.round(left), top: Math.round(top), mvX: Math.round(left), mvY: Math.round(top) });
    },

    onMvChange(e) {
      // movable-view 拖动回调：同步位置并持久化（源头拖动 + 初始定位不会触发，仅拖动触发）
      if (e.detail.source === 'touch') {
        this.setData({ left: e.detail.x, top: e.detail.y });
        this.persist();
      }
    },

    persist() {
      const size = this.sizePx();
      const cfg = {
        mode: this._cfg.mode,
        side: this.data.left + size / 2 < this._win.w / 2 ? 'left' : 'right',
        bottom: Math.round((this._win.h - this.data.top - size) / this._px),
        leftRpx: Math.round(this.data.left / this._px),
        topRpx: Math.round(this.data.top / this._px)
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

    openNote() {
      this.setData({ noteOn: true, noteText: '', notePrev: '', sheetDy: 0, noteEnergy: 0, noteMood: 0, menuOn: false });
    },

    onTap() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      if (this._lastMoved) return;
      if (this.data.menuOn) { this.setData({ menuOn: false }); return; }
      if (this.data.mode === 'focus') { this.triggerEvent('focus'); return; }
      this.openNote();
    },

    pickRecord() {
      this._suppressTap = false;
      this._cfg.mode = 'record';
      this.setData({ mode: 'record', menuOn: false, countText: '' });
      this.persist();
      wx.showToast({ title: '已切到随手记', icon: 'none' });
    },

    pickFocus() {
      this._suppressTap = false;
      this._cfg.mode = 'focus';
      this.setData({ mode: 'focus', menuOn: false });
      this.persist();
      this.refreshCount();
      wx.showToast({ title: '已切到专注模式', icon: 'none' });
    },

    onNoteInput(e) {
      const v = e.detail.value;
      this.setData({ noteText: v, notePrev: '' });
      if (this._prevTimer) clearTimeout(this._prevTimer);
      this._prevTimer = setTimeout(() => {
        this.setData({ notePrev: this.recognize(v) });
      }, 500);
    },

    // 保存前的识别预览：规则解析，不调 AI
    recognize(raw) {
      const t = String(raw || '').trim();
      if (!t) return '';
      const p = mdimport.parseStrength(t);
      if (p) {
        const wm = t.match(/(\d+(?:\.\d+)?)\s*(kg|千克|磅|lb)/i);
        const w = wm ? Number(wm[1]) : (p.weight || 0);
        return '训练 · ' + p.name + ' · ' + (w ? w + 'kg · ' : '自重 · ') + p.sets + ' 组 × ' + p.reps + ' 次';
      }
      const cm = t.match(/(跑步|跑|走路|走|骑行|骑|椭圆机|跳绳|游泳|划船)?[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(km|公里|min|分钟|′|小时|h)/i);
      if (cm) {
        const kind = cm[1] ? cm[1].replace(/跑$/,'跑步').replace(/走$/,'走路').replace(/骑$/,'骑行') : '有氧';
        return '有氧 · ' + kind + ' · ' + cm[2] + cm[3];
      }
      return '记录 · 附精力/情绪';
    },

    // 下拉手势关闭
    onSheetStart(e) {
      const t = (e.touches && e.touches[0]) || null;
      this._sy = t ? t.clientY : 0;
      this._sdy = 0;
    },

    onSheetMove(e) {
      const t = (e.touches && e.touches[0]) || null;
      if (!t || !this._sy) return;
      const dy = Math.max(0, t.clientY - this._sy);
      if (dy > 6) this.setData({ sheetDy: dy });
      this._sdy = dy;
    },

    onSheetEnd() {
      const dy = this._sdy || 0;
      this._sdy = 0;
      this._sy = 0;
      if (dy > 70) { this.closeNote(); return; }
      this.setData({ sheetDy: 0 });
    },

    closeNote() {
      if (this._prevTimer) { clearTimeout(this._prevTimer); this._prevTimer = null; }
      this.setData({ noteOn: false, noteText: '', notePrev: '', sheetDy: 0, noteEnergy: 0, noteMood: 0 });
    },

    pickScore(e) {
      const k = e.currentTarget.dataset.k;
      const v = Number(e.detail ? e.detail.value : e.currentTarget.dataset.v);
      this.setData({ [k]: v });
    },

    onSlide(e) {
      const k = e.currentTarget.dataset.k;
      this.setData({ [k]: Number(e.detail.value) });
    },

    saveNote() {
      const txt = (this.data.noteText || '').trim();
      if (!txt) { wx.showToast({ title: '先写点什么', icon: 'none' }); return; }
      const score = this.data.noteEnergy || null;
      const mood = this.data.noteMood || null;
      actions.addNote(txt, { score, mood });
      this.setData({ noteOn: false, noteText: '', notePrev: '', sheetDy: 0, noteEnergy: 0, noteMood: 0 });
      wx.showToast({ title: '已记录', icon: 'none' });
      this.triggerEvent('noted', { text: txt });
    }
  }
});
