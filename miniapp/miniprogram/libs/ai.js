// AI 调用层：优先用本机配置的自定义 Agent（OpenAI 兼容 /chat/completions），
// 未配置时回退到云函数 aiProxy（Key 留在云端）。
// 注意：自定义 baseUrl 需在小程序后台「开发管理 → 服务器域名」加入 request 合法域名；
// 开发阶段可在开发者工具勾选「不校验合法域名」。
const store = require('./store/index');

function cfg() {
  const s = store.getSettings() || {};
  const c = s.ai || {};
  return {
    baseUrl: c.baseUrl || '',
    apiKey: c.apiKey || '',
    model: c.model || '',
    anon: c.anon !== false,
    count: Number(c.count) || 0,
    tokens: Number(c.tokens) || 0,
    last: Number(c.last) || 0
  };
}

function saveCfg(next) {
  const s = store.getSettings() || {};
  const cur = s.ai || {};
  s.ai = Object.assign({}, cur, next || {});
  // 显式传空对象表示全部清空
  if (next && !Object.keys(next).length) s.ai = {};
  store.setSettings(s);
  return s.ai;
}

// 匿名化：手机号、长 ID、邮箱、URL 里的 key 一律替换，只留结构
function maskText(t) {
  return String(t || '')
    .replace(/(1[3-9]\d{9})/g, '【手机号】')
    .replace(/\b[0-9a-f]{10,}\b/gi, '【ID】')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '【邮箱】')
    .replace(/sk-[A-Za-z0-9]+/g, '【KEY】');
}

function maskMessages(messages, anon) {
  if (anon === false) return messages;
  return (messages || []).map(m => {
    if (!m || !Array.isArray(m.content)) {
      return Object.assign({}, m, { content: maskText(m && m.content) });
    }
    // 多模态：只对文字做匿名化，图片块原样保留（一旦被拼成字符串，模型就看不到图了）
    return Object.assign({}, m, {
      content: m.content.map(p => {
        if (!p || typeof p !== 'object') return p;
        if (p.type === 'text') return Object.assign({}, p, { text: maskText(p.text) });
        return p;
      })
    });
  });
}

// 预览用：数组 content 只写文字 + [图片]，避免把 base64 存进设置
function previewContent(c) {
  if (!Array.isArray(c)) return String(c || '');
  return c.map(p => {
    if (!p || typeof p !== 'object') return String(p || '');
    if (p.type === 'text') return String(p.text || '');
    if (p.type === 'image_url') return '[图片]';
    return '[' + (p.type || 'part') + ']';
  }).join('\n');
}

function contentChars(c) {
  if (!Array.isArray(c)) return String(c || '').length;
  return c.reduce((a, p) => a + ((p && p.type === 'text') ? String(p.text || '').length : 0), 0);
}

function lastRequest() {
  const s = store.getSettings() || {};
  return (s.ai && s.ai.preview) || '';
}

// 是否已配自定义 Agent（配了就直连，不再走云函数）
function usingCustom() {
  const c = cfg();
  return !!(c.apiKey && c.baseUrl);
}

function usageText() {
  const c = cfg();
  if (!c.count) return '还没有调用';
  const t = c.last ? new Date(c.last) : null;
  const p = n => String(n).padStart(2, '0');
  const when = t ? (p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes())) : '';
  return '已调用 ' + c.count + ' 次 · 约 ' + c.tokens + ' tokens' + (when ? ' · 上次 ' + when : '');
}

function track(usage, chars) {
  const c = cfg();
  const tk = (usage && usage.total_tokens) ? Number(usage.total_tokens) : Math.ceil((chars || 0) / 1.6);
  saveCfg({ count: c.count + 1, tokens: c.tokens + (tk > 0 ? tk : 0), last: Date.now() });
}

// 参数：{ messages, model, temperature, max_tokens }
// 返回：{ ok, text, usage?, error? }
function ask(opts) {
  const o = opts || {};
  const c = cfg();
  const messages = Array.isArray(o.messages) ? maskMessages(o.messages, c.anon) : [];
  if (!messages.length) return Promise.resolve({ ok: false, error: 'messages 为空' });

  const chars = messages.reduce((a, m) => a + contentChars(m.content), 0);
  // 发送的内容留一份预览，设置页可看
  saveCfg({ preview: messages.map(m => (m.role || '') + '：' + previewContent(m.content).slice(0, 600)).join('\n').slice(0, 2000) });

  if (c.apiKey && c.baseUrl) {
    return new Promise((resolve) => {
      wx.request({
        url: String(c.baseUrl).replace(/\/$/, '') + '/chat/completions',
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + c.apiKey
        },
        data: {
          model: o.model || c.model || 'gpt-4o-mini',
          messages,
          stream: false,
          temperature: o.temperature == null ? 0.4 : o.temperature,
          max_tokens: o.max_tokens || 400
        },
        timeout: 20000,
        success(res) {
          const r = res.data || {};
          const text = (((r.choices || [])[0] || {}).message || {}).content || '';
          if (res.statusCode >= 200 && res.statusCode < 300 && text) {
            track(r.usage, chars);
            resolve({ ok: true, text, usage: r.usage || null });
          } else {
            resolve({ ok: false, error: 'http ' + res.statusCode + ': ' + JSON.stringify(r).slice(0, 160) });
          }
        },
        fail(err) { resolve({ ok: false, error: (err && err.errMsg) || '请求失败' }); }
      });
    });
  }

  if (!wx.cloud) return Promise.resolve({ ok: false, error: '云开发未初始化' });
  return wx.cloud.callFunction({
    name: 'aiProxy',
    data: { messages, model: o.model, temperature: o.temperature, max_tokens: o.max_tokens }
  }).then(r => {
    const out = (r && r.result) || { ok: false, error: '空响应' };
    if (out.ok) track(out.usage, chars);
    return out;
  }).catch(err => ({ ok: false, error: (err && err.errMsg) || String(err) }));
}

module.exports = { ask, cfg, saveCfg, maskText, maskMessages, usageText, lastRequest, usingCustom };
