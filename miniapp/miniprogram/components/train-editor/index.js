const engine = require('../../libs/engine/index');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, part, exId, date, uid, groups, isNew, mode:'strength'|'cardio', min, done }
    payload: { type: Object, value: null }
  },

  data: {
    name: '',
    mode: 'strength',
    rows: [],
    min: 30,
    done: true,
    isNew: false
  },

  observers: {
    'visible, payload': function (visible, payload) {
      if (!visible || !payload) return;
      const isCardio = payload.mode === 'cardio';
      const gs = (payload.groups && payload.groups.length)
        ? payload.groups
        : [{ no: 1, reps: payload.reps || 10, weight: payload.weight || 0, done: true, warmup: false, rpe: 0, sec: 0 }];
      this.setData({
        name: payload.name || '',
        mode: isCardio ? 'cardio' : 'strength',
        isNew: !!payload.isNew,
        min: payload.min || 30,
        done: payload.done !== false,
        rows: isCardio ? [] : gs.map((g, i) => ({
          no: i + 1,
          reps: g.reps || 0,
          weight: g.weight || 0,
          done: !!g.done,
          warmup: !!g.warmup,
          rpe: g.rpe || 0,
          sec: g.sec || 0
        }))
      });
    }
  },

  methods: {
    noop() {},

    close() {
      this.triggerEvent('close');
    },

    onName(e) {
      this.setData({ name: e.detail.value });
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

    onWeight(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      rows[i].weight = Math.max(0, parseFloat(e.detail.value) || 0);
      this.setData({ rows });
    },

    toggleDone(e) {
      const i = Number(e.currentTarget.dataset.i);
      const rows = this.data.rows.slice();
      rows[i].done = !rows[i].done;
      this.setData({ rows });
    },

    addSet() {
      const rows = this.data.rows.slice();
      const last = rows[rows.length - 1] || { reps: 10, weight: 0 };
      rows.push({ no: rows.length + 1, reps: last.reps, weight: last.weight, done: false, warmup: false, rpe: 0, sec: 0 });
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

      const rows = this.data.rows.slice();
      const groups = rows.map((r, i) => ({
        no: i + 1,
        reps: r.reps || 0,
        weight: r.weight || 0,
        done: !!r.done,
        warmup: !!r.warmup,
        rpe: r.rpe || 0,
        sec: r.sec || 0
      }));
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
