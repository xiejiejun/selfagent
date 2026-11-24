const data = require('../../libs/data/index');
const ai = require('../../libs/ai');

const PROMPT = [
  '你是健身动作识别助手。看这张照片（可以是器械、训练场景或动作截图），',
  '列出画面里能对应到的标准训练动作名称，最多 6 个。',
  '只输出 JSON：{"exercises":["动作名1","动作名2"]}，动作名用中文通用叫法，不要解释。'
].join('');

function extractJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

Page({
  data: {
    img: '',
    busy: false,
    err: '',
    hint: '',
    raw: '',
    list: [],
    detail: null,
    aiReady: true
  },

  onLoad() {},

  shoot() { this.choose('camera'); },
  album() { this.choose('album'); },

  choose(source) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ img: f.tempFilePath, err: '', list: [], detail: null });
        this.recognize(f.tempFilePath);
      }
    });
  },

  recognize(path) {
    this.setData({ busy: true, raw: '', hint: '压缩图片…' });
    wx.compressImage({
      src: path,
      quality: 55,
      success: (c) => this.toBase64(c.tempFilePath || path),
      fail: () => this.toBase64(path)
    });
  },

  toBase64(path) {
    this.setData({ hint: '读取图片…' });
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (r) => {
        const url = 'data:image/jpeg;base64,' + r.data;
        this.setData({ hint: 'AI 识别中…' });
        this.callAI(url);
      },
      fail: (e) => this.fail('图片读取失败：' + (e.errMsg || ''))
    });
  },

  callAI(url) {
    ai.ask({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url } }
          ]
        }
      ],
      max_tokens: 800,
      temperature: 0.2
    }).then(res => {
      if (!res.ok) {
        this.fail(res.error || 'AI 调用失败', true);
        return;
      }
      const text = res.text || '';
      const j = extractJson(text);
      const names = (j && j.exercises) || [];
      if (!names.length) {
        this.setData({ busy: false, raw: text.slice(0, 400), hint: '', err: 'AI 没有给出可对应到动作库的名称' });
        return;
      }
      this.resolve(names);
    }).catch(e => this.fail('AI 失败：' + ((e && e.errMsg) || e), true));
  },

  resolve(names) {
    const list = [];
    const miss = [];
    names.forEach((nm) => {
      const ex = data.matchByName(nm);
      if (ex && !list.some(x => x.id === ex.id)) {
        list.push({ id: ex.id, n: ex.n, p: ex.p, e: ex.e, t: ex.t, from: nm });
      } else if (!ex) {
        miss.push(nm);
      }
    });
    this.setData({
      busy: false, hint: '', err: '', list, raw: miss.length ? '未匹配：' + miss.join('、') : ''
    });
    if (!list.length) {
      this.setData({ err: '识别到的名称在动作库里没有对应，可以点「去动作库手动挑」' });
    }
  },

  fail(msg, dev) {
    this.setData({
      busy: false, hint: '', err: msg,
      aiReady: false,
      raw: dev ? '需要在云函数 aiProxy 配置 AI_BASE_URL / AI_API_KEY / AI_MODEL 才能识图；未配置时请用动作库搜索。' : ''
    });
  },

  retry() { if (this.data.img) this.recognize(this.data.img); },

  open(e) {
    const id = e.currentTarget.dataset.id;
    const ex = data.byId(id);
    if (!ex) return;
    this.setData({
      detail: {
        id: ex.id, n: ex.n, p: ex.p, e: ex.e, t: ex.t,
        steps: (ex.s || '').split('\n').filter(x => x.trim()).slice(0, 8)
      }
    });
  },

  close() { this.setData({ detail: null }); },

  pick() {
    const d = this.data.detail;
    if (!d) return;
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.emit) {
      ch.emit('pick', { id: d.id, n: d.n, p: d.p, e: d.e, t: d.t });
      wx.navigateBack();
    } else {
      wx.navigateTo({ url: '/pages/library/index' });
    }
  },

  toLib() { wx.navigateTo({ url: '/pages/library/index' }); },

  noop() {}
});
