// 轻量图表：柱状（7 天容量）/ 双折线（精力·情绪），canvas 2d 自绘，不依赖 ECharts
Component({
  properties: {
    type: { type: String, value: 'bar' },     // bar | line
    labels: { type: Array, value: [] },
    values: { type: Array, value: [] },        // bar 用
    series: { type: Array, value: [] },        // line 用：[{ data: [], color }]
    height: { type: Number, value: 150 },
    todayIndex: { type: Number, value: -1 },
    play: { type: Boolean, value: true }       // 首次生长动画
  },

  data: { tip: '' },

  observers: {
    'values, labels, series, type, height, todayIndex': function () { this.paint(); }
  },

  lifetimes: {
    attached() { this.playDone = false; this.paint(); },
    ready() { this.paint(); }
  },

  methods: {
    paint() {
      if (this._raf) { clearTimeout(this._raf); this._raf = null; }
      const q = this.createSelectorQuery();
      q.select('.cv').fields({ node: true, size: true }).exec((res) => {
        const r = res && res[0];
        if (!r || !r.node) return;
        const W = r.width || r.w;
        const H = this.data.height;
        if (!W || !H) return;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        r.node.width = Math.round(W * dpr);
        r.node.height = Math.round(H * dpr);
        const ctx = r.node.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.node = r.node;
        this.ctx = ctx;
        this.W = W;
        this.H = H;

        if (!this.data.play || this.playDone) { this.draw(1); this.playDone = true; return; }
        const t0 = Date.now();
        const step = () => {
          const k = Math.min(1, (Date.now() - t0) / 320);
          this.draw(k);
          if (k < 1) this._raf = setTimeout(step, 16);
          else this.playDone = true;
        };
        step();
      });
    },

    draw(p) {
      const ctx = this.ctx; if (!ctx) return;
      const W = this.W, H = this.H;
      ctx.clearRect(0, 0, W, H);
      if (this.data.type === 'bar') this.drawBar(ctx, W, H, p);
      else this.drawLine(ctx, W, H, p);
    },

    // ---- 柱状 ----
    drawBar(ctx, W, H, p) {
      const labels = this.data.labels || [];
      const vals = this.data.values || [];
      const n = Math.max(1, labels.length || vals.length);
      const top = 18, base = H - 18;
      const max = Math.max.apply(null, vals.concat([1]));
      const slot = (W - 8) / n;
      const bw = Math.min(18, slot * 0.52);
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';

      vals.forEach((v, i) => {
        const cx = 4 + slot * i + slot / 2;
        const h = v > 0 ? ((base - top) * (v / max)) * p : 3;
        const x = cx - bw / 2;
        const y = base - h;
        const today = i === this.data.todayIndex;
        ctx.fillStyle = today ? '#12A594' : (v > 0 ? '#CDEDE6' : '#EFF3F2');
        this.roundRect(ctx, x, y, bw, h, Math.min(6, bw / 2));
        ctx.fill();
        if (v > 0) {
          ctx.fillStyle = today ? '#0A6E63' : '#8A9490';
          ctx.fillText(v >= 1000 ? (Math.round(v / 100) / 10) + 't' : String(v), cx, y - 6);
        }
      });

      ctx.fillStyle = '#A9B3AF';
      labels.forEach((l, i) => {
        const cx = 4 + slot * i + slot / 2;
        ctx.fillText(String(l), cx, base + 13);
      });
    },

    // ---- 双折线 ----
    drawLine(ctx, W, H, p) {
      const s = (this.data.series || []).filter(x => x && x.data && x.data.length);
      const n = Math.max(2, this.data.labels.length || (s[0] ? s[0].data.length : 0));
      const padL = 8, padR = 8, padT = 12, padB = 20;
      const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
      const mapY = (v) => y1 - (Math.max(0, Math.min(5, v)) / 5) * (y1 - y0);
      const mapX = (i, prog) => x0 + (x1 - x0) * ((i / (n - 1)) * prog);

      // 网格
      ctx.strokeStyle = '#F0F4F3'; ctx.lineWidth = 1;
      for (let g = 1; g <= 5; g++) {
        const y = mapY(g);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }

      s.forEach((se, si) => {
        const data = se.data || [];
        const color = se.color || (si === 0 ? '#12A594' : '#E3B341');
        const full = data.every(v => v != null);
        // 面积（只给第一条，且整条无空值时）
        if (si === 0 && full && data.length > 1) {
          const grad = ctx.createLinearGradient(0, y0, 0, y1);
          grad.addColorStop(0, 'rgba(18,165,148,.18)');
          grad.addColorStop(1, 'rgba(18,165,148,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(mapX(0, p), mapY(data[0]));
          data.forEach((v, i) => ctx.lineTo(mapX(i, p), mapY(v)));
          ctx.lineTo(mapX(data.length - 1, p), y1);
          ctx.lineTo(mapX(0, p), y1);
          ctx.closePath(); ctx.fill();
        }
        // 折线：遇到空值断开，不把缺数据的点拉到底部
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        data.forEach((v, i) => {
          if (v == null) { started = false; return; }
          const x = mapX(i, p), y = mapY(v);
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        });
        ctx.stroke();
        ctx.fillStyle = color;
        data.forEach((v, i) => {
          if (v == null) return;
          ctx.beginPath(); ctx.arc(mapX(i, p), mapY(v), 2.4, 0, Math.PI * 2); ctx.fill();
        });
      });

      // 标签
      ctx.fillStyle = '#A9B3AF'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      const labs = this.data.labels || [];
      labs.forEach((l, i) => {
        if (n > 7 && i % 2 === 1) return;
        const tw = ctx.measureText(String(l)).width;
        const x = Math.min(Math.max(mapX(i, 1), tw / 2 + 2), W - tw / 2 - 2);
        ctx.fillText(String(l), x, H - 6);
      });

      // 触摸十字线
      if (this.tipIndex >= 0 && this.tipIndex < n) {
        const x = mapX(this.tipIndex, 1);
        ctx.strokeStyle = 'rgba(18,165,148,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        const lines = s.map(se => (se.data[this.tipIndex] == null ? '-' : Number(se.data[this.tipIndex]).toFixed(1)));
        const txt = (this.data.labels[this.tipIndex] || '') + '  ' + lines.join(' / ');
        ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        const tw = ctx.measureText(txt).width + 12;
        const tx = Math.min(Math.max(4, x - tw / 2), W - tw - 4);
        ctx.fillStyle = 'rgba(20,24,26,.82)';
        this.roundRect(ctx, tx, 2, tw, 18, 5); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, tx + 6, 14);
      }
    },

    onTouch(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t || !this.W) return;
      const n = Math.max(2, (this.data.labels || []).length);
      const x = t.x != null ? t.x : t.clientX;
      const i = Math.max(0, Math.min(n - 1, Math.round(((x - 8) / (this.W - 16)) * (n - 1))));
      if (i === this.tipIndex) return;
      this.tipIndex = i;
      this.draw(1);
    },

    onTouchEnd() {
      this.tipIndex = -1;
      this.draw(1);
    },

    roundRect(ctx, x, y, w, h, r) {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      ctx.lineTo(x + rr, y + h);
      ctx.arcTo(x, y + h, x, y + h - rr, rr);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.closePath();
    }
  }
});
