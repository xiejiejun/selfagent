/**
 * 发布期流水线（本机直传版）：本地下载源站短片 → manager-node 直传云存储 → 生成静态索引
 *
 * 前置：设置环境变量（腾讯云 API 密钥，需具备云开发权限）
 *   $env:TCB_SECRET_ID  = "..."
 *   $env:TCB_SECRET_KEY = "..."
 * 跑法：
 *   node tools/clip-build-local.js [并发，默认 6]
 * 产物：
 *   tools/out/clip-map.json  tools/out/clips/*.mp4（下载缓存）
 *   miniprogram/libs/clip-index.js
 * 特性：断点续跑、404 跳过、失败重试、并发限流
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const CloudBase = require('@cloudbase/manager-node');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const CLIPS = path.join(OUT, 'clips');
const MAP_FILE = path.join(OUT, 'clip-map.json');
const INDEX = path.join(ROOT, 'miniprogram', 'libs', 'clip-index.js');
const ENV_ID = 'cloud1-d2g3r78mffbe3ca36';
const CONC = Number(process.argv[2] || 6);

const lib = require(path.join(ROOT, 'miniprogram/libs/data/lib.js'));
const arr = Array.isArray(lib) ? lib : (lib.default || lib.list || []);
const ids = Array.from(new Set(arr.map((r) => String(r[0])).filter((i) => /^\d{4}$/.test(i))));

const SOURCES = [
  'https://raw.githubusercontent.com/DuarteSantos8/openGym/main/catalogue/media/clip/',
  'https://cdn.jsdelivr.net/gh/DuarteSantos8/openGym@main/catalogue/media/clip/'
];

function get(url, redirectLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 6000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectLeft > 0) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return get(next, redirectLeft - 1).then(resolve, reject);
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

function writeIndex(map) {
  fs.writeFileSync(INDEX, '// 发布期生成：动作短片索引（id -> 云文件 fileID），勿手改\nmodule.exports = ' + JSON.stringify(map) + ';\n');
}

(async () => {
  const sid = process.env.TCB_SECRET_ID;
  const skey = process.env.TCB_SECRET_KEY;
  if (!sid || !skey) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY，无法直传云存储。');
    console.error('腾讯云控制台 → 访问管理 → API 密钥，或在云开发控制台生成后进行配置。');
    process.exit(2);
  }
  fs.mkdirSync(CLIPS, { recursive: true });
  const app = CloudBase.init({ secretId: sid, secretKey: skey, envId: ENV_ID });

  const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
  const todo = ids.filter((id) => !map[id]);
  console.log('ids', ids.length, 'done', Object.keys(map).length, 'todo', todo.length, 'conc', CONC);

  let cur = 0, ok = 0, miss = 0, fail = 0, doneCount = 0;
  async function worker() {
    while (cur < todo.length) {
      const id = todo[cur++];
      const local = path.join(CLIPS, id + '.mp4');
      let buf = null;
      try {
        if (fs.existsSync(local)) buf = fs.readFileSync(local);
      } catch (e) {}
      if (!buf) {
        for (let t = 0; t < 3 && !buf; t++) {
          for (const base of SOURCES) {
            try { buf = await get(base + id + '.mp4'); break; } catch (e) {}
          }
          if (!buf) await new Promise((r) => setTimeout(r, 400 * (t + 1)));
        }
      }
      if (!buf) { miss++; doneCount++; continue; }
      try {
        fs.writeFileSync(local, buf);
        for (let t = 0; t < 3; t++) {
          try {
            const up = await app.storage.uploadFile({ localPath: local, cloudPath: 'media/clip/' + id + '.mp4' });
            map[id] = (up && (up.fileID || up.fileId)) || '';
            ok++;
            break;
          } catch (e) {
            if (t === 2) { fail++; throw e; }
            await new Promise((r) => setTimeout(r, 500 * (t + 1)));
          }
        }
      } catch (e) { fail++; }
      doneCount++;
      if (doneCount % 50 === 0) {
        fs.writeFileSync(MAP_FILE, JSON.stringify(map));
        console.log('progress', doneCount, '/', todo.length, 'ok', ok, 'miss', miss, 'fail', fail);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length || 1) }, worker));
  fs.writeFileSync(MAP_FILE, JSON.stringify(map));
  writeIndex(map);
  console.log('DONE ok', ok, 'miss', miss, 'fail', fail, 'index ->', INDEX);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
