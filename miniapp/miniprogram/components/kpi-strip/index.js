// 仪表条：数字为主角（细体 + tabular-nums），支持环比箭头与 200ms count-up
Component({
  properties: {
    // [{ v: '数值', l: '标签', n: '可选结论句', d: '↑2', tone: 'up|down|flat' }]
    items: { type: Array, value: [], observer: 'onItems' },
    size: { type: String, value: 'md' } // md | lg（≤4 格时用 lg，数字更大）
  },

  data: { shown: [] },

  lifetimes: {
    attached() { this.animate(this.data.items); }
  },

  methods: {
    onItems(items) { this.animate(items || []); },

    // 数字宽度自适应：位数越多字号越小，避免 5 位以上的数值把格子撑破、被屏幕切掉
    baseFont(n) { return n > 5 ? 40 : (this.data.size === 'lg' ? 56 : 46); },

    fsOf(v, base) {
      const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
      const len = s.replace(/[^\d]/g, '').length || s.length;
      let k = 1;
      if (len >= 7) k = .5;
      else if (len === 6) k = .58;
      else if (len === 5) k = .7;
      else if (len === 4) k = .84;
      return Math.round(base * k);
    },

    parseNum(v) {
      if (typeof v === 'number') return v;
      const s = String(v == null ? '' : v).replace(/[^\d.\-]/g, '');
      if (!s || s === '-' || s === '.') return null;
      const n = Number(s);
      return isFinite(n) ? n : null;
    },

    fmt(n, tpl) {
      const num = Math.abs(n) >= 10000 ? Math.round(n).toLocaleString() : Math.round(n * 10) / 10;
      const suffix = String(tpl == null ? '' : tpl).replace(/[\d.\-\s,]/g, '');
      return String(num) + suffix;
    },

    animate(items) {
      clearTimeout(this._tm);
      const base = this.baseFont(items.length);
      const from = (this.data.shown || []).map((x) => (x && x.num != null ? x.num : 0));
      const targets = items.map((it) => this.parseNum(it && it.v));
      const t0 = Date.now();
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / 200);
        const e = 1 - Math.pow(1 - k, 3);
        const shown = items.map((it, i) => {
          const t = targets[i];
          if (t == null) return { v: it.v, l: it.l, n: it.n || '', d: it.d || '', tone: it.tone || '', num: null, fs: this.fsOf(it.v, base) };
          const cur = from[i] + (t - from[i]) * e;
          const txt = this.fmt(cur, it.v);
          return { v: txt, l: it.l, n: it.n || '', d: it.d || '', tone: it.tone || '', num: Math.round(cur * 10) / 10, fs: this.fsOf(txt, base) };
        });
        this.setData({ shown });
        if (k < 1) this._tm = setTimeout(step, 16);
        else {
          const fin = items.map((it, i) => ({ v: it.v, l: it.l, n: it.n || '', d: it.d || '', tone: it.tone || '', num: targets[i], fs: this.fsOf(it.v, base) }));
          this.setData({ shown: fin });
        }
      };
      step();
    }
  }
});
