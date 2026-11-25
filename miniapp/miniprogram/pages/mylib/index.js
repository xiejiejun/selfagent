const actions = require('../../libs/actions');
const data = require('../../libs/data/index');

Page({
  data: {
    list: [],
    formOn: false,
    editId: '',
    f: { name: '', part: '胸', equip: '哑铃', target: '', steps: '', img: '' },
    parts: data.PARTS.filter(p => p !== '全部'),
    equips: data.EQUIPS.map(e => e.k).filter(k => k !== '全部')
  },

  onShow() { this.refresh(); this.retryLocalImgs(); },

  // 老数据里图片只存了本机临时路径：补传到云存储，换回 fileID，才能进数据库、换机也在
  retryLocalImgs() {
    if (!wx.cloud || !wx.cloud.uploadFile) return;
    if (this.imgRetrying) return;
    this.imgRetrying = 1;
    const need = actions.customList().filter(x => {
      const img = String((x && (x.img || x.fileID)) || '');
      return img && img.indexOf('cloud://') !== 0 && !/^https?:/.test(img);
    });
    if (!need.length) { this.imgRetrying = 0; return; }
    let left = need.length;
    const done = () => { left--; if (left <= 0) { this.imgRetrying = 0; this.refresh(); } };
    need.forEach(x => {
      wx.cloud.uploadFile({
        cloudPath: 'custom/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg',
        filePath: x.img || x.fileID,
        success: (up) => {
          if (up && up.fileID) {
            actions.saveCustom(Object.assign({}, x, { img: up.fileID }));
            const i = (this.data.list || []).findIndex(v => v.id === x.id);
            if (i >= 0) this.setData({ ['list[' + i + '].img']: up.fileID });
          }
          done();
        },
        fail: done
      });
    });
  },

  refresh() {
    const list = actions.customList().map(x => ({
      id: x.id,
      n: x.n || x.name,
      p: x.p || x.part || '',
      e: x.e || x.equip || '',
      img: x.img || x.fileID || '',
      t: (x.s || '').split('\n').filter(Boolean).length,
      raw: x
    }));
    this.setData({ list });
  },

  newOne() {
    this.setData({
      formOn: true, editId: '',
      f: { name: '', part: '胸', equip: '哑铃', target: '', steps: '', img: '' }
    });
  },

  edit(e) {
    const id = e.currentTarget.dataset.id;
    const x = actions.customList().find(v => v.id === id);
    if (!x) return;
    this.setData({
      formOn: true, editId: id,
      f: {
        name: x.n || x.name || '', part: x.p || x.part || '胸',
        equip: x.e || x.equip || '哑铃', target: x.t || '', steps: x.s || '',
        img: x.img || x.fileID || ''
      }
    });
  },

  onF(e) {
    const k = e.currentTarget.dataset.k;
    const f = Object.assign({}, this.data.f);
    f[k] = e.detail.value;
    this.setData({ f });
  },

  onPart(e) { this.setData({ 'f.part': e.currentTarget.dataset.p }); },
  onEquip(e) { this.setData({ 'f.equip': e.currentTarget.dataset.e }); },

  chooseImg() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const temp = (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) || '';
        if (!temp) return;
        if (!wx.cloud) { this.setData({ 'f.img': temp }); return; }
        const cloudPath = 'custom/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg';
        wx.cloud.uploadFile({
          cloudPath,
          filePath: temp,
          success: (up) => this.setData({ 'f.img': up.fileID || cloudPath }),
          fail: () => {
            // 云上传失败：先留本地临时图，重启后需重传
            this.setData({ 'f.img': temp });
            wx.showToast({ title: '云上传失败，先存本地临时图', icon: 'none' });
          }
        });
      }
    });
  },

  clearImg() { this.setData({ 'f.img': '' }); },

  save() {
    const f = this.data.f;
    if (!(f.name || '').trim()) { wx.showToast({ title: '先给动作起个名', icon: 'none' }); return; }
    const img = String(f.img || '');
    // 图还只是本机临时文件：保存前补传云存储，换成 fileID 再入库
    if (img && img.indexOf('cloud://') !== 0 && !/^https?:/.test(img) && wx.cloud && wx.cloud.uploadFile) {
      wx.cloud.uploadFile({
        cloudPath: 'custom/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg',
        filePath: img,
        success: (up) => this.persist(f, (up && up.fileID) || ''),
        fail: () => {
          this.persist(f, img);
          wx.showToast({ title: '图片未传上云，仅本机可见', icon: 'none' });
        }
      });
      return;
    }
    this.persist(f, img);
  },

  // 落库 + 立刻同步（自定义动作走 trainmeta 快照，含 img fileID）
  persist(f, img) {
    actions.saveCustom({
      id: this.data.editId || '',
      n: f.name.trim(),
      p: f.part,
      e: f.equip,
      t: (f.target || '').trim(),
      s: f.steps || '',
      img: img || '',
      custom: true
    });
    this.setData({ formOn: false, editId: '' });
    this.refresh();
    try { require('../../libs/sync/index').flush(); } catch (e) {}
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这个自定义动作？',
      content: '只删动作库条目，已有训练记录不受影响。',
      confirmText: '删除', confirmColor: '#E06E78',
      success: (r) => {
        if (!r.confirm) return;
        actions.removeCustom(id);
        this.refresh();
      }
    });
  },

  cancel() { this.setData({ formOn: false, editId: '' }); },
  noop() {}
});
