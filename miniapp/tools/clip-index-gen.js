/**
 * 由 clip-map.json 生成客户端静态索引（紧凑格式：统一前缀 + id 白名单）
 * 用法：node tools/clip-index-gen.js
 * 产物：miniprogram/libs/clip-index.js
 *
 * 体积：5147 个 id 约 45KB（相比逐条存完整 fileID 的 518KB，省 470KB 主包空间）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(__dirname, 'out', 'clip-map.json');
const INDEX = path.join(ROOT, 'miniprogram', 'libs', 'clip-index.js');

function gen(map, outFile) {
  const ids = Object.keys(map).filter((id) => map[id] && /^\d{4}$/.test(id));
  const sample = ids.length ? String(map[ids[0]]) : '';
  const cut = sample.indexOf('media/clip/');
  const prefix = cut >= 0 ? sample.slice(0, cut + 'media/clip/'.length) : '';
  const body = ids.map((id) => `'${id}':1`).join(',');
  const text =
    '// 发布期生成：动作短片索引（统一前缀 + id 白名单），勿手改\n' +
    'module.exports = {\n' +
    "  prefix: '" + prefix + "',\n" +
    '  ids: {' + body + '},\n' +
    // 不用 String.prototype.padStart：低版本基础库/未开增强编译的真机上可能不存在，会导致点开详情直接抛错不弹窗
    "  key(id) { const s = String(id); return s.length >= 4 ? s : ('0000' + s).slice(-4); },\n" +
    "  url(id) { const k = this.key(id); return this.ids[k] ? this.prefix + k + '.mp4' : ''; },\n" +
    '  has(id) { return !!this.ids[this.key(id)]; }\n' +
    '};\n';
  fs.writeFileSync(outFile, text);
  return { count: ids.length, prefix, bytes: Buffer.byteLength(text) };
}

if (require.main === module) {
  const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
  const r = gen(map, INDEX);
  console.log('index ids', r.count, 'prefix', r.prefix, 'bytes', r.bytes, '->', INDEX);
}

module.exports = { gen };
