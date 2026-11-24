const data = require('../../libs/data/index');
const find = require('../../libs/find');
const ai = require('../../libs/ai');

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
    channel: '',
    shot: '',
    miss: []
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
        this.setData({ img: f.tempFilePath, err: '', list: [], detail: null, shot: '', miss: [] });
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
        this.setData({ hint: 'AI 看图中…' });
        this.callAI(url);
      },
      fail: (e) => this.fail('图片读取失败：' + (e.errMsg || ''))
    });
  },

  // 第一步：看图，只输出结构化的器械 / 部位 / 动作 / 关键词
  callAI(url) {
    ai.ask({ messages: find.visionMessages(url), max_tokens: 700, temperature: 0.15 })
      .then(res => {
        if (!res.ok) {
          this.fail(res.error || 'AI 调用失败', true);
          return null;
        }
        const j = extractJson(res.text || '');
        if (!j) {
          this.setData({ busy: false, raw: String(res.text || '').slice(0, 400), hint: '', err: 'AI 返回格式异常，换一张或去动作库手动挑' });
          return null;
        }
        const scene = String(j.scene || '').slice(0, 20);
        const equips = (j.equipment || []).map(x => String(x).trim()).filter(Boolean).slice(0, 5);
        const actions = (j.actions || []).slice(0, 5);
        const part = String(j.part || '');
        const parts = (j.parts || []).slice(0, 3);
        const keywords = (j.keywords || []).slice(0, 6);
        this.setData({
          shot: [scene, equips.length ? equips.join(' / ') : ''].filter(Boolean).join(' · '),
          hint: '按画面条件检索动作库…',
          raw: actions.length ? '画面动作：' + actions.join('、') : ''
        });
        const slots = find.normalize({ part, parts, equips, keywords, names: actions });
        // 名称直配也要跟画面条件一致：拍到龙门架就别塞弹力带/哑铃版本
        const byName = find.byNames(actions).list.filter(x => {
          if (slots.part && x.p !== slots.part && slots.parts.indexOf(x.p) < 0) return false;
          if (slots.eqSpec.size && !slots.eqSpec.has(x.e)) return false;
          return true;
        });
        const cands = find.recall(slots, 70).filter(x => !byName.some(y => y.id === x.id));
        if (!byName.length && !cands.length) {
          this.setData({ busy: false, hint: '', err: '没认出可用动作，换一张更清楚的照片，或去动作库手动挑' });
          return null;
        }
        return this.rerank(scene, equips, part, actions, keywords, slots, byName, cands);
      })
      .catch(e => this.fail('AI 失败：' + ((e && e.errMsg) || e), true));
  },

  // 第二步：把画面条件当作"用户原话"，做同一套重排
  rerank(scene, equips, part, actions, keywords, slots, byName, cands) {
    const ctx = '用户拍了照片。画面：' + (scene || '健身场景') +
      '；可见器械：' + (equips.join('、') || '未识别') +
      '；主要部位：' + (part || '未判断') +
      '；画面里的动作：' + ((actions || []).join('、') || '未识别');
    if (!cands.length) return this.render(slots, byName, [], null);
    this.setData({ hint: 'AI 正在按器械和动作模式重排…' });
    const tryOnce = (n) => ai.ask({
      messages: find.rerankMessages(ctx, slots, cands),
      temperature: 0.15,
      max_tokens: 900
    }).then(r => {
      if (!r || !r.ok || !r.text) {
        if (n > 1) return new Promise(x => setTimeout(x, 1500)).then(() => tryOnce(n - 1));
        return null;
      }
      const j = extractJson(r.text);
      if (!j) {
        if (n > 1) return new Promise(x => setTimeout(x, 1200)).then(() => tryOnce(n - 1));
        return null;
      }
      const ids = {};
      cands.forEach(x => { ids[x.id] = 1; });
      const picks = (j.picks || [])
        .map(x => x && { id: find.fixId(x.id, ids), why: String(x.why || '').slice(0, 14) })
        .filter(x => x && x.id)
        .slice(0, 10);
      return this.render(slots, byName, picks, j, cands);
    }).catch(() => this.render(slots, byName, [], null, cands));
    return tryOnce(2);
  },

  render(slots, byName, picks, j, cands) {
    const all = cands || [];
    const byId = {};
    all.forEach(x => { byId[x.id] = x; });
    const out = [];
    const seen = {};
    byName.forEach(x => { if (!seen[x.id]) { seen[x.id] = 1; out.push({ id: x.id, n: x.n, p: x.p, e: x.e, t: x.t, why: '画面直接对应' }); } });
    picks.forEach(pk => {
      const it = byId[pk.id];
      if (!it || seen[pk.id]) return;
      seen[pk.id] = 1;
      out.push({ id: it.id, n: it.n, p: it.p, e: it.e, t: it.t, why: pk.why });
    });
    all.slice(0, 12).forEach(it => {
      if (out.length >= 12 || seen[it.id]) return;
      seen[it.id] = 1;
      out.push({ id: it.id, n: it.n, p: it.p, e: it.e, t: it.t, why: '' });
    });
    const miss = out.length >= 4 ? [] : ((j && (j.notFound || j.missing)) ? (j.notFound || j.missing).filter(Boolean).slice(0, 3) : []);
    this.setData({
      busy: false, hint: '', err: '', list: out.slice(0, 12),
      miss,
      raw: miss.length ? '动作库里没有：' + miss.join('、') : (this.data.raw || '')
    });
    if (!out.length) this.setData({ err: '没找到匹配动作，可以点「去动作库手动挑」' });
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
