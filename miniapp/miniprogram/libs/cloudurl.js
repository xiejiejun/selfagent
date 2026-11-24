/**
 * 云文件 → 临时 HTTPS 链接
 * 渲染层的 <image src> / <video poster> 不认 cloud:// 协议，必须换成 getTempFileURL 的结果。
 * 带内存 + 本机缓存（保留最近 400 条，90 分钟有效），避免每次列表刷新都请求。
 */
const KEY = 'selfagent_tmpurl_v1';
const TTL = 90 * 60 * 1000;
const MAX = 400;

let mem = null;

function read() {
  if (mem) return mem;
  try { mem = wx.getStorageSync(KEY) || {}; } catch (e) { mem = {}; }
  return mem;
}

function write() {
  try {
    const keys = Object.keys(mem);
    if (keys.length > MAX) {
      const keep = keys.slice(-MAX);
      const obj = {};
      keep.forEach(k => { obj[k] = mem[k]; });
      mem = obj;
    }
    wx.setStorageSync(KEY, mem);
  } catch (e) {}
}

function pick(fids) {
  const c = read();
  const now = Date.now();
  const out = {};
  fids.forEach(f => { if (c[f] && c[f].exp > now && c[f].u) out[f] = c[f].u; });
  return out;
}

/**
 * @param {string[]} fids cloud fileID 列表
 * @param {(map:{[fid:string]:string})=>void} cb
 */
function resolve(fids, cb) {
  const list = Array.from(new Set((fids || []).filter(f => f && String(f).indexOf('cloud://') === 0)));
  if (!list.length) return cb({});
  const hit = pick(list);
  const need = list.filter(f => !hit[f]);
  if (!need.length) return cb(hit);
  if (!wx.cloud || !wx.cloud.getTempFileURL) return cb(hit);

  const c = read();
  const now = Date.now();
  const chunks = [];
  for (let i = 0; i < need.length; i += 50) chunks.push(need.slice(i, i + 50));

  let pending = chunks.length;
  chunks.forEach(chunk => {
    wx.cloud.getTempFileURL({
      fileList: chunk,
      success: (res) => {
        ((res && res.fileList) || []).forEach(it => {
          if (it && it.fileID && it.tempFileURL) c[it.fileID] = { u: it.tempFileURL, exp: now + TTL };
        });
        if (--pending === 0) { write(); cb(pick(list)); }
      },
      fail: () => { if (--pending === 0) { write(); cb(pick(list)); } }
    });
  });
}

module.exports = { resolve, pick, bust };

// 让指定 fileID 的缓存失效（临时链接过期 / 设备上加载失败时用）
function bust(fids) {
  const c = read();
  (fids || []).forEach(f => { if (f) delete c[f]; });
  try { wx.setStorageSync(KEY, c); } catch (e) {}
}
