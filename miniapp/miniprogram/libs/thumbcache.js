/**
 * 图卡缩略图本机缓存：exId → USER_DATA_PATH/thumbs/<id>.webp
 * 目的：第二次以后直接读本地文件，不再走「云函数 → 临时链接 → 网络图片」，避免灰块/白板。
 */
const KEY = 'selfagent_thumb_v1';
const DIR = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/thumbs';

let mem = null;
let ls = null;

function fs() {
  try { return wx.getFileSystemManager(); } catch (e) { return null; }
}

function read() {
  if (mem) return mem;
  try { mem = wx.getStorageSync(KEY) || {}; } catch (e) { mem = {}; }
  return mem;
}

function write() {
  read();
  try { wx.setStorageSync(KEY, mem); } catch (e) {}
}

function ensureDir() {
  const f = fs();
  if (!f || !DIR) return false;
  try { f.accessSync(DIR); return true; } catch (e) {}
  try { f.mkdirSync(DIR, true); return true; } catch (e) { return false; }
}

// 命中且文件还在 → 返回本地路径；文件被系统清掉就顺手删缓存
function get(id) {
  const c = read();
  const p = c[String(id || '')];
  if (!p) return '';
  const f = fs();
  if (!f) return p;
  try { f.accessSync(p); return p; } catch (e) {
    delete c[String(id)];
    write();
    return '';
  }
}

function save(id, tempPath) {
  if (!id || !tempPath) return '';
  if (!ensureDir()) return '';
  const f = fs();
  if (!f) return '';
  const dst = DIR + '/' + id + '.webp';
  try { f.copyFileSync(tempPath, dst); } catch (e) {
    try { f.saveFileSync && f.saveFileSync(tempPath, dst); } catch (e2) { return ''; }
  }
  const c = read();
  c[String(id)] = dst;
  write();
  return dst;
}

module.exports = { get, save, drop, DIR };

function drop(id) {
  const c = read();
  const p = c[String(id || '')];
  if (!p) return;
  delete c[String(id)];
  write();
  const f = fs();
  if (f) { try { f.unlinkSync(p); } catch (e) {} }
}
