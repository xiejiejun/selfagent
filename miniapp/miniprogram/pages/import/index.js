const md = require('../../libs/mdimport');

Page({
  data: {
    text: '',
    fileName: '',
    msg: '选一个 .md 文件，或直接把笔记粘进来',
    summary: '',
    canImport: false,
    busy: false
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['md', 'markdown', 'txt'],
      success: (r) => {
        const f = (r.tempFiles || [])[0];
        if (!f) return;
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: 'utf8',
          success: (res) => {
            this.setData({ text: String(res.data || ''), fileName: f.name || '', msg: '已读入 ' + (f.name || '文件') });
            this.doPreview();
          },
          fail: () => {
            this.setData({ msg: '读取失败，可以把内容粘到下面输入框' });
          }
        });
      }
    });
  },

  onText(e) {
    this.setData({ text: e.detail.value, summary: '', canImport: false });
  },

  doPreview() {
    const text = this.data.text || '';
    if (!text.trim()) {
      this.setData({ msg: '还没有内容', summary: '', canImport: false });
      return;
    }
    let p = null;
    try {
      p = md.preview(text);
    } catch (e) {
      this.setData({ msg: '解析失败：' + (e && e.message ? e.message : e), summary: '', canImport: false });
      return;
    }
    this._p = p;
    if (!p.days) {
      this.setData({
        msg: '没解析到带日期的训练段，检查标题行是否带 4 位日期（如「腿 0911」）',
        summary: '',
        canImport: false
      });
      return;
    }
    this.setData({
      msg: '解析到 ' + p.days + ' 天（' + p.first + ' → ' + p.last + '）',
      summary: '力量 ' + p.rec + ' 条 · 有氧 ' + p.cd + ' 条' + (p.skip ? ' · 已存在 ' + p.skip + ' 条将跳过' : ''),
      canImport: !!(p.rec || p.cd)
    });
  },

  doImport() {
    if (!this._p || !this.data.canImport) return;
    const p = this._p;
    wx.showModal({
      title: '导入训练笔记',
      content: '将新增 ' + p.rec + ' 条力量、' + p.cd + ' 条有氧，并按天重建训练日志。同天同动作同组数同重量的会跳过，原有数据不删。',
      confirmText: '导入',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ busy: true });
        let added = null;
        try {
          added = md.apply(p);
        } catch (e) {
          this.setData({ busy: false, msg: '导入失败：' + (e && e.message ? e.message : e) });
          return;
        }
        this.setData({
          busy: false,
          msg: '已导入：力量 ' + added.rec + ' 条、有氧 ' + added.cd + ' 条，覆盖 ' + added.days.length + ' 天',
          summary: '',
          canImport: false
        });
        this._p = null;
        wx.showToast({ title: '已导入', icon: 'none' });
      }
    });
  }
});
