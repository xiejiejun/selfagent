/**
 * 发布期：只下载不传（需要密钥前先把素材落到本地，后续上传 0 网络等待）
 * 用法：node tools/clip-download.js [并发=8]
 * 产物：tools/out/clips/<id>.mp4 + tools/out/clips-have.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const CLIPS = path.join(OUT, 'clips');
const HAVE = path.join(OUT, 'clips-have.json');
const CONC = Number(process.argv[2] || 8);

const lib = require(path.join(ROOT, 'miniprogram/libs/data/lib.js'));
const arr = Array.isArray(lib) ? lib : (lib.default || lib.list || []);
const ids = Array.from(new Set(arr.map((r) => String(r[0])).filter((i) => /^\d{4}$/.test(i))));
const SOURCES = [
  'https://raw.githubusercontent.com/DuarteSantos8/openGym/main/catalogue/media/clip/',
  'https://cdn.jsdelivr.net/gh/DuarteSantos8/openGym@main/catalogue/media/clip/'
];

function get(url, left = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 6000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return get(next, left - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(CLIPS, { recursive: true });
  const have = fs.existsSync(HAVE) ? JSON.parse(fs.readFileSync(HAVE, 'utf8')) : {};
  const todo = ids.filter((id) => !have[id]);
  console.log('ids', ids.length, 'have', Object.keys(have).length, 'todo', todo.length);
  let cur = 0, ok = 0, miss = 0, done = 0;
  async function worker() {
    while (cur < todo.length) {
      const id = todo[cur++];
      let buf = null;
      for (let t = 0; t < 2 && !buf; t++) {
        for (const base of SOURCES) {
          try { buf = await get(base + id + '.mp4'); break; } catch (e) {}
        }
      }
      if (buf) {
        try { fs.writeFileSync(path.join(CLIPS, id + '.mp4'), buf); have[id] = true; ok++; } catch (e) {}
      } else miss++;
      done++;
      if (done % 100 === 0) {
        fs.writeFileSync(HAVE, JSON.stringify(have));
        console.log('download', done, '/', todo.length, 'ok', ok, 'miss', miss);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length || 1) }, worker));
  fs.writeFileSync(HAVE, JSON.stringify(have));
  console.log('DONE ok', ok, 'miss', miss, 'have', Object.keys(have).length);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
