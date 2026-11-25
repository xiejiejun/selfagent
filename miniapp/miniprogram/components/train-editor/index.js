const engine = require('../../libs/engine/index');

const TAGS = ['', 'warm', 'drop', 'super'];
const TAG_LABEL = { '': '', warm: '热身', drop: '递减', side: '每侧', super: '超级组' };

function toRow(g, i) {
  return {
    no: i + 1,
    reps: g.reps || 0,
    weight: g.weight || 0,
    wText: g.weight ? String(g.weight) : '0',
    lw: g.lw,
    rw: g.rw,
    lText: g.lw != null ? String(g.lw) : (g.weight ? String(g.weight) : '0'),
    rText: g.rw != null ? String(g.rw) : (g.weight ? String(g.weight) : '0'),
    done: !!g.done,
    warmup: !!g.warmup,
    rpe: g.rpe || 0,
    sec: g.sec || 0,
    tag: g.tag || (g.warmup ? 'warm' : ''),
    tagLabel: TAG_LABEL[g.tag || (g.warmup ? 'warm' : '')] || ''
  };
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, part, exId, date, uid, uni, groups, isNew, mode:'strength'|'cardio', min, done }
    payload: { type: Object, value: null },
    // 'dark'：嵌在专注训练这类深色页面时用，默认浅色
    theme: { type: String, value: '' }
  },

  data: {
    name: '',
    mode: 'strength',
    rows: [],
    min: 30,
    done: true,
    isNew: false,
    uni: false,
    split: false
  },

  observers: {
    'visible, payload': function (visible, payload) {
      if (!visible || !payload) return;
      this._uniTouched = false;
      const isCardio = payload.mode === 'cardio';
      const gs = (payload.groups && payload.groups.length)
        ? payload.groups
        : [{ no: 1, reps: payload.reps || 10, weight: payload.weight || 0, done: true, warmup: false, rpe: 0, sec: 0, tag: '' }];
      const split = gs.some(g => g.lw != null || g.rw != null);
      const uni = isCardio ? false : (payload.uni != null ? !!payload.uni : engine.uniOf(payload));
      this.setData({
        name: payload.name || '',
        mode: isCardio ? 'cardio' : 'strength',
        isNew: !!payload.isNew,
        min: payload.min || 30,
        done: payload.done !== false,
        uni,
        split,
        rows: isCardio ? [] : gs.map(toRow)
      });
    }
  },

  methods: {
    noop() {},

    close() {
      this.triggerEvent('close');
    },

    onName(e) {
      const v = e.detail.value;
      const patch = { name: v };
      // 新建动作按名称自动判单侧，用户手动拨过就不再覆盖
      if (!this._uniTouched && this.data.isNew) patch.uni = engine.isUniName(v);
      this.setData(patch);
    },

    onMin(e) {
      this.setData({ min: Math.max(1, parseInt(e.detail.value, 10) || 1) });
    },

    onCardioDone(e) {
      this.setData({ done: e.detail.value });
    },

    onReps(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      rows[i].reps = Math.max(0, parseInt(e.detail.value, 10) || 0);
      this.setData({ rows });
    },

    // 重量：保留用户原样输入（18.5 / 2.5 / 0.5），不要在输入过程中做数字回写，
    // 否则打「.」的瞬间会被 parseFloat 吞掉。解析放到保存前。
    onWeight(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      const v = String(e.detail.value == null ? '' : e.detail.value);
      rows[i].wText = v;
      rows[i].weight = Number(v) || 0;
      this.setData({ rows });
    },

    onWeightBlur(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      const v = Number(rows[i].wText);
      const w = v > 0 ? Math.round(v * 100) / 100 : 0;
      rows[i].weight = w;
      rows[i].wText = w ? String(w) : '0';
      this.setData({ rows });
    },

    // 左/右重量：同样保留原样输入，blur 时才取整
    onLR(e) {
      const i = Number(e.currentTarget.dataset.i);
      const k = e.currentTarget.dataset.k === 'rText' ? 'rText' : 'lText';
      const rows = this.data.rows.slice();
      rows[i][k] = String(e.detail.value == null ? '' : e.detail.value);
      rows[i][k === 'lText' ? 'lw' : 'rw'] = Number(rows[i][k]) || 0;
      this.setData({ rows });
    },

    onLRBlur(e) {
      const i = Number(e.currentTarget.dataset.i);
      const k = e.currentTarget.dataset.k === 'rText' ? 'rText' : 'lText';
      const rows = this.data.rows.slice();
      const v = Number(rows[i][k]);
      const w = v > 0 ? Math.round(v * 100) / 100 : 0;
      rows[i][k === 'lText' ? 'lw' : 'rw'] = w;
      rows[i][k] = w ? String(w) : '0';
      this.setData({ rows });
    },

    // 单侧：只换语义，不动已填数字
    toggleUni() {
      this._uniTouched = true;
      const uni = !this.data.uni;
      this.setData({ uni, split: uni ? this.data.split : false });
      if (uni === false) this.applySplit(false);
    },

    // 左右分开记：打开时用当前重量预填左右，关闭时取左右最大值
    toggleSplit() {
      if (!this.data.uni) return;
      this.applySplit(!this.data.split);
    },

    applySplit(on) {
      const rows = this.data.rows.slice();
      rows.forEach(r => {
        if (on) {
          r.lw = r.weight || 0;
          r.rw = r.weight || 0;
          r.lText = String(r.weight || 0);
          r.rText = String(r.weight || 0);
        } else if (r.lw != null || r.rw != null) {
          const w = Math.max(Number(r.lw) || 0, Number(r.rw) || 0);
          r.weight = w;
          r.wText = String(w || 0);
          r.lw = undefined;
          r.rw = undefined;
        }
      });
      this.setData({ rows, split: !!on });
    },

    toggleDone(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      rows[i].done = !rows[i].done;
      this.setData({ rows });
    },

    // 组类型循环：常规 → 热身 → 递减 → 超级组（「每侧」已提到动作级，不再循环到组上）
    cycleTag(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      const cur = rows[i].tag || '';
      const next = TAGS[(TAGS.indexOf(cur) + 1) % TAGS.length];
      rows[i].tag = next;
      rows[i].tagLabel = TAG_LABEL[next];
      rows[i].warmup = next === 'warm';
      this.setData({ rows });
    },

    addSet() {
      const rows = this.data.rows.slice();
      const last = rows[rows.length - 1] || { reps: 10, weight: 0 };
      const split = this.data.split;
      rows.push({
        no: rows.length + 1,
        reps: last.reps,
        weight: last.weight,
        wText: String(last.weight || 0),
        lw: split ? (last.lw || 0) : undefined,
        rw: split ? (last.rw || 0) : undefined,
        lText: String((split ? last.lw : last.weight) || 0),
        rText: String((split ? last.rw : last.weight) || 0),
        done: false, warmup: false, rpe: 0, sec: 0, tag: '', tagLabel: ''
      });
      this.setData({ rows });
    },

    delSet(e) {
      const i = Number(e.currentTarget.dataset.i);
      if (this.data.rows.length <= 1) {
        wx.showToast({ title: '至少保留一组', icon: 'none' });
        return;
      }
      const rows = this.data.rows.slice();
      rows.splice(i, 1);
      rows.forEach((r, k) => { r.no = k + 1; });
      this.setData({ rows });
    },

    save() {
      const p = this.data.payload || {};
      const name = (this.data.name || '').trim() || p.name || '';
      const mode = p.mode || this.data.mode;

      if (mode === 'cardio') {
        const min = Math.max(1, this.data.min || 1);
        this.triggerEvent('confirm', {
          isNew: this.data.isNew,
          mode: 'cardio',
          record: {
            uid: p.uid || '',
            date: p.date,
            modal: name,
            name,
            exId: p.exId || '',
            part: '有氧',
            mode: 'timer',
            min,
            dur: min,
            sec: min * 60,
            done: !!this.data.done,
            free: true,
            role: 'post',
            ts: Date.now()
          }
        });
        return;
      }

      const uni = !!this.data.uni;
      const split = uni && !!this.data.split;
      const rows = this.data.rows.slice();
      const groups = rows.map((r, i) => {
        const g = {
          no: i + 1,
          reps: r.reps || 0,
          done: !!r.done,
          warmup: !!r.warmup || r.tag === 'warm',
          rpe: r.rpe || 0,
          sec: r.sec || 0,
          tag: r.tag || ''
        };
        if (split) {
          const l = Number(r.lw) || 0;
          const rr = Number(r.rw) || 0;
          g.lw = l;
          g.rw = rr;
          g.weight = Math.max(l, rr);
        } else {
          g.weight = r.weight || 0;
        }
        return g;
      });
      const maxReps = groups.reduce((a, g) => Math.max(a, g.reps || 0), 0);
      const maxW = groups.reduce((a, g) => Math.max(a, g.weight || 0), 0);

      this.triggerEvent('confirm', {
        isNew: this.data.isNew,
        mode: 'strength',
        record: {
          uid: p.uid || '',
          date: p.date,
          exId: p.exId || '',
          name,
          part: p.part || '',
          uni,
          sets: groups.length,
          reps: maxReps,
          weight: maxW,
          dur: p.dur || 0,
          groups
        }
      });
    },

    remove() {
      const p = this.data.payload || {};
      wx.showModal({
        title: '删除这个动作',
        content: '只删掉「' + (p.name || '') + '」及其组数，当天其他动作保留；删除后不能恢复。',
        confirmText: '删除',
        confirmColor: '#E06E78',
        cancelText: '保留',
        success: (r) => {
          if (r.confirm) this.triggerEvent('delete', { uid: p.uid, mode: p.mode || this.data.mode, name: p.name });
        }
      });
    }
  }
});
