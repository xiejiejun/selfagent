const https = require('https');
const { URL } = require('url');

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        // 按 Buffer 拼接再统一按 UTF-8 解码，避免多字节字符在分片边界被截断成乱码
        const buf = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf.slice(0, 200))); }
        } else {
          reject(new Error('http ' + res.statusCode + ': ' + buf.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

exports.main = async (event) => {
  const base = process.env.AI_BASE_URL;
  const key = process.env.AI_API_KEY;
  const model = event.model || process.env.AI_MODEL;
  if (!base || !key) return { ok: false, error: 'AI_BASE_URL / AI_API_KEY 未配置' };

  const messages = Array.isArray(event.messages) ? event.messages : [];
  if (!messages.length) return { ok: false, error: 'messages 为空' };

  try {
    const r = await post(base.replace(/\/$/, '') + '/chat/completions',
      { Authorization: 'Bearer ' + key },
      { model, messages, stream: false, temperature: event.temperature == null ? 0.4 : event.temperature,
        max_tokens: event.max_tokens || 400 });
    const text = (((r.choices || [])[0] || {}).message || {}).content || '';
    return { ok: true, text, usage: r.usage || null };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
};
