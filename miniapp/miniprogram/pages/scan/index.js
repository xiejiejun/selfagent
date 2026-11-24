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
    aiReady: true,
    channel: ''
  },

  onLoad() {
    const c = ai.cfg();
    
    const custom = ai.usingCustom();
    this.setData({
      channel: custom
        ? ('直连 ' + (c.baseUrl || '').replace(/^https?:\/\//, '') + ' · ' + (c.model || '默认模型'))
        : '云端 aiProxy（未配自定义 API）'
    });
  },

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
    const raw = String(msg || '');
    let err = raw;
    let tip = '';
    if (/domain list|合法域名|url not in/i.test(raw)) {
      err = '自定义 API 域名没有加白名单，请求被小程序拦截';
      tip = '把 ' + (ai.cfg().baseUrl || 'API 域名') + ' 加进后台「服务器域名 → request 合法域名」；开发阶段可在开发者工具勾选「不校验合法域名」。';
    } else if (/-504003|timed out after 3 seconds/i.test(raw)) {
      err = '云端 aiProxy 3 秒超时（云端函数超时仍是 3s，IDE 部署改不动）';
      tip = '两种解法：① 在设置里配好自定义 API（已配就不走云函数）；② 云开发控制台把 aiProxy 超时改成 45 秒。';
    } else if (/401|403|invalid api key|unauthorized/i.test(raw)) {
      err = 'API Key 被拒绝（401/403）';
      tip = '检查 Key 是否过期、是否带多余空格，或模型名是否可用。';
    }
    this.setData({
      busy: false, hint: '', err,
      aiReady: false,
      raw: (tip ? tip + ' ' : '') + '当前通道：' + (this.data.channel || '') + (dev ? '（' + raw + '）' : '')
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

  goApi() { wx.navigateTo({ url: '/pages/apiconfig/index' }); },

  noop() {}
});
