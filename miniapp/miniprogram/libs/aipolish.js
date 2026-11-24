// AI 扩写统一入口：规则数字 → 一句话人话版
// 同 facts 内容命中缓存，不重复烧 token；可在设置里关掉（纯数据模式）
const ai = require('./ai');
const store = require('./store/index');

const CACHE_KEY = 'selfagent_ai_polish_v1';
const TTL = 24 * 3600 * 1000;

function readCache() {
  try { return wx.getStorageSync(CACHE_KEY) || {}; } catch (e) { return {}; }
}

function writeCache(c) {
  try { wx.setStorageSync(CACHE_KEY, c); } catch (e) {}
}

function hashOf(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return 'h' + (h >>> 0).toString(36);
}

// 纯数据模式：设置里 ai.pureData = true 时全站 AI 扩写关闭
function enabled() {
  const s = store.getSettings() || {};
  return !(s.ai && s.ai.pureData);
}

function setPureData(v) {
  const s = store.getSettings() || {};
  s.ai = s.ai || {};
  s.ai.pureData = !!v;
  store.setSettings(s);
  return s.ai.pureData;
}

function clean(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*#>`]/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^[「“"']|[」”"']$/g, '')
    .trim()
    .slice(0, 160);
}

// key：触点标识（insight/summary/weekly/plan...）
// facts：可为对象或字符串，内容进缓存 key，也进 prompt
// instr：给模型的写作要求（一句话以内优先）
function polish(key, facts, instr, opts) {
  const o = opts || {};
  if (!enabled()) return Promise.resolve({ ok: false, text: '', cached: false, off: true });
  const factStr = typeof facts === 'string' ? facts : JSON.stringify(facts);
  const h = hashOf(key + '|' + factStr + '|' + (instr || ''));
  const cache = readCache();
  const hit = cache[key];
  if (hit && hit.h === h && Date.now() - hit.at < TTL) {
    return Promise.resolve({ ok: true, text: hit.t, cached: true });
  }
  const messages = [
    {
      role: 'system',
      content: '你是健身 App 的数据解读助手。只依据用户给出的数字，不编造数字，不做医疗诊断。' +
        '输出中文纯文本，不要 markdown、不要引号、不要换行，控制在 ' + (o.max || 40) + ' 字以内。'
    },
    { role: 'user', content: '数据：' + factStr + '\n要求：' + (instr || '用一句话点评这组数据') }
  ];
  return ai.ask({ messages, max_tokens: o.tokens || 160, temperature: o.temp == null ? 0.35 : o.temp })
    .then(r => {
      if (!r || !r.ok || !r.text) return { ok: false, text: '', error: (r && r.error) || 'AI 不可用' };
      const t = clean(r.text);
      if (!t) return { ok: false, text: '', error: '空回答' };
      const c = readCache();
      c[key] = { h, t, at: Date.now() };
      // 只留最近 40 条
      const keys = Object.keys(c);
      if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(k => { delete c[k]; });
      writeCache(c);
      return { ok: true, text: t, cached: false };
    });
}

function clearCache() {
  try { wx.removeStorageSync(CACHE_KEY); } catch (e) {}
}

module.exports = { polish, enabled, setPureData, clearCache, hashOf };
